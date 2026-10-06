import { McpHttpClient } from "./mcpHttp.js";

/**
 * Maps size counter. One tool: `pipeline_stats`. The count is
 * `scoped_businesses` for the category (and state, when the receipt names
 * one). The global `businesses` field is the whole scrape database and is
 * never a list count. This client does not plan or scrape.
 */
export interface MapsStats {
  scopedBusinesses(args: { category: string; state?: string; clientTag?: string }): Promise<number>;
}

/** Read `scoped_businesses`. Missing field is an error, including when `businesses` is present. Zero is a count. */
export function mapsScopedCount(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("pipeline_stats returned no scoped_businesses");
  }
  const rec = payload as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(rec, "scoped_businesses")) {
    throw new Error("pipeline_stats returned no scoped_businesses; the global businesses total is not a list count");
  }
  const n = typeof rec.scoped_businesses === "number" ? rec.scoped_businesses : Number(rec.scoped_businesses);
  if (!Number.isInteger(n) || n < 0) throw new Error("pipeline_stats scoped_businesses is not a count");
  return n;
}

export class MapsStatsClient implements MapsStats {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token = "",
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  async scopedBusinesses(args: { category: string; state?: string; clientTag?: string }): Promise<number> {
    if (!this.url) throw new Error("MAPS_MCP_URL is not configured");
    const category = args.category.trim();
    if (!category) throw new Error("maps count needs a category");
    const call: Record<string, unknown> = { main_category: category };
    if (args.state) call.state = args.state;
    if (args.clientTag) call.client_tag = args.clientTag;
    const res = await this.mcp.call<unknown>("pipeline_stats", call);
    return mapsScopedCount(res);
  }
}
