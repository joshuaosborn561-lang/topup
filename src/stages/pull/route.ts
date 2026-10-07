import { campaignGroups, recipeCampaignIds, type CampaignGroup } from "../../recipes/campaigns.js";
import type { GetleadsSource, MapsSource, PermitsSource, Recipe, Source } from "../../recipes/schema.js";

/**
 * Step zero of leadgen-mcp-routing: LinkedIn-native vs physical, then the
 * source the *campaign* named (D30). getleads is the free first pass on
 * desk ICPs and structurally zero on rooftops — never a fallback. A lane
 * with several campaigns is sized and pulled once per campaign. A recipe
 * with several segments pulls each segment on its own stack.
 */
export type PullJob = {
  campaignId: number;
  segment: string;
  source: "getleads" | "maps" | "permits";
  filters: GetleadsSource | MapsSource | PermitsSource;
};

export type PullRoute =
  | { kind: "run"; source: "getleads"; filters: GetleadsSource; plans: PullJob[] }
  | { kind: "run"; source: "maps" | "permits"; plans: PullJob[] }
  | { kind: "park"; reason: string };

export function routePull(recipe: Recipe, campaignIds?: number[]): PullRoute {
  const planned = pullPlans(recipe, campaignIds);
  if (planned.kind === "park") return planned;
  const first = planned.plans[0];
  if (!first) return { kind: "park", reason: "no target campaigns to pull" };
  if (first.source === "getleads") return { kind: "run", source: "getleads", filters: first.filters as GetleadsSource, plans: planned.plans };
  return { kind: "run", source: first.source, plans: planned.plans };
}

/** One pull per campaign segment. A segment that cannot be pulled names that campaign. */
export function pullPlans(recipe: Recipe, campaignIds?: number[]): { kind: "run"; plans: PullJob[] } | { kind: "park"; reason: string } {
  const routes = campaignSizeRoutes(recipe, campaignIds);
  if (routes.length === 0) return { kind: "park", reason: "no target campaigns to pull" };
  const failed: string[] = [];
  const plans: PullJob[] = [];
  for (const { campaignId, route } of routes) {
    if (route.kind === "park") {
      failed.push(`#${campaignId}: ${route.reason}`);
      continue;
    }
    if (route.kind === "skip") continue;
    const segments = segmentsOf(route, campaignId);
    let added = 0;
    for (const seg of segments) {
      if (seg.route.kind === "park") {
        failed.push(`#${campaignId} ${seg.label}: ${seg.route.reason}`);
        continue;
      }
      if (seg.route.kind === "skip") continue;
      if (seg.route.kind === "getleads" || seg.route.kind === "maps" || seg.route.kind === "permits") {
        plans.push({ campaignId, segment: seg.label, source: seg.route.kind, filters: seg.route.source });
        added += 1;
      }
    }
    if (added === 0) failed.push(`#${campaignId}: no segment to pull`);
  }
  if (failed.length) return { kind: "park", reason: failed.join("; ") };
  if (plans.length === 0) return { kind: "park", reason: "no target campaigns to pull" };
  return { kind: "run", plans };
}

export type SizeLeaf =
  | { kind: "getleads"; source: GetleadsSource }
  | { kind: "maps"; source: MapsSource }
  | { kind: "permits"; source: PermitsSource }
  | { kind: "skip"; line: string }
  | { kind: "park"; reason: string };

export type SizeSegment = { label: string; campaignIds: number[]; route: SizeLeaf };

export type SizeRoute = SizeLeaf | { kind: "combine"; segments: SizeSegment[] };

/** One size route per target campaign. A shared persona does not collapse them into one TAM. */
export function campaignSizeRoutes(recipe: Recipe, campaignIds?: number[]): Array<{ campaignId: number; route: SizeRoute }> {
  const ids = campaignIds?.length ? [...new Set(campaignIds)] : recipeCampaignIds(recipe);
  return ids.map((campaignId) => ({ campaignId, route: routeSize(recipe, [campaignId]) }));
}

