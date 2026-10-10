import type { Queryable } from "../db/pool.js";
import { icpCategoryClause, isLaneEIcp, schoolExcludeClause } from "./icpFilter.js";

/**
 * The stored Maps pool (D57, D59, D61, D62). `client_<tag>.maps_raw` scoped
 * by the receipt's `plan_id` and categories. An ICP view named on the
 * receipt is applied when it lives in that client schema. Counts may use
 * companion views; the copy reads the named view or maps_raw, never the
 * companion join. Idempotent on email. Never scoped by ZIP or by
 * client_tag alone. Never writes `dl_status`, `sg_exclude`, or `skip_*`.
 */

/** Postgres SET LOCAL on the copy transaction (D62). Ask Josh if 45s is wrong. */
export const MAPS_COPY_STATEMENT_TIMEOUT_MS = 45_000;
export const MAPS_POOL_NOTE =
  "the stored Maps pool in client_<tag>.maps_raw, scoped by plan_id and categories; a fresh scrape is the Google Maps Scraper MCP";

export const MAPS_NEEDS_PLAN =
  "maps needs plan_id. Receipts scope the stored pool by plan_id, never by ZIP or client_tag alone. Ask Josh.";

const IDENT = /^[a-z][a-z0-9_]*$/;
const CAT_COLUMNS = ["main_category", "source_category", "category"] as const;

export interface MapsPoolSpec {
  plan_id: string;
  categories: string[];
  /** View name in the client schema, e.g. v_lane_e_final. */
  icp_view: string | null;
}

export interface MapsPoolCount {
  pool: number;
  already_live: number;
  already_ingested: number;
  already_contacted: number;
  already_used: number;
  net_new: number;
  filters_used: Record<string, unknown>;
  relation: string;
}

/** Recycle window for maps used/contacted, matching suppress on main (D35). Ask Josh if D63's 6 months should replace this. */
export const MAPS_USED_CONTACT_DAYS = 90;

export function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
}

