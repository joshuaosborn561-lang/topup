import { McpHttpClient } from "./mcpHttp.js";

/**
 * Domain Waterfall (docs/servers.md §5). Company name plus location → domain.
 * Table source only; never inline rows. Bound every job to ≤ 500 rows (one
 * page) until the deployed pagination fix is live.
 */
export interface DomainQuote {
  rows: number;
  estimated_cost_usd: number | null;
}

export interface DomainJob {
  job_id: string;
  status: string;
  error?: string | null;
}

const DONE = ["completed", "complete", "done", "finished", "succeeded"];
const FAILED = ["failed", "error", "errored", "cancelled", "canceled"];

export interface DomainWaterfall {
  estimate(args: { source_table: string; where: string; client_tag: string; limit?: number }): Promise<DomainQuote>;
  start(args: { source_table: string; where: string; client_tag: string; approve_cost_usd: number; limit?: number }): Promise<{ job_id: string }>;
  check(jobId: string): Promise<DomainJob>;
}

export class DomainWaterfallClient implements DomainWaterfall {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  private ready(): void {
    if (!this.url) throw new Error("DOMAIN_WATERFALL_MCP_URL is not configured");
  }

  async estimate(args: { source_table: string; where: string; client_tag: string; limit?: number }): Promise<DomainQuote> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("resolve_domain", {
      source_table: args.source_table,
      where: args.where,
      client_tag: args.client_tag,
      estimate_only: true,
      limit: Math.min(500, args.limit ?? 500),
    });
    return { rows: Number(res.rows ?? res.row_count ?? res.n ?? 0), estimated_cost_usd: numOrNull(res.estimated_cost_usd ?? res.worst_case_usd) };
  }

  async start(args: { source_table: string; where: string; client_tag: string; approve_cost_usd: number; limit?: number }): Promise<{ job_id: string }> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("resolve_domain", {
      source_table: args.source_table,
      where: args.where,
      client_tag: args.client_tag,
      estimate_only: false,
      approve_cost_usd: args.approve_cost_usd,
      limit: Math.min(500, args.limit ?? 500),
    });
    const id = res.job_id ?? res.id;
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`resolve_domain returned no job_id: ${JSON.stringify(Object.keys(res))}`);
    return { job_id: String(id) };
  }

  async check(jobId: string): Promise<DomainJob> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("get_job_status", { job_id: jobId });
    return { job_id: jobId, status: String(res.status ?? "unknown"), error: typeof res.error === "string" ? res.error : null };
  }
}

export function domainJobState(status: string): "running" | "done" | "failed" {
  const s = status.toLowerCase();
  if (FAILED.includes(s)) return "failed";
  if (DONE.includes(s)) return "done";
  return "running";
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
