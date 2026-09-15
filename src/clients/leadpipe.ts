import { McpHttpClient } from "./mcpHttp.js";

/**
 * LeadPipe (existing ingestion service). Called, never forked. We use it to
 * turn a filtered slice of lp.<tag>_ingested_leads into a signed CSV URL
 * (server to server) and, in later stages, to ingest and import.
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
  error: string | null;
  raw_keys: string[];
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
    const url = (res.signed_url ?? res.url) as string | undefined;
    const count = Number(res.row_count ?? res.rows ?? NaN);
    if (!url || !Number.isFinite(count)) {
      throw new Error(`lp_export returned no signed_url/row_count: ${JSON.stringify(Object.keys(res))}`);
    }
    return { signed_url: url, row_count: count };
  }

  async ingestCsv(clientTag: string, params: IngestCsvParams): Promise<JobStarted> {
    if (!this.url) throw new Error("LEADPIPE_MCP_URL is not configured; cannot ingest the pull");
    const res = await this.mcp.call<Record<string, unknown>>("lp_run", {
      job_kind: "ingest_csv",
      client_tag: clientTag,
      params: { dedupe_key: "email", ...params },
    });
    const id = res.job_id ?? res.id;
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`lp_run ingest_csv returned no job_id: ${JSON.stringify(Object.keys(res))}`);
    return { job_id: String(id), status: String(res.status ?? "queued").toLowerCase() };
  }

  async jobStatus(jobId: string): Promise<JobStatus> {
    if (!this.url) throw new Error("LEADPIPE_MCP_URL is not configured");
    const res = await this.mcp.call<Record<string, unknown>>("lp_status", { job_id: jobId });
    if (res.ok === false) throw new Error(`lp_status ${jobId}: ${String(res.code ?? "error")} ${String(res.error ?? "")}`.trim());
    const counts = (res.counts && typeof res.counts === "object" ? res.counts : {}) as Record<string, unknown>;
    const pick = (...keys: string[]): number | null => {
      for (const k of keys) {
        const v = counts[k] ?? res[k];
        if (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v))) return Number(v);
      }
      return null;
    };
    return {
      status: String(res.status ?? "unknown").toLowerCase(),
      rows_read: pick("rows_read", "read", "rows_total", "total_rows", "total"),
      rows_inserted: pick("rows_inserted", "inserted", "useful_output_count", "useful_output"),
      error: typeof res.error === "string" ? res.error : null,
      raw_keys: [...Object.keys(res), ...Object.keys(counts).map((k) => `counts.${k}`)],
    };
  }
}