function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not an identifier: ${name}`);
  return `"${name}"`;
}

/** First non-empty of the listed columns. Job 46b1c941: maps_raw.company
 *  exists and is blank; maps_raw.name is the business name. Picking the
 *  first *existing* column hid the name (D67). */
export function firstNonEmptyColSql(alias: string, cols: string[]): string {
  if (!IDENT.test(alias)) throw new Error(`not an identifier: ${alias}`);
  const parts = cols.map((c) => `nullif(${alias}.${q(c)}::text, '')`);
  if (parts.length === 0) throw new Error("firstNonEmptyColSql needs a column");
  return parts.length === 1 ? parts[0]! : `coalesce(${parts.join(", ")})`;
}

export function clientSchema(tag: string): string {
  if (!IDENT.test(tag)) throw new Error(`client_tag must be snake_case: ${tag}`);
  return `client_${tag}`;
}

function planIdOf(filters: Record<string, unknown>): string | null {
  if (typeof filters.plan_id === "string" && filters.plan_id.trim()) return filters.plan_id.trim();
  if (filters.maps && typeof filters.maps === "object" && !Array.isArray(filters.maps)) {
    const nested = (filters.maps as Record<string, unknown>).plan_id;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

/** Pull a client-schema view name out of icp_view / icp_filter / view. Foreign schemas are refused. */
export function icpViewOf(filters: Record<string, unknown>, clientTag: string): string | null {
  const raw = [filters.icp_view, filters.icp_filter, filters.view]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");
  if (!raw) return null;
  const schema = clientSchema(clientTag);
  const dotted = raw.match(/\b(client_[a-z][a-z0-9_]*)\.(v_[a-z][a-z0-9_]*)\b/);
  if (dotted) {
    if (dotted[1] !== schema) throw new Error(`ICP view ${dotted[1]}.${dotted[2]} is not in ${schema}; ask Josh.`);
    return dotted[2]!;
  }
  const bare = raw.match(/\b(v_[a-z][a-z0-9_]*)\b/);
  return bare?.[1] ?? null;
}

export function mapsPoolFromFilters(filters: Record<string, unknown>, clientTag: string): MapsPoolSpec | { error: string } {
  const plan_id = planIdOf(filters);
  if (!plan_id) return { error: MAPS_NEEDS_PLAN };
  let icp_view: string | null;
  try {
    icp_view = icpViewOf(filters, clientTag);
  } catch (err) {
    return { error: (err as Error).message };
  }
  return { plan_id, categories: strings(filters.categories ?? filters.maps ?? filters.category), icp_view };
}

export function mapsPoolFiltersUsed(spec: MapsPoolSpec): Record<string, unknown> {
  return { plan_id: spec.plan_id, categories: spec.categories, icp_view: spec.icp_view };
}

function stemOf(view: string): string {
  return view.replace(/_final$/, "").replace(/_scored2$/, "").replace(/_scored$/, "");
}

async function relationExists(db: Queryable, schema: string, name: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables
      where table_schema = $1 and table_name = $2`,
    [schema, name],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function columnsOf(db: Queryable, schema: string, name: string): Promise<Set<string>> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = $1 and table_name = $2`,
    [schema, name],
  );
  return new Set(rows.map((r) => String(r.column_name)));
}

function categoryClause(alias: string, cols: Set<string>, categories: string[], param: string): string {
  if (categories.length === 0) return "";
  const hits = CAT_COLUMNS.filter((c) => cols.has(c)).map((c) => `lower(${alias}.${q(c)}) = any(${param}::text[])`);
  return hits.length ? ` and (${hits.join(" or ")})` : "";
}

/** Maps city is often `City, ST`. Take the city token; keep a real state column (D68). */
export function mapsCitySql(alias: string, cols: Set<string>): string | null {
  if (!IDENT.test(alias)) throw new Error(`not an identifier: ${alias}`);
  if (!cols.has("city")) return null;
  return `nullif(btrim(split_part(${alias}.${q("city")}, ',', 1)), '')`;
}

export function mapsStateSql(alias: string, cols: Set<string>): string | null {
  if (!IDENT.test(alias)) throw new Error(`not an identifier: ${alias}`);
  const fromCol = cols.has("state") ? `nullif(btrim(${alias}.${q("state")}), '')` : "";
  const fromCity = cols.has("city")
    ? `nullif(upper(substring(btrim(split_part(${alias}.${q("city")}, ',', 2)) from '^[A-Za-z]{2}')), '')`
    : "";
  if (fromCol && fromCity) return `coalesce(${fromCol}, ${fromCity})`;
  return fromCol || fromCity || null;
}

function planClause(alias: string, cols: Set<string>, param: string): string {
  if (!cols.has("plan_id")) return "";
  const typed = param.includes("::") ? param : `${param}::text`;
  return ` and ${alias}.${q("plan_id")} = ${typed}`;
}

function keepClause(alias: string, cols: Set<string>): string {
  return cols.has("keep_final") ? ` and ${alias}.${q("keep_final")} is true` : "";
}

export type MapsPoolResolved = {
  schema: string;
  fromSql: string;
  params: unknown[];
  cats: string[];
  /** Companion union: plan_id is already in fromSql; do not add a second WHERE. */
  companion: boolean;
};

/**
 * Build the FROM/params for a maps pool count. Exported so tests can send
 * the same SQL to a real Postgres (D59).
 */
export async function resolveMapsPool(
  db: Queryable,
  clientTag: string,
  spec: MapsPoolSpec,
): Promise<MapsPoolResolved | { error: string }> {
  const schema = clientSchema(clientTag);
  if (!(await relationExists(db, schema, "maps_raw"))) {
    return { error: `${schema}.maps_raw is not on this project. A maps count reads the stored pool, not the Maps scraper.` };
  }
  const cats = spec.categories.map((c) => c.toLowerCase());
  const params: unknown[] = [spec.plan_id];
  const catParam = cats.length ? `$${params.push(cats)}` : "";

  if (spec.icp_view) {
    if (!(await relationExists(db, schema, spec.icp_view))) {
      return { error: `${schema}.${spec.icp_view} is not a view or table in this client schema. Ask Josh.` };
    }
    const stem = stemOf(spec.icp_view);
    const companies = `${stem}_companies`;
    const needing = `${stem}_needs_domain`;
    const hasCompanies = await relationExists(db, schema, companies);
    const hasNeeding = await relationExists(db, schema, needing);
    if (hasCompanies && hasNeeding) {
      const cCols = await columnsOf(db, schema, companies);
      const nCols = await columnsOf(db, schema, needing);
      if (cCols.has("place_id") && nCols.has("place_id")) {
        const rawCols = await columnsOf(db, schema, "maps_raw");
        const cPlan = planClause("c", cCols, "$1::text");
        const nPlan = planClause("n", nCols, "$1::text");
        const rawPlan = planClause("m", rawCols, "$1::text");
        const needJoin = !cCols.has("plan_id") || !nCols.has("plan_id");
        // Companion views are the ICP pool (D57). Plan_id stays typed $1::text
        // (D59). D68 re-applies the receipt categories on maps_raw.main_category
        // and drops lane-E schools. Always join maps_raw so those filters bind.
        const joinRaw = `join ${q(schema)}.${q("maps_raw")} m on m.place_id`;
        const planOnRaw = rawCols.has("plan_id") ? planClause("m", rawCols, "$1::text") : rawPlan || cPlan;
        if (needJoin && !rawCols.has("plan_id")) {
          return { error: `${schema}.maps_raw has no plan_id; cannot scope the ICP companions. Ask Josh.` };
        }
        const catOnRaw = icpCategoryClause("m", rawCols, cats, catParam);
        const school = isLaneEIcp(spec.icp_view) ? schoolExcludeClause("m", rawCols) : "";
        const paramsOut: unknown[] = [spec.plan_id];
        if (cats.length && catOnRaw) paramsOut.push(cats);
        return {
          schema,
          fromSql: `(
            select c.place_id as place_id
              from ${q(schema)}.${q(companies)} c
              ${joinRaw} = c.place_id
             where true${planOnRaw}${cPlan}${catOnRaw}${school}
            union
            select n.place_id as place_id
              from ${q(schema)}.${q(needing)} n
              ${joinRaw} = n.place_id
             where true${planOnRaw}${nPlan}${catOnRaw}${school}
          ) pool`,
          params: paramsOut,
          cats,
          companion: true,
        };
      }
    }
    return {
      schema,
      fromSql: `${q(schema)}.${q(spec.icp_view)} pool`,
      params,
      cats,
      companion: false,
    };
  }

  return { schema, fromSql: `${q(schema)}.${q("maps_raw")} pool`, params, cats, companion: false };
}

/** WHERE for a non-companion pool (plan + categories + school). Companion SQL already binds those. */
export async function mapsPoolWhere(db: Queryable, spec: MapsPoolSpec, resolved: MapsPoolResolved): Promise<string> {
  if (resolved.companion) return "";
  const rel = spec.icp_view ?? "maps_raw";
  const cols = await columnsOf(db, resolved.schema, rel);
  const catParam = resolved.cats.length ? `$${resolved.params.length}` : "";
  const catsSql = spec.icp_view
    ? icpCategoryClause("pool", cols, resolved.cats, catParam)
    : categoryClause("pool", cols, resolved.cats, catParam);
  const school = spec.icp_view && isLaneEIcp(spec.icp_view) ? schoolExcludeClause("pool", cols) : "";
  return ` where true${planClause("pool", cols, "$1::text")}${catsSql}${school}${spec.icp_view ? keepClause("pool", cols) : ""}`;
}

/**
 * Count the stored pool, how many leads this plan already loaded, and net new.
 * SELECT count only. Never a lead column.
 */
export async function countMapsPool(db: Queryable, clientTag: string, filters: Record<string, unknown>): Promise<MapsPoolCount | { error: string }> {
  const spec = mapsPoolFromFilters(filters, clientTag);
  if ("error" in spec) return spec;
  const resolved = await resolveMapsPool(db, clientTag, spec);
  if ("error" in resolved) return resolved;
  const where = await mapsPoolWhere(db, spec, resolved);
  const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ${resolved.fromSql}${where}`, resolved.params);
  const pool = Number(rows[0]?.n ?? 0);
  const used = await countMapsUsedParts(db, clientTag, spec.plan_id, resolved, where);
  return {
    pool,
    already_live: used.already_live,
    already_ingested: used.already_ingested,
    already_contacted: used.already_contacted,
    already_used: used.already_used,
    net_new: Math.max(0, pool - used.already_used),
    filters_used: mapsPoolFiltersUsed(spec),
    relation: spec.icp_view ? `${resolved.schema}.${spec.icp_view}` : `${resolved.schema}.maps_raw`,
  };
}

