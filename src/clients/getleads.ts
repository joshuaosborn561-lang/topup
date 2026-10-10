import { GEO_CHUNK_MAX } from "../recipes/geoFence.js";
import { GETLEADS_BANDS, type Recipe } from "../recipes/schema.js";
import { McpHttpClient } from "./mcpHttp.js";

/**
 * getleads (hosted MCP; docs/servers.md §11). Included plan: every call here
 * is $0 and still gets a ledger row. Only three tools are ever called:
 * `count_contacts` (step 2), `export_contacts` and `check_contact_export`
 * (step 3). Nothing here returns a contact; an export is a URL and a count.
 * Grok bot must not call these (D39) — the Railway service does, server-side.
 *
 * The brief's getleads rules are enforced by the recipe schema before a
 * filter reaches this file: headcount is band labels, industries are
 * official getleads names (LinkedIn commas map to semicolons; D74),
 * `email_status` omitted pulls every status (D35 item 15).
 * `assertGetleadsFilters` also refuses band labels plus a numeric
 * employee bound (D34). `outboundFilters` sends count keys only:
 * exact band labels, never `max_per_company` (D43).
 */
export type GetleadsFilters = Recipe["source"] extends infer S ? (S extends { kind: "getleads"; params: infer P } ? P : never) : never;

export interface CountResult {
  total_matching: number;
  exportable_rows: number | null;
}

export interface ExportStarted {
  export_id: string;
  /** More than one when a count timeout was retried as separate slices. */
  export_ids?: string[];
}

export interface ExportStatus {
  job_status: string;
  export_url: string | null;
  rows_exported: number | null;
  rows_available: number | null;
  cap_reason: string | null;
  cap_message: string | null;
}

export interface Getleads {
  count(filters: GetleadsFilters): Promise<CountResult>;
  startExport(filters: GetleadsFilters, opts: { max_rows: number; max_per_company?: number; columns?: string[] }): Promise<ExportStarted>;
  checkExport(exportId: string): Promise<ExportStatus>;
}

/** Statuses `check_contact_export` reports once the file is ready. Not in the schema; confirmed on the first real job (servers.md §11). */
export const EXPORT_DONE = ["completed", "complete", "done", "finished", "succeeded", "success", "ready"];
export const EXPORT_FAILED = ["failed", "error", "errored", "cancelled", "canceled"];

/** The band labels a recipe does not name, for the partition check in step 2. */
export function bandComplement(bands: readonly string[]): string[] {
  return GETLEADS_BANDS.filter((b) => !bands.includes(b));
}

/** getleads says this when export_contacts or count_contacts times out on a wide query. */
export function isCountTimeout(message: string): boolean {
  return /count_timeout|count timed out/i.test(message);
}

/** How many times a timed-out query may be halved. The same wide query is not sent again. */
export const MAX_SPLIT_DEPTH = 4;

/** City lists over 45 time out. Each chunk stays at or under that cap. */
export function chunkCities(filters: GetleadsFilters, max = GEO_CHUNK_MAX): GetleadsFilters[] {
  const cities = filters.cities ?? [];
  if (cities.length <= max) return [filters];
  const out: GetleadsFilters[] = [];
  for (let i = 0; i < cities.length; i += max) out.push({ ...filters, cities: cities.slice(i, i + max) });
  return out;
}

/**
 * Half the largest list. Ties keep company_size, then cities, then industries, then titles.
 * An empty result means the query cannot be split, so the caller does not retry it as-is.
 */
export function splitGetleadsQuery(filters: GetleadsFilters): GetleadsFilters[] {
  const lists: Array<{ key: "company_size" | "cities" | "industries" | "job_titles"; values: string[] }> = [
    { key: "company_size", values: [...(filters.company_size ?? [])] },
    { key: "cities", values: [...(filters.cities ?? [])] },
    { key: "industries", values: [...(filters.industries ?? [])] },
    { key: "job_titles", values: [...(filters.job_titles ?? [])] },
  ];
  let best: (typeof lists)[number] | null = null;
  for (const list of lists) {
    if (list.values.length > 1 && (best === null || list.values.length > best.values.length)) best = list;
  }
  if (!best) return [];
  const mid = Math.ceil(best.values.length / 2);
  const parts = [best.values.slice(0, mid), best.values.slice(mid)].filter((part) => part.length > 0);
  if (parts.length < 2) return [];
  return parts.map((values) => ({ ...filters, [best.key]: values }) as GetleadsFilters);
}

function shareCap(total: number, parts: number): number[] {
  const n = Math.max(0, Math.floor(total));
  if (parts <= 0) return [];
  const base = Math.floor(n / parts);
  let rem = n - base * parts;
  return Array.from({ length: parts }, () => {
    const extra = rem > 0 ? 1 : 0;
    rem -= extra;
    return base + extra;
  });
}

