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

function asRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

/**
 * Read `scoped_businesses`. The live tool puts the JSON in
 * `structuredContent.result` as a string, and that object also carries the
 * global `businesses` total. Missing `scoped_businesses` is an error.
 * Zero is a count.
 */
export function mapsScopedCount(payload: unknown): number {
  let rec = asRecord(payload);
  if (rec && !Object.prototype.hasOwnProperty.call(rec, "scoped_businesses") && "result" in rec) {
    const inner = rec.result;
    if (typeof inner === "string") {
      try {
        rec = asRecord(JSON.parse(inner));
      } catch {
        rec = null;
      }
    } else {
      rec = asRecord(inner);
    }
  }
  if (!rec || !Object.prototype.hasOwnProperty.call(rec, "scoped_businesses")) {
    throw new Error("pipeline_stats returned no scoped_businesses; the global businesses total is not a list count");
  }
  const n = typeof rec.scoped_businesses === "number" ? rec.scoped_businesses : Number(rec.scoped_businesses);
  if (!Number.isInteger(n) || n < 0) throw new Error("pipeline_stats scoped_businesses is not a count");
  return n;
}

/** Read a sync_to_supabase count. Zero is a count. A missing count is zero rows written, not the global businesses total. */
export function mapsSyncRows(payload: unknown): number {
  let rec = asRecord(payload);
  if (rec && typeof rec.result === "string") {
    try {
      rec = asRecord(JSON.parse(rec.result)) ?? rec;
    } catch {
      /* keep the outer object */
    }
  }
  const nested = rec && asRecord(rec.counts);
  const look = nested ?? rec;
  if (!look) return 0;
  for (const key of ["rows_synced", "synced", "rows", "inserted", "upserted", "count"]) {
    const n = look[key];
    if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n;
  }
  return 0;
}

export interface MapsQuote {
  /** Price a scrape. Writes a plan on the maps server and does not run it. */
  estimateCost(args: { categories: string[]; states: string[]; clientTag: string }): Promise<void>;
  /** Copy an already-scraped category into the client table. Returns a count, never rows. */
  syncExisting(args: { category: string; state?: string; clientTag: string }): Promise<number>;
}

export class MapsStatsClient implements MapsStats, MapsQuote {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token = "",
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  async scopedBusinesses(args: { category: string; state?: string; clientTag?: string }): Promise<number> {
    if (!this.url) throw new Error("missing credentials for maps");
    const category = args.category.trim();
    if (!category) throw new Error("maps count needs a category");
    const call: Record<string, unknown> = { main_category: category };
    if (args.state) call.state = args.state;
    if (args.clientTag) call.client_tag = args.clientTag;
    const res = await this.mcp.call<unknown>("pipeline_stats", call);
    return mapsScopedCount(res);
  }

  async estimateCost(args: { categories: string[]; states: string[]; clientTag: string }): Promise<void> {
    if (!this.url) throw new Error("missing credentials for maps");
    const categories = args.categories.map((c) => c.trim()).filter(Boolean);
    if (categories.length === 0) throw new Error("maps quote needs a category");
    await this.mcp.call<unknown>("estimate_cost", {
      categories,
      states: args.states,
      client_tag: args.clientTag,
      brief: `topup price quote ${args.clientTag}`,
    });
  }

  async syncExisting(args: { category: string; state?: string; clientTag: string }): Promise<number> {
    if (!this.url) throw new Error("missing credentials for maps");
    const category = args.category.trim();
    if (!category) throw new Error("maps sync needs a category");
    const call: Record<string, unknown> = { client_tag: args.clientTag, main_category: category };
    if (args.state) call.state = args.state;
    const res = await this.mcp.call<unknown>("sync_to_supabase", call);
    return mapsSyncRows(res);
  }
}