/** tam-sizing: one list per segment of one campaign. Several campaigns stay separate. */
export function routeSize(recipe: Recipe, campaignIds?: number[]): SizeRoute {
  const ids = campaignIds?.length ? [...new Set(campaignIds)] : recipeCampaignIds(recipe);
  if (ids.length > 1) {
    const segments = ids.flatMap((id) => segmentsOf(routeSize(recipe, [id]), id));
    if (segments.length === 0) return { kind: "park", reason: "no target campaigns to size" };
    if (segments.length === 1) return segments[0]!.route;
    return { kind: "combine", segments };
  }
  const groups = campaignGroups(recipe, ids);
  if (groups.length === 0) return { kind: "park", reason: "no target campaigns to size" };
  const segments = groups.flatMap((g) => segmentLists(g));
  if (segments.length === 1) return segments[0]!.route;
  return { kind: "combine", segments };
}

function segmentsOf(route: SizeRoute, campaignId: number): SizeSegment[] {
  if (route.kind === "combine") return route.segments.map((seg) => ({ ...seg, campaignIds: [campaignId] }));
  if (route.kind === "park") return [{ label: `#${campaignId}`, campaignIds: [campaignId], route: { kind: "park", reason: `#${campaignId}: ${route.reason}` } }];
  if (route.kind === "skip") return [];
  const label =
    route.kind === "maps"
      ? (route.source.params.categories[0] ?? "maps")
      : route.kind === "permits"
        ? (route.source.params.permit_types[0] ?? "permits")
        : route.kind;
  return [{ label, campaignIds: [campaignId], route }];
}

function segmentLists(group: CampaignGroup): SizeSegment[] {
  if (group.source.kind === "mixed" && group.source.parts.length > 0) {
    return group.source.parts.flatMap((part) => listsForPart(group, part));
  }
  if (group.source.kind === "maps" || group.source.kind === "permits") {
    return listsForPart(group, {
      label: group.source.kind,
      icp_kind: group.kind === "physical" ? "physical" : "linkedin_native",
      source: group.source,
    });
  }
  return [leaf(groupLabel(group), group)];
}

function listsForPart(group: CampaignGroup, part: Extract<Source, { kind: "mixed" }>["parts"][number]): SizeSegment[] {
  if (part.source.kind === "maps") {
    const params = part.source.params;
    return params.categories.map((category) =>
      leaf(category, {
        ...group,
        key: category,
        kind: "physical",
        source: { kind: "maps", params: { ...params, categories: [category] } },
      }),
    );
  }
  if (part.source.kind === "permits") {
    const params = part.source.params;
    return params.permit_types.map((permitType) =>
      leaf(permitType, {
        ...group,
        key: permitType,
        kind: "physical",
        source: { kind: "permits", params: { ...params, permit_types: [permitType] } },
      }),
    );
  }
  return [
    leaf(part.label, {
      ...group,
      key: part.label,
      kind: part.icp_kind,
      source: part.source,
    }),
  ];
}

function leaf(label: string, group: CampaignGroup): SizeSegment {
  return { label, campaignIds: group.campaignIds, route: routeSizeGroup(group) };
}

function groupLabel(group: CampaignGroup): string {
  return `${group.persona} / ${group.kind} / ${group.source.kind}`;
}

function routeSizeGroup(g: CampaignGroup): SizeLeaf {
  if (g.source.kind === "mixed") {
    if (g.source.note.startsWith("Josh lane:")) return { kind: "park", reason: g.source.note };
    return {
      kind: "park",
      reason: "no ICP source. No recipe cell, the receipt did not name its lists, and the lane has no ICP.",
    };
  }
  if (g.source.kind === "maps") return { kind: "maps", source: g.source };
  if (g.source.kind === "permits") return { kind: "permits", source: g.source };
  if (g.kind === "physical") {
    return {
      kind: "park",
      reason: "physical ICP on a getleads source: do not fall back to getleads for a rooftop. Maps pipeline_stats and PermitStack metrics_monthly are the counters, and only for a maps or permits list.",
    };
  }
  if (g.source.kind === "getleads") return { kind: "getleads", source: g.source };
  if (g.source.kind === "supabase_table") {
    return { kind: "skip", line: "Size: the source is a table, not a vendor; nothing to count (the pull reads the table)." };
  }
  if (g.source.kind === "ai_ark") {
    return {
      kind: "park",
      reason: "LinkedIn-native TAM default is AI Ark People Preview (1 credit, tam-sizing) plus getleads count_contacts as the free second opinion. AI Ark is not a leadtopup client yet (D22).",
    };
  }
  const leftover: never = g.source;
  return { kind: "park", reason: `no sizing method for a ${g.kind} ICP (${(leftover as { kind?: string }).kind ?? "unknown"})` };
}