export interface MapsUsedParts {
  already_live: number;
  already_ingested: number;
  already_contacted: number;
  already_used: number;
}

/**
 * Used components for a maps pool (D64). Counts only. Union of pool emails
 * already live on the receipt's campaigns, already in the ingest table, or
 * already contacted / on public.suppression for this client (90 days).
 */
export async function countMapsUsedParts(
  db: Queryable,
  clientTag: string,
  planId: string,
  resolved: MapsPoolResolved,
  where: string,
): Promise<MapsUsedParts> {
  const liveOnly = await countAlreadyUsed(db, clientTag, planId);
  const fallback: MapsUsedParts = { already_live: liveOnly, already_ingested: 0, already_contacted: 0, already_used: liveOnly };
  const destTable = `${clientTag}_ingested_leads`;
  if (!IDENT.test(destTable)) return fallback;
  try {
    const rawCols = await columnsOf(db, resolved.schema, "maps_raw");
    if (!rawCols.has("email") || !rawCols.has("place_id")) return fallback;
    const emailExpr = "nullif(btrim(m.email), '')";
    const joinRaw = `left join ${q(resolved.schema)}.${q("maps_raw")} m on m.place_id = pool.place_id`;
    const tagParam = `$${resolved.params.length + 1}`;
    const { rows } = await db.query<{ already_live: string; already_ingested: string; already_contacted: string; already_used: string }>(
      `with pool_emails as (
         select distinct lower(${emailExpr}) as e
           from ${resolved.fromSql}
           ${joinRaw}
           ${where}
       ),
       emails as (select e from pool_emails where e is not null and position('@' in e) > 0)
       select
         (select count(*)::text from emails e where exists (
            select 1 from public.leads l
            join public.campaigns c on c.id = l.campaign_id
            where lower(l.email) = e.e
              and c.smartlead_campaign_id in (
                select distinct x::bigint
                  from topup.pull_receipts r,
                       unnest(coalesce(r.campaign_ids, '{}'::bigint[])) x
                 where r.client_tag = ${tagParam}
                   and r.company_filters->>'plan_id' = $1::text
              )
         )) as already_live,
         (select count(*)::text from emails e where exists (
            select 1 from ${q("lp")}.${q(destTable)} h where lower(h.email) = e.e
         )) as already_ingested,
         (select count(*)::text from emails e where exists (
            select 1 from public.leads l
            join public.sends s on s.lead_id = l.id
            join topup.client_map cm on cm.smartlead_client_id = l.smartlead_client_id
            where lower(l.email) = e.e and cm.client_tag = ${tagParam}
              and s.sent and s.sent_at is not null
              and s.sent_at >= now() - interval '${MAPS_USED_CONTACT_DAYS} days'
         ) or exists (
            select 1 from public.suppression s where lower(s.email) = e.e
         )) as already_contacted,
         (select count(*)::text from emails e where exists (
            select 1 from public.leads l
            join public.campaigns c on c.id = l.campaign_id
            where lower(l.email) = e.e
              and c.smartlead_campaign_id in (
                select distinct x::bigint
                  from topup.pull_receipts r,
                       unnest(coalesce(r.campaign_ids, '{}'::bigint[])) x
                 where r.client_tag = ${tagParam}
                   and r.company_filters->>'plan_id' = $1::text
              )
         ) or exists (
            select 1 from ${q("lp")}.${q(destTable)} h where lower(h.email) = e.e
         ) or exists (
            select 1 from public.leads l
            join public.sends s on s.lead_id = l.id
            join topup.client_map cm on cm.smartlead_client_id = l.smartlead_client_id
            where lower(l.email) = e.e and cm.client_tag = ${tagParam}
              and s.sent and s.sent_at is not null
              and s.sent_at >= now() - interval '${MAPS_USED_CONTACT_DAYS} days'
         ) or exists (
            select 1 from public.suppression s where lower(s.email) = e.e
         )) as already_used`,
      [...resolved.params, clientTag],
    );
    const row = rows[0];
    if (!row) return fallback;
    return {
      already_live: Number(row.already_live ?? 0),
      already_ingested: Number(row.already_ingested ?? 0),
      already_contacted: Number(row.already_contacted ?? 0),
      already_used: Number(row.already_used ?? 0),
    };
  } catch {
    return fallback;
  }
}