/** The sized plan_rows cap. A known plan does not need another full-lane count before export. */
export function exportRowLimit(planRows: number): number {
  const rows = Math.floor(planRows);
  return Math.max(1, Math.min(50_000, Number.isFinite(rows) && rows > 0 ? rows : 1));
}

/** Count the query. City lists over 45 are chunked first. On count_timeout, half the largest list. Do not send the wide query again. */
export async function countOrSplit(
  filters: GetleadsFilters,
  count: (filters: GetleadsFilters) => Promise<CountResult>,
  depth = 0,
): Promise<CountResult> {
  const cityParts = chunkCities(filters);
  if (cityParts.length > 1) {
    let total = 0;
    let exportable = 0;
    let sawExportable = false;
    for (const part of cityParts) {
      const counted = await countOrSplit(part, count, depth);
      total += counted.total_matching;
      if (counted.exportable_rows != null) {
        sawExportable = true;
        exportable += counted.exportable_rows;
      }
    }
    return { total_matching: total, exportable_rows: sawExportable ? exportable : null };
  }
  try {
    return await count(filters);
  } catch (err) {
    if (!isCountTimeout((err as Error).message ?? String(err)) || depth >= MAX_SPLIT_DEPTH) throw err;
    const slices = splitGetleadsQuery(filters);
    if (slices.length < 2) throw err;
    let total = 0;
    let exportable = 0;
    let sawExportable = false;
    for (const slice of slices) {
      const part = await countOrSplit(slice, count, depth + 1);
      total += part.total_matching;
      if (part.exportable_rows != null) {
        sawExportable = true;
        exportable += part.exportable_rows;
      }
    }
    return { total_matching: total, exportable_rows: sawExportable ? exportable : null };
  }
}

/** Export the query. City lists over 45 are one export per chunk, and the caps sum to plan_rows. On count_timeout, half the largest list. */
export async function exportOrSplit(
  filters: GetleadsFilters,
  opts: { max_rows: number; max_per_company?: number; columns?: string[] },
  start: (filters: GetleadsFilters, opts: { max_rows: number; max_per_company?: number; columns?: string[] }) => Promise<{ export_id: string }>,
  depth = 0,
): Promise<{ export_ids: string[] }> {
  const limit = exportRowLimit(opts.max_rows);
  const cityParts = chunkCities(filters);
  if (cityParts.length > 1) {
    const caps = shareCap(limit, cityParts.length);
    const ids: string[] = [];
    for (let i = 0; i < cityParts.length; i++) {
      const cap = caps[i] ?? 0;
      if (cap < 1) continue;
      const started = await exportOrSplit(cityParts[i]!, { ...opts, max_rows: cap }, start, depth);
      ids.push(...started.export_ids);
    }
    return { export_ids: ids };
  }
  try {
    const one = await start(filters, { ...opts, max_rows: limit });
    return { export_ids: [one.export_id] };
  } catch (err) {
    if (!isCountTimeout((err as Error).message ?? String(err)) || depth >= MAX_SPLIT_DEPTH) throw err;
    const slices = splitGetleadsQuery(filters);
    if (slices.length < 2) throw err;
    const caps = shareCap(limit, slices.length);
    const ids: string[] = [];
    for (let i = 0; i < slices.length; i++) {
      const cap = caps[i] ?? 0;
      if (cap < 1) continue;
      const started = await exportOrSplit(slices[i]!, { ...opts, max_rows: cap }, start, depth + 1);
      ids.push(...started.export_ids);
    }
    if (ids.length === 0) throw err;
    return { export_ids: ids };
  }
}

/**
 * Band labels and numeric employee bounds together silently overlap bands
 * (D34). Refuse before the HTTP call. `employee_profiles_on_linkedin` is
 * only for a lane that has no `company_size` (SalesGlider PE).
 */
export function assertGetleadsFilters(filters: GetleadsFilters): void {
  const f = filters as unknown as Record<string, unknown>;
  const bands = Array.isArray(f.company_size) && f.company_size.length > 0;
  const numeric =
    f.employee_profiles_on_linkedin != null ||
    f.employee_count_min != null ||
    f.employee_count_max != null ||
    f.employees_min != null ||
    f.employees_max != null ||
    f.company_size_min != null ||
    f.company_size_max != null ||
    f.employee_profiles_on_linkedin_min != null ||
    f.employee_profiles_on_linkedin_max != null;
  if (bands && numeric) {
    throw new Error(
      "getleads filter cannot carry company_size band labels and a numeric employee bound together (silent band overlap)",
    );
  }
}

/**
 * Keys `count_contacts` accepts from a recipe. `max_per_company` is an
 * export cap — first-pull-receipt: Do not put it in the count filters (D43).
 * Numeric employee bounds are never sent (D34, tam-sizing).
 */
