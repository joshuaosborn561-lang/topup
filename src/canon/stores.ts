import type { Queryable } from "../db/pool.js";

/**
 * The stores a client owns: the LeadPipe lane table, the client schema, and
 * the waterfall people tables. Used by the dedupe stage to collect every
 * person the client already has (D98, D99). Counts and identifier columns
 * only; never a row leaves the server.
 */
const IDENT = /^[a-z][a-z0-9_]*$/;

export interface Found {
  schema: string;
  table: string;
  estimate: number;
  columns: Set<string>;
}


/** The stores a client owns: lp.<tag>_*, client_<tag>.*, public.<tag>…_(wf_)?(companies|contacts). The held set reads them all (D98). */
export async function discoverStores(db: Queryable, tag: string): Promise<Found[]> {
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

