import type { Queryable } from "../db/pool.js";
import { loadClientMap } from "./clients.js";

/**
 * Where past pulls left rows that may never have been sent (D55): the
 * LeadPipe lane table, the client schema (companies, contacts, leads), the
 * waterfall tables, the people-waterfall status rows, and the scratch
 * tables a pull left behind. Counts only, never rows. Nothing is moved by
 * reading this; Grok says which store it means before reusing one.
 */
export type StoreKind = "leadpipe_lane" | "client_schema" | "waterfall" | "people_status" | "scratch";

/**
 * The obvious gap (D55): what the rows have and what they still need, as
 * counts. `need_*` is the number of rows one step away from usable; `next`
 * names that step in the source vocabulary.
 */
export interface StoreGaps {
  /** A person's name but no company domain. */
  need_domain?: number;
  /** A company domain but no person's name. */
  need_person?: number;
  /** A person's name but no email. */
  need_email?: number;
  /** A person (name or email) but no phone. */
  need_phone?: number;
  /** Name, domain and email all present. */
  complete?: number;
  /** False when the table has no column that could hold a phone (D56). */
  phone_column: boolean;
  next: Record<string, string>;
}

export interface StoreLine {
  schema: string;
  table: string;
  kind: StoreKind;
  rows: number;
  /** False when `rows` is the planner's estimate from the last analyze (the long tail of scratch tables is never counted exactly). */
  exact: boolean;
  with_email?: number;
  with_domain?: number;
  with_phone?: number;
  gaps?: StoreGaps;
  by_status?: Record<string, number>;
  by_label?: Record<string, number>;
}

export interface LeftoversClient {
  client_tag: string;
  stores: StoreLine[];
  /** Scratch tables past the first twenty-five, by estimated size. */
  more_scratch_tables: number;
}

export interface LeftoversRead {
  rule: string;
  clients: LeftoversClient[];
  not_reachable: string[];
}

export const LEFTOVERS_RULE =
  "Counts only, never rows. A store here is where a past pull left rows that may not have been sent. gaps says what the rows still need (a domain, a person, an email, a phone) and next names the step that fills it. Reading this moves nothing. Before reusing a store, read campaign_record for the campaign it fed and name the store to the person who approves the pull.";

export const NOT_REACHABLE = [
  "PermitStack and parcel lists live on project kemvxzhcxvynmoutwdrh; ask the Permit & Parcel MCP for counts. Cold call lists are ignored (D54).",
  "getleads and AI Ark keep no store of their own; what was exported from them is in the LeadPipe lane table and the lp scratch tables.",
  "The Maps scraper's own store (google-maps-scraper-leads) is not read here; what was synced to this project is client_<tag>.leads.",
];

const IDENT = /^[a-z][a-z0-9_]*$/;
const STATUS_COLUMNS = ["lead_status", "status", "dl_status", "wf_status", "wf_email_status", "wf_domain_status", "dm_lookup_status", "email_status", "sg_exclude", "suppressed", "imported", "in_icp"] as const;
const EMAIL_COLUMNS = ["email", "wf_email", "candidate_email", "shovels_email"] as const;
const DOMAIN_COLUMNS = ["domain", "wf_domain", "company_domain", "website"] as const;
const NAME_COLUMNS = ["first_name", "last_name", "full_name", "owner_name", "dm_name", "shovels_name"] as const;
const PHONE_COLUMNS = ["phone", "cellphone", "wf_phone", "mobile_phone", "phone_number", "mobile"] as const;
/** What fills each gap, in the words of the `sources` vocabulary. */
const NEXT_STEP: Readonly<Record<string, string>> = {
  need_domain: "domain_waterfall (company name plus location to a domain)",
  need_person: "people_waterfall (named people at the domain; writes cellphone and line_type)",
  need_email: "email_waterfall (getleads, Smartlead, AI Ark, then Prospeo if the ceiling allows), or name_to_email for a handful",
  need_phone: "email_waterfall on the aiark or fullenrich tier finds phones; the people_waterfall contacts table carries cellphone",
};
const LABEL_COLUMNS = ["source_label", "build_label", "run_label", "lane", "source_tool", "source_tier", "source"] as const;
const SCRATCH_SHOWN = 25;

interface Found {
  schema: string;
  table: string;
  estimate: number;
  columns: Set<string>;
}