/** Leads already on campaigns named by a receipt that carries this plan_id. Counts only. */
export async function countAlreadyUsed(db: Queryable, clientTag: string, planId: string): Promise<number> {
  try {
    const { rows } = await db.query<{ n: string }>(
      `select count(*)::text as n
         from public.leads l
         join public.campaigns c on c.id = l.campaign_id
        where c.smartlead_campaign_id in (
          select distinct x::bigint
            from topup.pull_receipts r,
                 unnest(coalesce(r.campaign_ids, '{}'::bigint[])) x
           where r.client_tag = $1
             and r.company_filters->>'plan_id' = $2
        )`,
      [clientTag, planId],
    );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

export interface MapsPoolCopy {
  client_tag: string;
  filters: Record<string, unknown>;
  max_rows: number;
  source_label: string;
  run_id: string;
  /** Override for tests. Live default is MAPS_COPY_STATEMENT_TIMEOUT_MS. */
  statementTimeoutMs?: number;
}

export interface MapsCopyResult {
  inserted: number;
  already_held: number;
}

async function destEmailUnique(db: Queryable, schema: string, table: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from pg_indexes
      where schemaname = $1 and tablename = $2
        and indexdef ~* 'unique'
        and indexdef ~* '\\(email\\)'`,
    [schema, table],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * Copy up to max_rows from the stored pool into lp.<tag>_ingested_leads.
 * INSERT … SELECT only; no row is returned to the caller. Reads the named
 * ICP view (or maps_raw), never the companion-view join (D62). Skips
 * emails already in the table *before* LIMIT so successive pulls advance
 * (D64). Dedupes the batch on email (ON CONFLICT only when a unique email
 * index exists). already_held is dest∩pool before insert. The copy
 * transaction has a statement timeout (D62). Does not touch dl_status,
 * sg_exclude, or skip_* on the pool.
 */
export async function copyMapsPool(
  db: Queryable & { withRun: <T>(runId: string, fn: (tx: Queryable) => Promise<T>) => Promise<T> },
  input: MapsPoolCopy,
): Promise<MapsCopyResult> {
  const spec = mapsPoolFromFilters(input.filters, input.client_tag);
  if ("error" in spec) throw new Error(spec.error);
  const schema = clientSchema(input.client_tag);
  const destSchema = "lp";
  const destTable = `${input.client_tag}_ingested_leads`;
  if (!IDENT.test(destTable)) throw new Error(`not an identifier: ${destTable}`);
  if (!(await relationExists(db, destSchema, destTable))) {
    throw new Error(`${destSchema}.${destTable} is missing; ingest has nowhere to land the stored pool`);
  }
  const sourceName = spec.icp_view && (await relationExists(db, schema, spec.icp_view)) ? spec.icp_view : "maps_raw";
  if (!(await relationExists(db, schema, sourceName))) throw new Error(`${schema}.${sourceName} is missing`);
  const srcCols = await columnsOf(db, schema, sourceName);
  const destCols = await columnsOf(db, destSchema, destTable);
  const cats = spec.categories.map((c) => c.toLowerCase());
  const params: unknown[] = [spec.plan_id];
  const catParam = cats.length ? `$${params.push(cats)}` : "";
  const labelParam = `$${params.push(input.source_label)}`;
  const limitParam = `$${params.push(input.max_rows)}`;
  const icp = Boolean(spec.icp_view && sourceName === spec.icp_view);
  const catsSql = icp ? icpCategoryClause("s", srcCols, cats, catParam) : categoryClause("s", srcCols, cats, catParam);
  const school = icp && isLaneEIcp(spec.icp_view) ? schoolExcludeClause("s", srcCols) : "";
  const where = `true${planClause("s", srcCols, "$1::text")}${catsSql}${school}${icp ? keepClause("s", srcCols) : ""}`;

  const map: Array<[string, string]> = [];
  const pick = (dest: string, ...src: string[]) => {
    if (!destCols.has(dest)) return;
    const have = src.filter((c) => srcCols.has(c));
    if (have.length) map.push([dest, firstNonEmptyColSql("s", have)]);
  };
  pick("first_name", "first_name");
  pick("last_name", "last_name");
  pick("email", "email");
  pick("title", "title", "owner_title");
  pick("company_name", "company", "name", "title");
  pick("company_domain", "domain");
  {
    const citySql = mapsCitySql("s", srcCols);
    if (destCols.has("city") && citySql) map.push(["city", citySql]);
    else pick("city", "city");
    const stateSql = mapsStateSql("s", srcCols);
    if (destCols.has("state") && stateSql) map.push(["state", stateSql]);
    else pick("state", "state");
  }
  pick("industry", "main_category", "source_category", "category");
  if (destCols.has("source_label")) map.push(["source_label", labelParam]);
  if (map.length === 0) throw new Error(`${schema}.${sourceName} has no columns the ingest table can take`);

  // Named ICP view or maps_raw only. The companion union is a count path
  // (D57, D59). That join re-evaluates the regex views and cannot stop at
  // LIMIT 2000 (job 44fa45d9, D62).
  const fromWhere = `from ${q(schema)}.${q(sourceName)} s where ${where}`;
  const destRef = `${q(destSchema)}.${q(destTable)}`;
  const destColsSql = map.map(([d]) => q(d)).join(", ");
  const selectExprs = map.map(([d, expr]) => `${expr} as ${q(d)}`).join(", ");
  const hasEmail = map.some(([d]) => d === "email");
  const conflict = hasEmail && (await destEmailUnique(db, destSchema, destTable));
  const timeoutMs = Math.max(1, Math.floor(input.statementTimeoutMs ?? MAPS_COPY_STATEMENT_TIMEOUT_MS));

  const sql = hasEmail
    ? `with scoped as (
        select ${selectExprs}
          ${fromWhere}
      ),
      already as (
        select count(distinct s.email)::text as n from scoped s
         where s.email is not null and exists (
           select 1 from ${destRef} held where held.email is not distinct from s.email
         )
      ),
      eligible as (
        select * from scoped s
         where s.email is null or not exists (
           select 1 from ${destRef} held where held.email is not distinct from s.email
         )
      ),
      deduped as (
        select distinct on (email) * from eligible order by email nulls last
        limit ${limitParam}
      ),
      ins as (
        insert into ${destRef} (${destColsSql})
        select ${destColsSql} from deduped d
        ${conflict ? "on conflict (email) do nothing" : ""}
        returning 1
      )
      select (select count(*)::text from ins) as inserted,
             (select n from already) as already_held`
    : `insert into ${destRef} (${destColsSql})
        select ${map.map(([, expr]) => expr).join(", ")}
          ${fromWhere}
         limit ${limitParam}`;

  return db.withRun(input.run_id, async (tx) => {
    await tx.query(`set local statement_timeout = ${timeoutMs}`);
    const result = await tx.query<{ already_held?: string; inserted?: string }>(sql, params);
    if (hasEmail) {
      const inserted = Number(result.rows[0]?.inserted ?? 0);
      const already_held = Number(result.rows[0]?.already_held ?? 0);
      return { inserted, already_held };
    }
    const inserted = result.rowCount ?? 0;
    return { inserted, already_held: 0 };
  });
}
