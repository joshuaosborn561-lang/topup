import { GETLEADS_BANDS, type Recipe } from "../recipes/schema.js";
import { McpHttpClient } from "./mcpHttp.js";

/**
 * getleads (hosted MCP; docs/servers.md §11). Included plan: every call here
 * is $0 and still gets a ledger row. Only three tools are ever called:
 * `count_contacts` (step 2), `export_contacts` and `check_contact_export`
 * (step 3). Nothing here returns a contact; an export is a URL and a count.
 *
 * The brief's getleads rules are enforced by the recipe schema before a
 * filter reaches this file: headcount is band labels, industries carry no
 * commas, `email_status` is `["VALID"]`.
 */
export type GetleadsFilters = Recipe["source"] extends infer S ? (S extends { kind: "getleads"; params: infer P } ? P : never) : never;

export interface CountResult {
  total_matching: number;
  exportable_rows: number | null;
}

export interface ExportStarted {
  export_id: string;
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
  startExport(filters: GetleadsFilters, opts: { max_rows: number; max_per_company?: number }): Promise<ExportStarted>;
  checkExport(exportId: string): Promise<ExportStatus>;
}

/** Statuses `check_contact_export` reports once the file is ready. Not in the schema; confirmed on the first real job (servers.md §11). */
export const EXPORT_DONE = ["completed", "complete", "done", "finished", "succeeded", "success", "ready"];
export const EXPORT_FAILED = ["failed", "error", "errored", "cancelled", "canceled"];

/** The band labels a recipe does not name, for the partition check in step 2. */
export function bandComplement(bands: readonly string[]): string[] {
  return GETLEADS_BANDS.filter((b) => !bands.includes(b));
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
    const res = await this.mcp.call<Record<string, unknown>>("count_contacts", filters as unknown as Record<string, unknown>);
    const total = Number(res.total_matching ?? res.total ?? res.count ?? NaN);
    if (!Number.isFinite(total)) throw new Error(`count_contacts returned no total_matching: ${JSON.stringify(Object.keys(res))}`);
    const exportable = res.exportable_rows === undefined || res.exportable_rows === null ? null : Number(res.exportable_rows);
    return { total_matching: total, exportable_rows: exportable };
  }

  async startExport(filters: GetleadsFilters, opts: { max_rows: number; max_per_company?: number }): Promise<ExportStarted> {
    this.ready();
    if (!(opts.max_rows >= 1 && opts.max_rows <= 50_000)) throw new Error(`export max_rows must be 1..50000, got ${opts.max_rows}`);
    const args: Record<string, unknown> = { ...(filters as unknown as Record<string, unknown>), max_rows: opts.max_rows, confirmed: true };
    if (opts.max_per_company !== undefined) args.max_per_company = opts.max_per_company;
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
