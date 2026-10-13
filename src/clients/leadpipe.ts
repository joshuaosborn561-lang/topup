import { logger } from "../lib/log.js";
import { McpHttpClient } from "./mcpHttp.js";

const log = logger("leadpipe");

/**
 * LeadPipe (existing ingestion service / Context Saver). Called, never forked.
 * We use it to turn a filtered slice of lp.<tag>_ingested_leads into a signed
 * CSV URL (server to server) and, in later stages, to ingest and import.
 * Every method returns job_id / signed_url / counts — never contact rows
 * (D39: Grok bot may start these; it must not open the URL).
 */
export interface ExportResult {
  signed_url: string;
  row_count: number;
}

export interface JobStarted {
  job_id: string;
  status: string;
}

/**
 * `lp_status` as the service reads it. The status vocabulary is not in the
 * schema (docs/servers.md §1): anything not in JOB_DONE / JOB_FAILED is
 * treated as still running, and the first real job confirms the words.
 */
export interface JobStatus {
  status: string;
  /** Rows LeadPipe read from the file(s), when it says. */
  rows_read: number | null;
  /** Rows it inserted, when it says. */
  rows_inserted: number | null;
  /** Rows LeadPipe's own ingest filter dropped (no usable address, off its dialect), when it says. */
  filtered_out: number | null;
  /** Rows it dropped as duplicates of rows already in the lane table (the client already has them), when it says. */
  dupes_dropped: number | null;
  /** LeadPipe's own note on the ingest, when it says (e.g. headers it could not map). */
  note: string | null;
  error: string | null;
  raw_keys: string[];
}

/**
 * `lp_status` answers `{ok, tool, result}` like every other LeadPipe tool;
 * the status and the counts live on `result`, the ingest counts on
 * `result.results_summary`. The flat shape is still accepted. Job 756c7271
 * (13 Oct 2026) sat at "running" for 15 minutes because the top level was
 * read instead.
 */
export function jobStatusFromResponse(payload: unknown): JobStatus {
  const root = asRecord(parseJson(payload)) ?? {};
  const result = asRecord(parseJson(root.result)) ?? root;
  const summary = asRecord(parseJson(result.results_summary)) ?? {};
  const counts = asRecord(result.counts) ?? {};
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = summary[k] ?? counts[k] ?? result[k];
      if (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v))) return Number(v);
    }
    return null;
  };
  const error = firstMessage(result) ?? (root !== result ? firstMessage(root) : null);
  return {
    status: String(result.status ?? root.status ?? "unknown").toLowerCase(),
    rows_read: pick("rows_read", "read", "total_rows", "total"),
    rows_inserted: pick("rows_inserted", "inserted", "useful_output_count", "useful_output"),
    filtered_out: pick("filtered_out"),
    dupes_dropped: pick("dupes_dropped"),
    note: typeof summary.note === "string" && summary.note.trim() ? summary.note.trim() : null,
    error,
    raw_keys: [...Object.keys(root), ...Object.keys(result).map((k) => `result.${k}`), ...Object.keys(summary).map((k) => `summary.${k}`)],
  };
}

export const JOB_DONE = ["completed", "complete", "done", "finished", "succeeded", "success"];
export const JOB_FAILED = ["failed", "error", "errored", "cancelled", "canceled"];

export interface IngestCsvParams {
  urls: string[];
  source_label: string;
  dedupe_key?: string;
  column_map?: Record<string, string>;
}

export interface LeadPipe {
  exportIngested(clientTag: string, where: Record<string, string>, columns: string[]): Promise<ExportResult>;
  /** Step 4: `lp_run ingest_csv` from a signed URL into lp.<tag>_ingested_leads. Returns a job id, never rows. */
  ingestCsv(clientTag: string, params: IngestCsvParams): Promise<JobStarted>;
  jobStatus(jobId: string): Promise<JobStatus>;
}

/**
 * Every `lp_run` answer is `{ok, tool, result}` and `job_id` lives on
 * `result`. `result` may be that object or a JSON string. A missing id
 * parks with the response's own error, not the list of keys.
 */
