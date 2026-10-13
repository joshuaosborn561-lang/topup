import { McpHttpClient } from "./mcpHttp.js";

/**
 * D103 — the Email Finder Waterfall (docs/servers.md §7), called by the
 * service after a named yes. Table source only: the finder reads the job's
 * own rows from the lane table by id and writes only its own result columns
 * (wf_status, wf_email, wf_email_status, wf_vendor, wf_updated_at) back
 * onto them. No row is ever sent inline or returned here; answers are
 * counts, dollars and a job id. The finder prices its own run and refuses
 * anything above the ceiling it is given.
 */
export interface FinderSource {
  schema: string;
  table: string;
  where: string;
}

export interface FinderEstimate {
  rows: number;
  estimated_cost_usd: number;
  refused: boolean;
}

export interface FinderJob {
  status: "running" | "done" | "failed";
  /** completed | stopped_at_ceiling | refused_over_ceiling, from the finder's own result. */
  outcome: string | null;
  spend_usd: number;
  emails_found: number;
  error: string | null;
}

export interface EmailFinder {
  configured(): boolean;
  estimate(clientTag: string, src: FinderSource, maxTier: string): Promise<FinderEstimate>;
  start(clientTag: string, src: FinderSource, maxTier: string, ceilingUsd: number): Promise<{ job_id: string } | { refused: string }>;
  check(jobId: string): Promise<FinderJob>;
}

/** The finder's answer is a JSON string, sometimes wrapped as {result: "…"} by the MCP layer. */
export function unwrapFinder(res: unknown): Record<string, unknown> {
  let v: unknown = res;
  for (let i = 0; i < 3; i += 1) {
    if (typeof v === "string") {
      try {
        v = JSON.parse(v);
        continue;
      } catch {
        return { error: v };
      }
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o);
      if (keys.length === 1 && keys[0] === "result" && (typeof o.result === "string" || (o.result && typeof o.result === "object"))) {
        v = o.result;
        continue;
      }
      return o;
    }
    break;
  }
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The source object the finder takes: the lane table, keyed by id, with the lane's column names mapped to its fields. */
export function finderSourceArg(src: FinderSource): Record<string, unknown> {
  return {
    schema: src.schema,
    table: src.table,
    where: src.where,
    key_column: "id",
    map: { first_name: "first_name", last_name: "last_name", company_name: "company_name", domain: "company_domain", title: "title", city: "city", state: "state" },
  };
}

export function finderEstimateFrom(res: unknown): FinderEstimate {
  const o = unwrapFinder(res);
  if (typeof o.error === "string" && o.estimated_cost_usd === undefined) throw new Error(`email finder estimate: ${o.error.slice(0, 200)}`);
  return { rows: num(o.rows_in), estimated_cost_usd: num(o.estimated_cost_usd), refused: o.would_refuse === true || o.status === "refused_over_ceiling" };
}

export function finderJobFrom(res: unknown): FinderJob {
  const o = unwrapFinder(res);
  const status = String(o.status ?? "unknown").toLowerCase();
  const result = (o.result && typeof o.result === "object" ? o.result : {}) as Record<string, unknown>;
  const outcome = typeof result.status === "string" ? result.status : null;
  const base = { outcome, spend_usd: num(result.spend), emails_found: num(result.emails_found), error: typeof o.error === "string" ? o.error : null };
  if (status === "failed") return { status: "failed", ...base };
  if (status === "completed") return { status: "done", ...base };
  return { status: "running", ...base };
}

export class EmailFinderClient implements EmailFinder {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, "", fetchImpl);
  }

  configured(): boolean {
    return Boolean(this.url);
  }

  private args(clientTag: string, src: FinderSource, maxTier: string): Record<string, unknown> {
    return {
      client_tag: clientTag,
      source: finderSourceArg(src),
      need: "email",
      find_phone: false,
      max_tier: maxTier,
      require_title_match: false,
      writeback: true,
    };
  }

  async estimate(clientTag: string, src: FinderSource, maxTier: string): Promise<FinderEstimate> {
    if (!this.url) throw new Error("EMAIL_WATERFALL_MCP_URL is not configured");
    return finderEstimateFrom(await this.mcp.call("enrich_waterfall", { ...this.args(clientTag, src, maxTier), estimate_only: true }));
  }

  async start(clientTag: string, src: FinderSource, maxTier: string, ceilingUsd: number): Promise<{ job_id: string } | { refused: string }> {
    if (!this.url) throw new Error("EMAIL_WATERFALL_MCP_URL is not configured");
    const o = unwrapFinder(await this.mcp.call("enrich_waterfall", { ...this.args(clientTag, src, maxTier), estimate_only: false, background: true, approve_cost_usd: ceilingUsd }));
    if (o.status === "refused_over_ceiling") return { refused: String(o.reason ?? `estimate ${o.estimated_cost_usd} is above ${ceilingUsd}`) };
    const id = o.job_id ?? o.id;
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`email finder returned no job id (${Object.keys(o).join(", ").slice(0, 120)})`);
    return { job_id: String(id) };
  }

  async check(jobId: string): Promise<FinderJob> {
    if (!this.url) throw new Error("EMAIL_WATERFALL_MCP_URL is not configured");
    return finderJobFrom(await this.mcp.call("get_job_status", { job_id: jobId }));
  }
}
