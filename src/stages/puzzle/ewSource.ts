import type { Repo } from "../../db/repo.js";
import { columnsOf } from "../common.js";

/**
 * Shared email-waterfall RPC `ew_read_source` (defined in
 * joshuaosborn561-lang/email-waterfall `supabase/migrations/003_ew_source_rpcs.sql`,
 * used by find-named-person-waterfall `people_waterfall/source.py`) SELECTs
 * identifier columns only — no aliases or expressions. People waterfall's
 * FIELD_CANDIDATES map is `domain` / `website` only — not `company_domain` —
 * and `count_source_with_domain` hardcodes `domain is not null`.
 *
 * lp.<tag>_ingested_leads stores the host as `company_domain`. The pre-built
 * view `topup.<tag>_ingested_leads_ew` (migration 0021) aliases that as
 * `domain`. The service looks the view up and never CREATE / DROP / ALTER
 * (D67). No schema grants. If the view is missing, fail and ask Josh.
 *
 * Alternative in the other repo, if Josh prefers that to applying 0021:
 * people_waterfall/source.py add company_domain to FIELD_CANDIDATES['domain']
 * and make count_source_with_domain use the mapped column.
 */
export const EW_VIEW_SUFFIX = "_ew";
export const EW_VIEW_SCHEMA = "topup";

const QUALIFIED = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function ewDomainViewName(table: string): string {
  if (!QUALIFIED.test(table)) throw new Error(`not a schema.table: ${table}`);
  const name = table.split(".")[1]!;
  return `${EW_VIEW_SCHEMA}.${name}${EW_VIEW_SUFFIX}`;
}

/** Legacy D66 name in the source schema. Looked up only; never created. */
export function ewLegacyDomainViewName(table: string): string {
  if (!QUALIFIED.test(table)) throw new Error(`not a schema.table: ${table}`);
  return `${table}${EW_VIEW_SUFFIX}`;
}

export function missingEwViewMessage(table: string): string {
  const view = ewDomainViewName(table);
  return `D67: ${view} is missing. Apply supabase/migrations/0021_ingested_ew_domain_views.sql (Josh). The service does not create relations at runtime. Ask Josh.`;
}

async function relationExists(repo: Repo, qualified: string): Promise<boolean> {
  if (!QUALIFIED.test(qualified)) return false;
  const [schema, name] = qualified.split(".");
  const { rows } = await repo.raw().query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables
      where table_schema = $1 and table_name = $2`,
    [schema, name],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Table name to hand `ew_read_source`. If the lane table already has
 * `domain`, that is the source. Otherwise the pre-built topup view
 * (or a leftover lp.*_ew from D66, if one exists). Never DDL.
 */
export async function resolveEwDomainSource(repo: Repo, table: string): Promise<string> {
  if (!QUALIFIED.test(table)) throw new Error(`not a schema.table: ${table}`);
  const cols = await columnsOf(repo, table);
  if (cols.has("domain")) return table;
  const view = ewDomainViewName(table);
  if (await relationExists(repo, view)) return view;
  const legacy = ewLegacyDomainViewName(table);
  if (await relationExists(repo, legacy)) return legacy;
  throw new Error(missingEwViewMessage(table));
}