export function lpRunJobFromResponse(payload: unknown): { job_id: string; status: string } | { error: string } {
  const root = asRecord(parseJson(payload));
  const resultRaw = root ? parseJson(root.result) : null;
  const result = asRecord(resultRaw) ?? root ?? {};
  const id = firstId(result) ?? (root ? firstId(root) : null);
  if (id != null) {
    const status = result.status ?? root?.status ?? "queued";
    return { job_id: String(id), status: String(status).toLowerCase() };
  }
  const message = firstMessage(result) ?? (root ? firstMessage(root) : null);
  const keys = Object.keys(root ?? {});
  return { error: message ?? `lp_run returned no job_id: ${JSON.stringify(keys)}` };
}

/** Same unwrap `ingest_csv` used before every lp_run call shared it. */
export function ingestJobFromResponse(payload: unknown): { job_id: string; status: string } | { error: string } {
  return lpRunJobFromResponse(payload);
}

/**
 * `lp_export` now wraps the payload as `{ok, tool, result}` the same way
 * `lp_run` does (job 46b1c941: keys were `["ok","tool","result"]`). Read
 * `result.signed_url` / `result.row_count`, and still accept the flat shape.
 */
export function lpExportFromResponse(payload: unknown): ExportResult | { error: string } {
  const root = asRecord(parseJson(payload));
  const resultRaw = root ? parseJson(root.result) : null;
  const result = asRecord(resultRaw) ?? root ?? {};
  const url = firstString(result, ["signed_url", "url"]) ?? (root ? firstString(root, ["signed_url", "url"]) : null);
  const count = firstNumber(result, ["row_count", "rows"]) ?? (root ? firstNumber(root, ["row_count", "rows"]) : null);
  if (url && count != null) return { signed_url: url, row_count: count };
  const message = firstMessage(result) ?? (root ? firstMessage(root) : null);
  const keys = Object.keys(root ?? {});
  return { error: message ?? `lp_export returned no signed_url/row_count: ${JSON.stringify(keys)}` };
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstId(obj: Record<string, unknown>): string | number | null {
  for (const key of ["job_id", "id", "jobId"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  const nested = asRecord(obj.data) ?? asRecord(obj.job);
  return nested ? firstId(nested) : null;
}

function firstMessage(obj: Record<string, unknown>): string | null {
  for (const key of ["error", "message", "detail"]) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export class LeadPipeClient implements LeadPipe {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  async exportIngested(clientTag: string, where: Record<string, string>, columns: string[]): Promise<ExportResult> {
    if (!this.url) throw new Error("LEADPIPE_MCP_URL is not configured; cannot export rows for verification");
    const res = await this.mcp.call<Record<string, unknown>>("lp_export", {
      client_tag: clientTag,
      table: "ingested_leads",
      format: "csv",
      columns,
      where,
    });
    const parsed = lpExportFromResponse(res);
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed;
  }

  async ingestCsv(clientTag: string, params: IngestCsvParams): Promise<JobStarted> {
    return this.lpRun("ingest_csv", clientTag, { dedupe_key: "email", ...params });
  }

  /** One unwrap for every lp_run kind. ingest_csv and any later kind share it. */
  private async lpRun(jobKind: string, clientTag: string, params: Record<string, unknown>): Promise<JobStarted> {
    if (!this.url) throw new Error("LEADPIPE_MCP_URL is not configured; cannot ingest the pull");
    const res = await this.mcp.call<Record<string, unknown>>("lp_run", {
      job_kind: jobKind,
      client_tag: clientTag,
      params,
    });
    log.info("lp_run", { job_kind: jobKind, response: res });
    const parsed = lpRunJobFromResponse(res);
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed;
  }

  async jobStatus(jobId: string): Promise<JobStatus> {
    if (!this.url) throw new Error("LEADPIPE_MCP_URL is not configured");
    const res = await this.mcp.call<Record<string, unknown>>("lp_status", { job_id: jobId });
    if (res.ok === false) throw new Error(`lp_status ${jobId}: ${String(res.code ?? "error")} ${String(res.error ?? "")}`.trim());
    const status = jobStatusFromResponse(res);
    log.info("lp_status", { job_id: jobId, status: status.status, rows_read: status.rows_read, rows_inserted: status.rows_inserted, filtered_out: status.filtered_out, dupes_dropped: status.dupes_dropped });
    return status;
  }
}
