import type { Queryable } from "../db/pool.js";
import { discoverStores } from "./leftovers.js";

/**
 * Identifiers this client already holds (D98). Email first; LinkedIn URL
 * or normalized name+company when a row has no email. Values stay in
 * memory and are never logged.
 */
export interface HeldKeys {
  emails: Set<string>;
  linkedins: Set<string>;
  nameCompanies: Set<string>;
}

export interface PoolRow {
  email: string | null;
  linkedin: string | null;
  first: string | null;
  last: string | null;
  company: string | null;
}

export const HELD_EXPORT_COLUMNS = ["work_email", "linkedin_url", "first_name", "last_name", "company_name"] as const;

const IDENT = /^[a-z][a-z0-9_]*$/;
const EMAIL_COLUMNS = ["email", "work_email", "wf_email", "candidate_email", "person_email"] as const;
const LINKEDIN_COLUMNS = ["linkedin_url", "linkedin_profile", "linkedin"] as const;
const FIRST_COLUMNS = ["first_name", "first_name_n"] as const;
const LAST_COLUMNS = ["last_name"] as const;
const COMPANY_COLUMNS = ["company_n", "company_name", "company"] as const;

function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not an identifier: ${name}`);
  return `"${name}"`;
}

export function emptyHeldKeys(): HeldKeys {
  return { emails: new Set(), linkedins: new Set(), nameCompanies: new Set() };
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** linkedin.com/in/slug, protocol and trailing slash stripped. */
export function normalizeLinkedin(raw: string | null | undefined): string | null {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = (s.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  if (!s.includes("linkedin.com/")) return null;
  return s;
}

export function normalizeNameCompany(
  first: string | null | undefined,
  last: string | null | undefined,
  company: string | null | undefined,
): string | null {
  const f = foldPerson(first);
  const l = foldPerson(last);
  const c = foldPerson(company);
  if (!f || !l || !c) return null;
  return `${f}|${l}|${c}`;
}

function foldPerson(raw: string | null | undefined): string {
  return (raw ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function addHeldRow(
  keys: HeldKeys,
  email: string | null | undefined,
  linkedin: string | null | undefined,
  first: string | null | undefined,
  last: string | null | undefined,
  company: string | null | undefined,
): void {
  const e = normalizeEmail(email);
  if (e) keys.emails.add(e);
  const li = normalizeLinkedin(linkedin);
  if (li) keys.linkedins.add(li);
  const nc = normalizeNameCompany(first, last, company);
  if (nc) keys.nameCompanies.add(nc);
}

/**
 * A pool row is held when any of its identifiers hit the client set.
 * Email is the first key; LinkedIn and name+company cover rows with no
 * address (D98).
 */
export function rowIsHeld(row: PoolRow, keys: HeldKeys): boolean {
  const email = normalizeEmail(row.email);
  if (email && keys.emails.has(email)) return true;
  const linkedin = normalizeLinkedin(row.linkedin);
  if (linkedin && keys.linkedins.has(linkedin)) return true;
  const nc = normalizeNameCompany(row.first, row.last, row.company);
  return Boolean(nc && keys.nameCompanies.has(nc));
}

export function rowHasEmail(row: PoolRow): boolean {
  return normalizeEmail(row.email) != null;
}

/** Parse an identifier CSV. Addresses stay in memory. Quoted newlines stay in-field. */
export function poolRowsFromCsv(text: string): PoolRow[] {
  const table = parseCsv(text);
  if (table.length < 2) return [];
  const header = table[0]!.map((cell) => cell.trim().toLowerCase());
  const emailIdx = header.findIndex((cell) => cell === "email" || cell === "work_email" || cell === "person_email");
  const liIdx = header.findIndex((cell) => cell === "linkedin_url" || cell === "linkedin_profile" || cell === "linkedin");
  const firstIdx = header.findIndex((cell) => cell === "first_name");
  const lastIdx = header.findIndex((cell) => cell === "last_name");
  const companyIdx = header.findIndex(
    (cell) => cell === "company_name" || cell === "current_employer" || cell === "company",
  );
  if (emailIdx < 0 && liIdx < 0 && (firstIdx < 0 || lastIdx < 0 || companyIdx < 0)) return [];
  const out: PoolRow[] = [];
  for (const cells of table.slice(1)) {
    out.push({
      email: cellAt(cells, emailIdx),
      linkedin: cellAt(cells, liIdx),
      first: cellAt(cells, firstIdx),
      last: cellAt(cells, lastIdx),
      company: cellAt(cells, companyIdx),
    });
  }
  return out;
}

function cellAt(cells: string[], idx: number): string | null {
  if (idx < 0) return null;
  const v = (cells[idx] ?? "").trim();
  return v.length ? v : null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur);
    if (row.some((c) => c.trim().length > 0)) rows.push(row);
  }
  return rows;
}

async function clientTagFor(db: Queryable, clientId: number): Promise<string | null> {
  try {
    const { rows } = await db.query<{ client_tag: string }>(
      `select client_tag from topup.client_map where smartlead_client_id = $1 limit 1`,
      [clientId],
    );
    return rows[0]?.client_tag ?? null;
  } catch {
    return null;
  }
}

async function tableExists(db: Queryable, qual: string): Promise<boolean> {
  const { rows } = await db.query<{ n: boolean }>(`select to_regclass($1) is not null as n`, [qual]);
  return Boolean(rows[0]?.n);
}

/**
 * Every lead this client already has: Smartlead mirror, staging, sends
 * (via the mirror), provenance, DNC, the lane ingest table, and the
 * client / waterfall people stores. Generic: no per-client list.
 */
export async function loadHeldKeys(db: Queryable, clientId: number, clientTag?: string | null): Promise<HeldKeys> {
  const keys = emptyHeldKeys();
  const tag = (clientTag && IDENT.test(clientTag) ? clientTag : null) ?? (await clientTagFor(db, clientId));

  if (await tableExists(db, "public.leads")) {
    const { rows } = await db.query<{ email: string | null; first: string | null; last: string | null; company: string | null }>(
      `select l.email, l.first_name as first, l.last_name as last, l.company
         from public.leads l
        where l.smartlead_client_id = $1`,
      [clientId],
    );
    for (const r of rows) addHeldRow(keys, r.email, null, r.first, r.last, r.company);
  }

  if (await tableExists(db, "public.leads_staging") && (await tableExists(db, "public.campaigns"))) {
    const { rows } = await db.query<{
      email: string | null;
      linkedin: string | null;
      first: string | null;
      last: string | null;
      company: string | null;
    }>(
      `select s.email, s.linkedin_profile as linkedin,
              coalesce(s.first_name_n, s.first_name) as first,
              s.last_name as last,
              coalesce(s.company_n, s.company_name) as company
         from public.leads_staging s
         join public.campaigns c on c.smartlead_campaign_id = s.campaign_id
        where c.smartlead_client_id = $1`,
      [clientId],
    );
    for (const r of rows) addHeldRow(keys, r.email, r.linkedin, r.first, r.last, r.company);
  }

  if (await tableExists(db, "public.suppression")) {
    const { rows } = await db.query<{
      email: string | null;
      first: string | null;
      last: string | null;
      company: string | null;
    }>(`select email, first_name as first, last_name as last, company from public.suppression`);
    for (const r of rows) addHeldRow(keys, r.email, null, r.first, r.last, r.company);
  }

  if (tag && (await tableExists(db, "topup.lead_provenance"))) {
    const { rows } = await db.query<{ email: string | null }>(
      `select email from topup.lead_provenance where client_tag = $1`,
      [tag],
    );
    for (const r of rows) addHeldRow(keys, r.email, null, null, null, null);
  }

  if (tag) await loadStoreKeys(db, tag, keys);
  return keys;
}

function storeIsHeldPeople(tag: string, schema: string, table: string): boolean {
  if (table.includes("maps_raw")) return false;
  if (table === "companies" || table.endsWith("_companies")) return false;
  if (schema === "lp" && table === `${tag}_ingested_leads`) return true;
  if (schema === `client_${tag}` && (table === "leads" || table === "contacts")) return true;
  if (schema === "public" && new RegExp(`^${tag}(_[a-z0-9]+)*_(wf_)?contacts$`).test(table)) return true;
  return false;
}

async function loadStoreKeys(db: Queryable, tag: string, keys: HeldKeys): Promise<void> {
  const stores = await discoverStores(db, tag);
  for (const f of stores) {
    if (!storeIsHeldPeople(tag, f.schema, f.table)) continue;
    const emailCol = EMAIL_COLUMNS.find((c) => f.columns.has(c));
    const liCol = LINKEDIN_COLUMNS.find((c) => f.columns.has(c));
    const firstCol = FIRST_COLUMNS.find((c) => f.columns.has(c));
    const lastCol = LAST_COLUMNS.find((c) => f.columns.has(c));
    const companyCol = COMPANY_COLUMNS.find((c) => f.columns.has(c));
    if (!emailCol && !liCol && !(firstCol && lastCol && companyCol)) continue;
    const emailSql = emailCol ? `${q(emailCol)}::text` : "null::text";
    const liSql = liCol ? `${q(liCol)}::text` : "null::text";
    const firstSql = firstCol ? `${q(firstCol)}::text` : "null::text";
    const lastSql = lastCol ? `${q(lastCol)}::text` : "null::text";
    const companySql = companyCol ? `${q(companyCol)}::text` : "null::text";
    const { rows } = await db.query<{
      email: string | null;
      linkedin: string | null;
      first: string | null;
      last: string | null;
      company: string | null;
    }>(
      `select ${emailSql} as email, ${liSql} as linkedin, ${firstSql} as first, ${lastSql} as last, ${companySql} as company
         from ${q(f.schema)}.${q(f.table)}`,
    );
    for (const r of rows) addHeldRow(keys, r.email, r.linkedin, r.first, r.last, r.company);
  }
}