function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not an identifier: ${name}`);
  return `"${name}"`;
}

async function discover(db: Queryable, tag: string): Promise<Found[]> {
  const { rows } = await db.query<{ table_schema: string; table_name: string; estimate: string | null }>(
    `select t.table_schema, t.table_name,
            greatest(coalesce(s.n_live_tup, 0), coalesce(c.reltuples, 0))::bigint::text as estimate
       from information_schema.tables t
       left join pg_namespace n on n.nspname = t.table_schema
       left join pg_class c on c.relnamespace = n.oid and c.relname = t.table_name
       left join pg_stat_user_tables s on s.schemaname = t.table_schema and s.relname = t.table_name
      where t.table_type = 'BASE TABLE'
        and ((t.table_schema = 'lp' and t.table_name like $1 || '\\_%' escape '\\')
          or t.table_schema = 'client_' || $1
          or (t.table_schema = 'public' and t.table_name ~ ('^' || $1 || '(_[a-z0-9]+)*_(wf_)?(companies|contacts)$')))
      order by 1, 2`,
    [tag],
  );
  const found = rows
    .filter((r) => IDENT.test(r.table_schema) && IDENT.test(r.table_name))
    .map((r) => ({ schema: r.table_schema, table: r.table_name, estimate: Math.max(0, Number(r.estimate ?? 0)), columns: new Set<string>() }));
  if (found.length === 0) return found;
  const { rows: cols } = await db.query<{ table_schema: string; table_name: string; column_name: string }>(
    `select table_schema, table_name, column_name from information_schema.columns
      where (table_schema = 'lp' and table_name like $1 || '\\_%' escape '\\')
         or table_schema = 'client_' || $1
         or (table_schema = 'public' and table_name ~ ('^' || $1 || '(_[a-z0-9]+)*_(wf_)?(companies|contacts)$'))`,
    [tag],
  );
  const byKey = new Map(found.map((f) => [`${f.schema}.${f.table}`, f]));
  for (const c of cols) byKey.get(`${c.table_schema}.${c.table_name}`)?.columns.add(String(c.column_name));
  return found;
}

function kindOf(tag: string, f: Found): StoreKind {
  if (f.schema === "lp" && f.table === `${tag}_ingested_leads`) return "leadpipe_lane";
  if (f.schema === `client_${tag}` && ["companies", "contacts", "leads"].includes(f.table)) return "client_schema";
  if (f.schema === "public") return "waterfall";
  return "scratch";
}

/** Exact counts for one store: rows, rows with an email, rows with a domain, the first status column grouped, the first label column grouped. Values are never selected. */
async function countStore(db: Queryable, f: Found, kind: StoreKind): Promise<StoreLine> {
  const email = EMAIL_COLUMNS.find((c) => f.columns.has(c));
  const domain = DOMAIN_COLUMNS.find((c) => f.columns.has(c));
  const status = STATUS_COLUMNS.find((c) => f.columns.has(c));
  const label = LABEL_COLUMNS.find((c) => f.columns.has(c));
  const names = NAME_COLUMNS.filter((c) => f.columns.has(c));
  const phones = PHONE_COLUMNS.filter((c) => f.columns.has(c));
  const rel = `${q(f.schema)}.${q(f.table)}`;
  const line: StoreLine = { schema: f.schema, table: f.table, kind, rows: f.estimate, exact: false };
  // "has a value" predicates; never the values themselves.
  const has = (cols: readonly string[]) => (cols.length ? `(${cols.map((c) => `coalesce(${q(c)}::text, '') <> ''`).join(" or ")})` : null);
  const hasName = has(names);
  const hasEmail = email ? has([email]) : null;
  const hasDomain = domain ? has([domain]) : null;
  const hasPhone = has(phones);
  try {
    const selects = [`count(*)::text as n`];
    if (hasEmail) selects.push(`count(*) filter (where ${hasEmail})::text as with_email`);
    if (hasDomain) selects.push(`count(*) filter (where ${hasDomain})::text as with_domain`);
    if (hasPhone) selects.push(`count(*) filter (where ${hasPhone})::text as with_phone`);
    if (hasName && hasDomain) selects.push(`count(*) filter (where ${hasName} and not ${hasDomain})::text as need_domain`, `count(*) filter (where ${hasDomain} and not ${hasName})::text as need_person`);
    if (hasName && hasEmail) selects.push(`count(*) filter (where ${hasName} and not ${hasEmail})::text as need_email`);
    if (hasName || hasEmail) selects.push(`count(*) filter (where (${[hasName, hasEmail].filter(Boolean).join(" or ")})${hasPhone ? ` and not ${hasPhone}` : ""})::text as need_phone`);
    if (hasName && hasDomain && hasEmail) selects.push(`count(*) filter (where ${hasName} and ${hasDomain} and ${hasEmail})::text as complete`);
    const { rows } = await db.query<Record<string, string | undefined>>(`select ${selects.join(", ")} from ${rel}`);
    const r = rows[0] ?? {};
    line.rows = Number(r.n ?? 0);
    line.exact = true;
    if (hasEmail) line.with_email = Number(r.with_email ?? 0);
    if (hasDomain) line.with_domain = Number(r.with_domain ?? 0);
    if (hasPhone) line.with_phone = Number(r.with_phone ?? 0);
    if (hasName || hasEmail) {
      const gaps: StoreGaps = { phone_column: phones.length > 0, next: {} };
      for (const k of ["need_domain", "need_person", "need_email", "need_phone", "complete"] as const) {
        if (r[k] !== undefined) gaps[k] = Number(r[k]);
      }
      for (const k of ["need_domain", "need_person", "need_email", "need_phone"] as const) if ((gaps[k] ?? 0) > 0) gaps.next[k] = NEXT_STEP[k]!;
      if (!gaps.phone_column) gaps.next.need_phone = `this table has no phone column; a phone found for these rows has nowhere to land here (D56)`;
      line.gaps = gaps;
    }
    if (status) {
      const { rows: st } = await db.query<{ k: string | null; n: string }>(`select ${q(status)}::text as k, count(*)::text as n from ${rel} group by 1 order by 2 desc limit 12`);
      line.by_status = Object.fromEntries(st.map((r) => [`${status}=${r.k ?? "null"}`, Number(r.n)]));
    }
    if (label) {
      const { rows: lb } = await db.query<{ k: string | null; n: string }>(`select ${q(label)}::text as k, count(*)::text as n from ${rel} group by 1 order by 2 desc limit 10`);
      line.by_label = Object.fromEntries(lb.map((r) => [`${label}=${r.k ?? "null"}`, Number(r.n)]));
    }
  } catch {
    /* the estimate stands; exact stays false */
  }
  return line;
}

async function peopleStatus(db: Queryable, tag: string): Promise<StoreLine | null> {
  try {
    const { rows } = await db.query<{ k: string | null; n: string }>(
      `select status::text as k, count(*)::text as n from public.wf_people_status where client_tag = $1 group by 1 order by 2 desc limit 12`,
      [tag],
    );
    if (rows.length === 0) return null;
    const by = Object.fromEntries(rows.map((r) => [`status=${r.k ?? "null"}`, Number(r.n)]));
    return { schema: "public", table: "wf_people_status", kind: "people_status", rows: Object.values(by).reduce((a, b) => a + b, 0), exact: true, by_status: by };
  } catch {
    return null;
  }
}

export async function leftoversClient(db: Queryable, tag: string): Promise<LeftoversClient> {
  const found = await discover(db, tag);
  const stores: StoreLine[] = [];
  const scratch: Found[] = [];
  for (const f of found) {
    const kind = kindOf(tag, f);
    if (kind === "scratch") scratch.push(f);
    else stores.push(await countStore(db, f, kind));
  }
  const ps = await peopleStatus(db, tag);
  if (ps) stores.push(ps);
  scratch.sort((a, b) => b.estimate - a.estimate);
  for (const f of scratch.slice(0, SCRATCH_SHOWN)) stores.push({ schema: f.schema, table: f.table, kind: "scratch", rows: f.estimate, exact: false });
  return { client_tag: tag, stores, more_scratch_tables: Math.max(0, scratch.length - SCRATCH_SHOWN) };
}

export async function leftoversRead(db: Queryable, clientTag?: string | null): Promise<LeftoversRead | { error: string }> {
  const mapped = await loadClientMap(db).catch(() => []);
  const tags = clientTag ? mapped.filter((c) => c.client_tag === clientTag).map((c) => c.client_tag) : mapped.map((c) => c.client_tag);
  if (clientTag && tags.length === 0) return { error: `${clientTag} is not in topup.client_map. Adding a client is a row in that table. Ask Josh.` };
  const clients: LeftoversClient[] = [];
  for (const tag of tags) {
    if (!IDENT.test(tag)) continue;
    clients.push(await leftoversClient(db, tag));
  }
  return { rule: LEFTOVERS_RULE, clients, not_reachable: NOT_REACHABLE };
}
