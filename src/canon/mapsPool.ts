import type { Queryable } from "../db/pool.js";

/**
 * The stored Maps pool (D57, D59, D61). `client_<tag>.maps_raw` scoped by the
 * receipt's `plan_id` and categories. An ICP view named on the receipt
 * is applied when it lives in that client schema. Counts only. The copy
 * into the ingest table is idempotent on email. Never scoped by ZIP or
 * by client_tag alone. Never writes `dl_status`, `sg_exclude`, or `skip_*`.
 */
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
  already_used: number;
  net_new: number;
  filters_used: Record<string, unknown>;
  relation: string;
}

export function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
}

function q(name: string): string {
  if (!IDENT.test(name)) throw new Error(`not an identifier: ${name}`);
  return `"${name}"`;
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
        // Companion views are the ICP pool (D57). Do not re-apply scrape
        // categories on them — that uses $2 and, when they have no plan_id,
        // leaves $1 untyped (D59). Scope plan_id on maps_raw instead.
        if (needJoin) {
          if (!rawPlan) {
            return { error: `${schema}.maps_raw has no plan_id; cannot scope the ICP companions. Ask Josh.` };
          }
          return {
            schema,
            fromSql: `(
            select c.place_id as place_id
              from ${q(schema)}.${q(companies)} c
              join ${q(schema)}.${q("maps_raw")} m on m.place_id = c.place_id
             where true${rawPlan}${cPlan}
            union
            select n.place_id as place_id
              from ${q(schema)}.${q(needing)} n
              join ${q(schema)}.${q("maps_raw")} m on m.place_id = n.place_id
             where true${rawPlan}${nPlan}
          ) pool`,
            params: [spec.plan_id],
            cats: [],
            companion: true,
          };
        }
        return {
          schema,
          fromSql: `(
            select c.place_id as place_id from ${q(schema)}.${q(companies)} c where true${cPlan}
            union
            select n.place_id as place_id from ${q(schema)}.${q(needing)} n where true${nPlan}
          ) pool`,
          params: [spec.plan_id],
          cats: [],
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

/**
 * Count the stored pool, how many leads this plan already loaded, and net new.
 * SELECT count only. Never a lead column.
 */
export async function countMapsPool(db: Queryable, clientTag: string, filters: Record<string, unknown>): Promise<MapsPoolCount | { error: string }> {
  const spec = mapsPoolFromFilters(filters, clientTag);
  if ("error" in spec) return spec;
  const resolved = await resolveMapsPool(db, clientTag, spec);
  if ("error" in resolved) return resolved;
  const catParam = resolved.cats.length ? `$${resolved.params.length}` : "";
  let where = "";
  if (!resolved.companion) {
    const rel = spec.icp_view ?? "maps_raw";
    const cols = await columnsOf(db, resolved.schema, rel);
    where = ` where true${planClause("pool", cols, "$1::text")}${categoryClause("pool", cols, resolved.cats, catParam)}${spec.icp_view ? keepClause("pool", cols) : ""}`;
  }
  const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ${resolved.fromSql}${where}`, resolved.params);
  const pool = Number(rows[0]?.n ?? 0);
  const already_used = await countAlreadyUsed(db, clientTag, spec.plan_id);
  return {
    pool,
    already_used,
    net_new: Math.max(0, pool - already_used),
    filters_used: mapsPoolFiltersUsed(spec),
    relation: spec.icp_view ? `${resolved.schema}.${spec.icp_view}` : `${resolved.schema}.maps_raw`,
  };
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
 * INSERT … SELECT only; no row is returned to the caller. Dedupes the
 * batch on email and skips emails already in the table (ON CONFLICT DO
 * NOTHING). Skipped rows count as already_held (D61). Does not touch
 * dl_status, sg_exclude, or skip_* on the pool.
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
  const companions = spec.icp_view
    ? { companies: `${stemOf(spec.icp_view)}_companies`, needing: `${stemOf(spec.icp_view)}_needs_domain` }
    : null;
  const useCompanions = Boolean(
    companions
    && (await relationExists(db, schema, companions.companies))
    && (await relationExists(db, schema, companions.needing)),
  );
  const catParam = !useCompanions && cats.length ? `$${params.push(cats)}` : "";
  const labelParam = `$${params.push(input.source_label)}`;
  const limitParam = `$${params.push(input.max_rows)}`;
  const where = `true${planClause("s", srcCols, "$1::text")}${categoryClause("s", srcCols, useCompanions ? [] : cats, catParam)}${!useCompanions && spec.icp_view && sourceName === spec.icp_view ? keepClause("s", srcCols) : ""}`;

  const map: Array<[string, string]> = [];
  const pick = (dest: string, ...src: string[]) => {
    if (!destCols.has(dest)) return;
    const col = src.find((c) => srcCols.has(c));
    if (col) map.push([dest, `nullif(s.${q(col)}::text, '')`]);
  };
  pick("first_name", "first_name");
  pick("last_name", "last_name");
  pick("email", "email");
  pick("title", "title", "owner_title");
  pick("company_name", "company", "name");
  pick("company_domain", "domain");
  pick("city", "city");
  pick("state", "state");
  pick("industry", "main_category", "source_category", "category");
  if (destCols.has("source_label")) map.push(["source_label", labelParam]);
  if (map.length === 0) throw new Error(`${schema}.${sourceName} has no columns the ingest table can take`);

  // Companion views (companies ∪ needs_domain) when the named ICP view has them.
  let fromWhere = `from ${q(schema)}.${q(sourceName)} s where ${where}`;
  if (useCompanions && companions) {
    const { companies, needing } = companions;
    const rawCols = await columnsOf(db, schema, "maps_raw");
    const rawPlan = planClause("m", rawCols, "$1::text");
    fromWhere = `from ${q(schema)}.${q("maps_raw")} s
        where s.place_id in (
          select c.place_id from ${q(schema)}.${q(companies)} c
            join ${q(schema)}.${q("maps_raw")} m on m.place_id = c.place_id
           where true${rawPlan}
          union
          select n.place_id from ${q(schema)}.${q(needing)} n
            join ${q(schema)}.${q("maps_raw")} m on m.place_id = n.place_id
           where true${rawPlan}
        )
        and ${where}`;
  }

  const destColsSql = map.map(([d]) => q(d)).join(", ");
  const selectExprs = map.map(([d, expr]) => `${expr} as ${q(d)}`).join(", ");
  const hasEmail = map.some(([d]) => d === "email");
  const conflict = hasEmail && (await destEmailUnique(db, destSchema, destTable));

  const sql = hasEmail
    ? `with windowed as (
        select ${selectExprs}
          ${fromWhere}
         limit ${limitParam}
      ),
      deduped as (
        select distinct on (email) * from windowed order by email nulls last
      ),
      ins as (
        insert into ${q(destSchema)}.${q(destTable)} (${destColsSql})
        select ${destColsSql} from deduped
        ${conflict ? "on conflict (email) do nothing" : ""}
        returning 1
      )
      select (select count(*)::text from windowed) as windowed,
             (select count(*)::text from ins) as inserted`
    : `insert into ${q(destSchema)}.${q(destTable)} (${destColsSql})
        select ${map.map(([, expr]) => expr).join(", ")}
          ${fromWhere}
         limit ${limitParam}`;

  return db.withRun(input.run_id, async (tx) => {
    const result = await tx.query<{ windowed?: string; inserted?: string }>(sql, params);
    if (hasEmail) {
      const windowed = Number(result.rows[0]?.windowed ?? 0);
      const inserted = Number(result.rows[0]?.inserted ?? 0);
      return { inserted, already_held: Math.max(0, windowed - inserted) };
    }
    const inserted = result.rowCount ?? 0;
    return { inserted, already_held: 0 };
  });
}
