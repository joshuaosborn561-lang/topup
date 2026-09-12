import { McpHttpClient } from "./mcpHttp.js";

/**
 * Email Finder Waterfall (docs/servers.md §7). Name plus company or domain →
 * work email. Table source + writeback only — never inline rows. Cascade is
 * getleads → Smartlead → AI Ark → LeadMagic → Prospeo → FullEnrich last.
 */
export interface EmailQuote {
  rows: number;
  estimated_cost_usd: number | null;
}

export interface EmailJob {
  job_id: string;
  status: string;
  error?: string | null;
}

const DONE = ["completed", "complete", "done", "finished", "succeeded"];
const FAILED = ["failed", "error", "errored", "cancelled", "canceled"];

export interface EmailWaterfall {
  estimate(args: { client_tag: string; source_table: string; where: string; max_tier: string; need?: string }): Promise<EmailQuote>;
  start(args: { client_tag: string; source_table: string; where: string; max_tier: string; need?: string; approve_cost_usd?: number }): Promise<{ job_id: string }>;
  check(jobId: string): Promise<EmailJob>;
}

export class EmailWaterfallClient implements EmailWaterfall {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  private ready(): void {
    if (!this.url) throw new Error("EMAIL_WATERFALL_MCP_URL is not configured");
  }

  async estimate(args: { client_tag: string; source_table: string; where: string; max_tier: string; need?: string }): Promise<EmailQuote> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("enrich_waterfall", {
      client_tag: args.client_tag,
      source_table: args.source_table,
      where: args.where,
      max_tier: args.max_tier,
      need: args.need ?? "email",
      estimate_only: true,
      writeback: true,
    });
    return { rows: Number(res.rows ?? res.row_count ?? res.n ?? 0), estimated_cost_usd: numOrNull(res.estimated_cost_usd ?? res.worst_case_usd) };
  }

  async start(args: { client_tag: string; source_table: string; where: string; max_tier: string; need?: string; approve_cost_usd?: number }): Promise<{ job_id: string }> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("enrich_waterfall", {
      client_tag: args.client_tag,
      source_table: args.source_table,
      where: args.where,
      max_tier: args.max_tier,
      need: args.need ?? "email",
      estimate_only: false,
      writeback: true,
      ...(args.approve_cost_usd !== undefined ? { approve_cost_usd: args.approve_cost_usd } : {}),
    });
    const id = res.job_id ?? res.id;
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`enrich_waterfall returned no job_id: ${JSON.stringify(Object.keys(res))}`);
    return { job_id: String(id) };
  }

  async check(jobId: string): Promise<EmailJob> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("get_job_status", { job_id: jobId });
    return { job_id: jobId, status: String(res.status ?? "unknown"), error: typeof res.error === "string" ? res.error : null };
  }
}

export function emailJobState(status: string): "running" | "done" | "failed" {
  const s = status.toLowerCase();
  if (FAILED.includes(s)) return "failed";
  if (DONE.includes(s)) return "done";
  return "running";
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
