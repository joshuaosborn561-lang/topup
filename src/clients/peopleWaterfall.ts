import { McpHttpClient } from "./mcpHttp.js";

/**
 * Find Named Person / People Waterfall (docs/servers.md §6). Company → named
 * people. Table source only. Always pass an explicit approve_cost_usd — the
 * server default is -1 (no ceiling).
 */
export interface PeopleQuote {
  rows: number;
  estimated_cost_usd: number | null;
}

export interface PeopleJob {
  job_id: string;
  status: string;
  error?: string | null;
}

const DONE = ["completed", "complete", "done", "finished", "succeeded"];
const FAILED = ["failed", "error", "errored", "cancelled", "canceled"];

export interface PeopleWaterfall {
  estimate(args: { source_table: string; where: string; client_tag: string }): Promise<PeopleQuote>;
  start(args: { source_table: string; where: string; client_tag: string; approve_cost_usd: number }): Promise<{ job_id: string }>;
  check(jobId: string): Promise<PeopleJob>;
}

export class PeopleWaterfallClient implements PeopleWaterfall {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  private ready(): void {
    if (!this.url) throw new Error("PEOPLE_WATERFALL_MCP_URL is not configured");
  }

  async estimate(args: { source_table: string; where: string; client_tag: string }): Promise<PeopleQuote> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("resolve_people", {
      source_table: args.source_table,
      where: args.where,
      client_tag: args.client_tag,
      estimate_only: true,
    });
    return { rows: Number(res.rows ?? res.row_count ?? res.n ?? 0), estimated_cost_usd: numOrNull(res.estimated_cost_usd ?? res.worst_case_usd) };
  }

  async start(args: { source_table: string; where: string; client_tag: string; approve_cost_usd: number }): Promise<{ job_id: string }> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("resolve_people", {
      source_table: args.source_table,
      where: args.where,
      client_tag: args.client_tag,
      estimate_only: false,
      approve_cost_usd: args.approve_cost_usd,
    });
    const id = res.job_id ?? res.id;
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`resolve_people returned no job_id: ${JSON.stringify(Object.keys(res))}`);
    return { job_id: String(id) };
  }

  async check(jobId: string): Promise<PeopleJob> {
    this.ready();
    const res = await this.mcp.call<Record<string, unknown>>("get_job_status", { job_id: jobId });
    return { job_id: jobId, status: String(res.status ?? "unknown"), error: typeof res.error === "string" ? res.error : null };
  }
}

export function peopleJobState(status: string): "running" | "done" | "failed" {
  const s = status.toLowerCase();
  if (s === "deferred") return "failed";
  if (FAILED.includes(s)) return "failed";
  if (DONE.includes(s)) return "done";
  return "running";
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
