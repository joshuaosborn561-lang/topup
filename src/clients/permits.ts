import { McpHttpClient } from "./mcpHttp.js";

/**
 * Permit size counter. One tool: `metrics_monthly`. The count is
 * `total_permits`. `months` is omitted so the API default window applies;
 * the window comes back on `filters.months`. `series` is not kept.
 * Search, export, and sync return rows and are not called.
 */
export interface PermitMonthCount {
  total: number;
  months: number | null;
  state: string | null;
}

export interface PermitCounts {
  monthlyTotal(args: { category: string; state: string }): Promise<PermitMonthCount>;
}

/** Read `total_permits` and the window the API applied. Zero is a count. */
export function permitTotal(payload: unknown): PermitMonthCount {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("metrics_monthly returned no total_permits");
  }
  const rec = payload as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(rec, "total_permits")) {
    throw new Error("metrics_monthly returned no total_permits");
  }
  const n = typeof rec.total_permits === "number" ? rec.total_permits : Number(rec.total_permits);
  if (!Number.isInteger(n) || n < 0) throw new Error("metrics_monthly total_permits is not a count");
  const filters =
    rec.filters && typeof rec.filters === "object" && !Array.isArray(rec.filters) ? (rec.filters as Record<string, unknown>) : {};
  const monthsRaw = filters.months;
  const months = typeof monthsRaw === "number" && Number.isInteger(monthsRaw) && monthsRaw > 0 ? monthsRaw : null;
  const state = typeof filters.state === "string" && /^[A-Z]{2}$/.test(filters.state) ? filters.state : null;
  return { total: n, months, state };
}

export class PermitCountsClient implements PermitCounts {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token = "",
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  async monthlyTotal(args: { category: string; state: string }): Promise<PermitMonthCount> {
    if (!this.url) throw new Error("PERMITSTACK_MCP_URL is not configured");
    const state = args.state.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) throw new Error("permit count needs a two-letter state");
    const category = args.category.trim();
    if (!category) throw new Error("permit count needs a category");
    const res = await this.mcp.call<unknown>("metrics_monthly", { state, category });
    return permitTotal(res);
  }
}
