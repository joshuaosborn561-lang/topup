import type { Repo } from "../../db/repo.js";
import { columnsOf } from "../common.js";
import { domainSql } from "./classify.js";

/**
 * Shared email-waterfall RPC `ew_read_source` (defined in
 * joshuaosborn561-lang/email-waterfall `supabase/migrations/003_ew_source_rpcs.sql`,
 * used by find-named-person-waterfall `people_waterfall/source.py`) SELECTs
 * the columns it is given. People waterfall's discover map is
 * `domain` / `website` only — not `company_domain` — and
 * `count_source_with_domain` hardcodes `domain is not null`.
 *
 * lp.<tag>_ingested_leads stores the host as `company_domain`. A view that
 * exposes `domain` lets those services read the table without an ALTER on
 * the live lane table and without changing the other repos (D66).
 */
export const EW_VIEW_SUFFIX = "_ew";

const QUALIFIED = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function ewDomainViewName(table: string): string {
  if (!QUALIFIED.test(table)) throw new Error(`not a schema.table: ${table}`);
  return `${table}${EW_VIEW_SUFFIX}`;
}

/** CREATE VIEW SQL. Does not ALTER the base table. Drop first so a new
 *  base column does not make OR REPLACE fail on a changed column list. */
export function ewDomainViewSql(table: string, cols: Set<string>): string {
  const view = ewDomainViewName(table);
  const expr = domainSql(cols, "t.");
  return `create view ${view} as select t.*, ${expr} as domain from ${table} t`;
}

export function ewDomainViewDropSql(table: string): string {
  return `drop view if exists ${ewDomainViewName(table)}`;
}

/**
 * Table name to hand `ew_read_source`. If the lane table already has
 * `domain`, that is the source. Otherwise a sibling view aliases
 * company_domain / website / the email host as `domain`.
 */
export async function ensureEwDomainSource(repo: Repo, table: string): Promise<string> {
  if (!QUALIFIED.test(table)) throw new Error(`not a schema.table: ${table}`);
  const cols = await columnsOf(repo, table);
  if (cols.has("domain")) return table;
  const view = ewDomainViewName(table);
  await repo.raw().query(ewDomainViewDropSql(table));
  await repo.raw().query(ewDomainViewSql(table, cols));
  return view;
}