export const GETLEADS_COUNT_KEYS = [
  "job_titles",
  "job_function",
  "seniority",
  "company_size",
  "countries",
  "states",
  "cities",
  "industries",
  "company_description",
  "exclude_job_titles",
  "email_status",
  "employee_profiles_on_linkedin_min",
  "employee_profiles_on_linkedin_max",
] as const;

/**
 * Both `count_contacts` and `export_contacts` reject `job_function`.
 * They take `job_functions` (one-item list) and the same `seniority` list.
 * The function name is not rewritten.
 */
export function exportFilters(filters: GetleadsFilters): Record<string, unknown> {
  return outboundFilters(filters);
}

export function outboundFilters(filters: GetleadsFilters): Record<string, unknown> {
  const src = filters as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of GETLEADS_COUNT_KEYS) {
    if (src[key] !== undefined && src[key] !== null) out[key] = src[key];
  }
  const epl = src.employee_profiles_on_linkedin;
  if (epl && typeof epl === "object" && !Array.isArray(epl)) {
    const o = epl as { min?: number; max?: number };
    if (o.min != null) out.employee_profiles_on_linkedin_min = o.min;
    if (o.max != null) out.employee_profiles_on_linkedin_max = o.max;
  }
  const bands = Array.isArray(out.company_size) && (out.company_size as unknown[]).length > 0;
  if (!bands) delete out.company_size;
  if (bands) {
    delete out.employee_profiles_on_linkedin_min;
    delete out.employee_profiles_on_linkedin_max;
  }
  const statuses = out.email_status;
  if (!Array.isArray(statuses) || statuses.length === 0) delete out.email_status;
  const job = out.job_function;
  if (typeof job === "string" && job.trim()) {
    const already = Array.isArray(out.job_functions)
      ? out.job_functions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    out.job_functions = [...new Set([job.trim(), ...already])];
  }
  delete out.job_function;
  return out;
}

export class GetleadsClient implements Getleads {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  private ready(): void {
    if (!this.url) throw new Error("GETLEADS_MCP_URL is not configured; cannot size or pull a getleads lane");
  }

  async count(filters: GetleadsFilters): Promise<CountResult> {
    this.ready();
    return countOrSplit(filters, (slice) => this.countOnce(slice));
  }

  private async countOnce(filters: GetleadsFilters): Promise<CountResult> {
    assertGetleadsFilters(filters);
    const res = await this.mcp.call<Record<string, unknown>>("count_contacts", outboundFilters(filters));
    const total = Number(res.total_matching ?? res.total ?? res.count ?? NaN);
    if (!Number.isFinite(total)) throw new Error(`count_contacts returned no total_matching: ${JSON.stringify(Object.keys(res))}`);
    const exportable = res.exportable_rows === undefined || res.exportable_rows === null ? null : Number(res.exportable_rows);
    return { total_matching: total, exportable_rows: exportable };
  }

  async startExport(filters: GetleadsFilters, opts: { max_rows: number; max_per_company?: number; columns?: string[] }): Promise<ExportStarted> {
    this.ready();
    const started = await exportOrSplit(filters, opts, (slice, sliceOpts) => this.exportOnce(slice, sliceOpts));
    return { export_id: started.export_ids[0]!, export_ids: started.export_ids };
  }

  private async exportOnce(filters: GetleadsFilters, opts: { max_rows: number; max_per_company?: number; columns?: string[] }): Promise<{ export_id: string }> {
    assertGetleadsFilters(filters);
    if (!(opts.max_rows >= 1 && opts.max_rows <= 50_000)) throw new Error(`export max_rows must be 1..50000, got ${opts.max_rows}`);
    const args: Record<string, unknown> = { ...exportFilters(filters), max_rows: opts.max_rows, confirmed: true };
    if (opts.max_per_company !== undefined) args.max_per_company = opts.max_per_company;
    if (opts.columns?.length) args.columns = opts.columns;
    const res = await this.mcp.call<Record<string, unknown>>("export_contacts", args);
    const id = res.export_id ?? res.id;
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`export_contacts returned no export_id: ${JSON.stringify(Object.keys(res))}`);
    return { export_id: String(id) };
  }

  async checkExport(exportId: string): Promise<ExportStatus> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("check_contact_export", { export_id: exportId });
    const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
    return {
      job_status: String(res.job_status ?? res.status ?? "unknown").toLowerCase(),
      export_url: typeof res.export_url === "string" ? res.export_url : typeof res.url === "string" ? res.url : null,
      rows_exported: num(res.rows_exported),
      rows_available: num(res.rows_available),
      cap_reason: typeof res.cap_reason === "string" ? res.cap_reason : null,
      cap_message: typeof res.cap_message === "string" ? res.cap_message : null,
    };
  }
}
