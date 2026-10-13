import type { Queryable } from "../db/pool.js";
import { ingestedTable } from "../db/pool.js";
import type { PoolSource } from "./settings.js";
import { isLaneTable, safeWhere, TABLE_COLUMN_SYNONYMS } from "../stages/ingest/index.js";

/**
 * Before a job opens, look at the pool the bot is handing over (D99). A
 * pool the service cannot ingest is refused here, in plain English, with
 * nothing opened and nothing to abort. Free. Reads at most the header
 * line of a file; never a lead row.
 */
export type Preflight = { ok: true; rows: number | null; note: string } | { ok: false; message: string };

const IDENT = /^[a-z_][a-z0-9_]*$/;
const HEADER_BYTES = 8192;

/** The first line of a CSV, split on commas, lower-cased, quotes stripped. */
export function csvHeader(head: string): string[] {
  const line = head.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
  return line.split(",").map((c) => c.trim().replace(/^"|"$/g, "").toLowerCase());
}

/** A header cell as a column key: lower case, spaces and dashes to underscores. */
export function headerKey(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Does a header carry a column the lane table can take as email or first_name? Returns what it found. */
export function headerUsable(header: string[]): { email: string | null; first: string | null } {
  const keys = header.map(headerKey);
  const find = (lane: string) => TABLE_COLUMN_SYNONYMS[lane]?.find((n) => keys.includes(n)) ?? null;
  return { email: find("email"), first: find("first_name") };
}

/** What a file calls LeadPipe's canonical columns, when it does not use the canonical name itself. Keys are canonical; values are the file's header cells. */
export const HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  email: ["work_email", "wf_email", "candidate_email", "person_email", "email_address", "business_email"],
  first_name: ["first", "firstname", "given_name"],
  last_name: ["last", "lastname", "surname", "family_name"],
  title: ["job_title", "current_job_title", "owner_title", "current_title", "position"],
  company_name: ["company", "company_n", "current_employer", "organization", "current_company_name", "org_name"],
  company_domain: ["domain", "wf_domain", "website", "company_website", "org_domain"],
  city: ["person_city", "city_name"],
  state: ["region", "person_state", "state_name"],
  industry: ["vertical", "company_industry", "org_industry", "org_industry_linkedin"],
  employee_range: ["company_size", "size_band", "headcount", "employee_count_range", "employees", "org_size"],
};

export function columnMapFor(header: string[]): Record<string, string> {
  const byKey = new Map<string, string>();
  for (const cell of header) if (cell.trim()) byKey.set(headerKey(cell), cell.trim());
  const map: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (byKey.has(canonical)) continue;
    const hit = aliases.find((a) => byKey.has(a));
    if (hit) map[canonical] = byKey.get(hit)!;
  }
  return map;
}

/** The header line of a CSV at a signed URL, read with a Range request. Never more than the first bytes; never a row kept. */
export async function fetchHeader(url: string, fetchImpl: typeof fetch = fetch): Promise<string[] | null> {
  try {
    const res = await fetchImpl(url, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } });
    if (!res.ok) return null;
    return csvHeader((await res.text()).slice(0, HEADER_BYTES));
  } catch {
    return null;
  }
}

export async function preflightPool(
  db: Queryable,
  clientTag: string,
  source: PoolSource,
  fetchImpl: typeof fetch = fetch,
): Promise<Preflight> {
  if (source.kind === "file_url") {
    const notes: string[] = [];
    for (const url of source.urls) {
      let res: Response;
      try {
        res = await fetchImpl(url, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` } });
      } catch (err) {
        return { ok: false, message: `the file could not be fetched (${(err as Error).message}). Export it again and pass the fresh signed URL.` };
      }
      if (!res.ok) return { ok: false, message: `the file URL answered HTTP ${res.status}. A signed URL that expired or a private object: export it again and pass the fresh URL.` };
      const head = (await res.text()).slice(0, HEADER_BYTES);
      const header = csvHeader(head);
      const usable = headerUsable(header);
      if (!usable.email && !usable.first) {
        return { ok: false, message: `the file's first line has no email or first_name column the service recognises (${TABLE_COLUMN_SYNONYMS.email.join(", ")} / ${TABLE_COLUMN_SYNONYMS.first_name.join(", ")}). It has ${header.length} columns. Export with a header row.` };
      }
      notes.push(`${header.length} columns${usable.email ? `, email as ${usable.email}` : ", no email column"}`);
    }
    return { ok: true, rows: null, note: `${source.urls.length} file(s) reachable: ${notes.join("; ")}` };
  }
  const [schema, name] = source.table.split(".");
  if (!schema || !name || !IDENT.test(schema) || !IDENT.test(name)) return { ok: false, message: `table must be schema.table, not ${source.table}` };
  let where: string;
  try {
    where = safeWhere(source.where);
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  const lane = isLaneTable(source.table, clientTag);
  if (lane && where === "true") return { ok: false, message: `${source.table} is the client's own lane table. Pass a where that picks the rows you ingested (for example source_label = 'your label'), not the whole table.` };
  const other = /^lp\.([a-z0-9_]+)_ingested_leads$/.exec(source.table)?.[1] ?? /^client_([a-z0-9_]+)\./.exec(source.table)?.[1] ?? null;
  if (other && other !== clientTag) return { ok: false, message: `${source.table} belongs to client ${other}, not ${clientTag}. A client's leads never move into another client's lane.` };
  const { rows: cols } = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, name]);
  if (cols.length === 0) return { ok: false, message: `${source.table} does not exist on campaignintelligence, or the service cannot read it. Build it in a schema the service can read, or ask Josh to grant select.` };
  const have = new Set(cols.map((c) => c.column_name));
  const usable = { email: TABLE_COLUMN_SYNONYMS.email.find((n) => have.has(n)) ?? null, first: TABLE_COLUMN_SYNONYMS.first_name.find((n) => have.has(n)) ?? null };
  if (!usable.email && !usable.first) return { ok: false, message: `${source.table} has no email or first_name column the service recognises (${TABLE_COLUMN_SYNONYMS.email.join(", ")} / ${TABLE_COLUMN_SYNONYMS.first_name.join(", ")}). It has ${have.size} columns.` };
  let n = 0;
  try {
    const laneTable = ingestedTable(clientTag);
    const sql = lane
      ? `select count(*)::text as n from ${laneTable} where (${where}) and run_id is null`
      : `select count(*)::text as n from "${schema}"."${name}" s where (${where})${usable.email ? ` and not exists (select 1 from ${laneTable} t where lower(t.email) = lower(nullif(btrim(s."${usable.email}"::text), '')))` : ""}`;
    const { rows } = await db.query<{ n: string }>(sql);
    n = Number(rows[0]?.n ?? 0);
  } catch (err) {
    return { ok: false, message: `the where could not run against ${source.table}: ${(err as Error).message}` };
  }
  if (n === 0) {
    return {
      ok: false,
      message: lane
        ? `no unclaimed rows in ${source.table} match that where (rows another job already claimed do not count).`
        : `no row of ${source.table} matches that where, or every email it holds is already in the lane table.`,
    };
  }
  return { ok: true, rows: n, note: `${n} rows in ${source.table} will land` };
}
