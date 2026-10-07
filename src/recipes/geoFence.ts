/**
 * EMCOR (and any receipt that says so) names cities as a table, not a list:
 * "client_emcor.geo_fence (137 cities, ... run in 3 chunks by geo_chunk)".
 * A getleads count with more than 45 cities times out, so each chunk stays
 * at or under that cap. The sentence is never sent as a city name.
 */

export const GEO_CHUNK_MAX = 45;

const IDENT = /^[a-z_][a-z0-9_]*$/;

const CITY_COLUMNS = ["city", "city_name", "name"] as const;
const CHUNK_COLUMNS = ["geo_chunk", "chunk"] as const;

export interface GeoFenceRef {
  schema: string;
  table: string;
}

export interface GeoCity {
  city: string;
  chunk: string | null;
}

/** `schema.table` at the start of a cities note. Anything else is not a fence. */
export function geoFenceRef(value: unknown): GeoFenceRef | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/i);
  if (!match) return null;
  const schema = match[1]!.toLowerCase();
  const table = match[2]!.toLowerCase();
  if (!IDENT.test(schema) || !IDENT.test(table)) return null;
  return { schema, table };
}

/**
 * One city in one chunk. Group by geo_chunk, then split any group over 45.
 * 137 cities land in 3 or 4 chunks.
 */
export function groupGeoChunks(cities: readonly GeoCity[], max = GEO_CHUNK_MAX): string[][] {
  const seen = new Set<string>();
  const groups = new Map<string, string[]>();
  for (const row of cities) {
    const city = row.city.trim();
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const chunk = (row.chunk ?? "").trim();
    const list = groups.get(chunk) ?? [];
    list.push(city);
    groups.set(chunk, list);
  }
  const chunks: string[][] = [];
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i += max) chunks.push(list.slice(i, i + max));
  }
  return chunks;
}

/** Count queries for a fenced list: one filter per chunk, fence pointer removed. */
export function countSlices<T extends { geo_fence?: unknown; cities?: string[] }>(
  filters: T,
  cities: readonly GeoCity[],
): Array<Omit<T, "geo_fence"> & { cities?: string[] }> {
  const { geo_fence: fence, ...rest } = filters;
  if (!fence) return [rest];
  return groupGeoChunks(cities).map((chunk) => ({ ...rest, cities: chunk }));
}

type Queryable = {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`geo fence column is not an identifier: ${name}`);
  return `"${name}"`;
}

/**
 * Cities from the fence table. Column names come from information_schema and
 * an allowlist, never from the receipt sentence.
 */
export async function loadGeoFenceCities(db: Queryable, ref: GeoFenceRef): Promise<GeoCity[]> {
  const schema = ref.schema.toLowerCase();
  const table = ref.table.toLowerCase();
  if (!IDENT.test(schema) || !IDENT.test(table)) throw new Error("geo fence name is not an identifier");
  const { rows: cols } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = $1 and table_name = $2`,
    [schema, table],
  );
  const names = new Set(cols.map((row) => String(row.column_name).toLowerCase()));
  const cityCol = CITY_COLUMNS.find((name) => names.has(name));
  if (!cityCol) throw new Error(`geo fence ${schema}.${table} has no city column`);
  const chunkCol = CHUNK_COLUMNS.find((name) => names.has(name)) ?? null;
  const citySql = quoteIdent(cityCol);
  const chunkSql = chunkCol ? `${quoteIdent(chunkCol)}::text` : "null";
  const { rows } = await db.query<{ city: string | null; chunk: string | null }>(
    `select distinct ${citySql}::text as city, ${chunkSql} as chunk from ${quoteIdent(schema)}.${quoteIdent(table)} where ${citySql} is not null`,
  );
  return rows
    .filter((row) => typeof row.city === "string" && row.city.trim().length > 0)
    .map((row) => ({ city: row.city!.trim(), chunk: row.chunk == null ? null : String(row.chunk) }));
}
