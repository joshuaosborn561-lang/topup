import type { GetleadsFilters } from "../clients/getleads.js";
import { queryFingerprint } from "../builds/record.js";
import type { Recipe } from "../recipes/schema.js";
import { campaignSizeRoutes, type SizeLeaf, type SizeRoute } from "../stages/pull/route.js";

/**
 * Campaigns that share one query share one pool (D48). The pool is counted
 * once and split across its campaigns by need; it is never counted per
 * campaign, and the same person is never planned into two campaigns.
 */
export type PoolKind = "people" | "maps" | "permits" | "skip" | "park";

export interface Pool {
  key: string;
  kind: PoolKind;
  campaignIds: number[];
  /** The getleads query for a people pool. */
  filters: GetleadsFilters | null;
  leaf: SizeLeaf | null;
  /** Why a park pool cannot be sized. */
  reason: string | null;
}

function leafOf(route: SizeRoute): SizeLeaf {
  if (route.kind !== "combine") return route;
  const people = route.segments.find((seg) => seg.route.kind === "getleads");
  if (people) return people.route;
  const first = route.segments[0];
  return first ? first.route : { kind: "park", reason: "no segment to size" };
}

function keyFor(leaf: SizeLeaf): { key: string; kind: PoolKind; filters: GetleadsFilters | null; reason: string | null } {
  switch (leaf.kind) {
    case "getleads":
      return { key: `people:${queryFingerprint(leaf.source.params as GetleadsFilters)}`, kind: "people", filters: leaf.source.params as GetleadsFilters, reason: null };
    case "maps":
      return { key: `maps:${JSON.stringify(leaf.source.params)}`, kind: "maps", filters: null, reason: null };
    case "permits":
      return { key: `permits:${JSON.stringify(leaf.source.params)}`, kind: "permits", filters: null, reason: null };
    case "skip":
      return { key: `skip:${leaf.line}`, kind: "skip", filters: null, reason: null };
    case "park":
      return { key: `park:${leaf.reason}`, kind: "park", filters: null, reason: leaf.reason };
  }
}

/** One pool per distinct query across the target campaigns. Campaign order is kept inside each pool. */
export function poolsFor(recipe: Recipe, campaignIds: readonly number[]): Pool[] {
  const routes = campaignSizeRoutes(recipe, [...campaignIds]);
  const pools = new Map<string, Pool>();
  for (const { campaignId, route } of routes) {
    const leaf = leafOf(route);
    const { key, kind, filters, reason } = keyFor(leaf);
    const pool = pools.get(key) ?? { key, kind, campaignIds: [], filters, leaf, reason };
    if (!pool.campaignIds.includes(campaignId)) pool.campaignIds.push(campaignId);
    pools.set(key, pool);
  }
  return [...pools.values()];
}

/** The query of a people pool, for the fingerprint cache and the report. */
export function poolFingerprint(pool: Pool): string {
  return pool.filters ? queryFingerprint(pool.filters) : pool.key;
}
