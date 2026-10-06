import { campaignGroups, type CampaignGroup } from "../../recipes/campaigns.js";
import type { GetleadsSource, MapsSource, PermitsSource, Recipe, Source } from "../../recipes/schema.js";

/**
 * Step zero of leadgen-mcp-routing: LinkedIn-native vs physical, then the
 * source the *campaigns* named (D30). getleads is the free first pass on
 * desk ICPs and structurally zero on rooftops — never a fallback. Pull
 * still parks when one run would walk two stacks. Size counts each
 * segment list on its own and combines the totals.
 */
export type PullRoute = { kind: "run"; source: "getleads"; filters: GetleadsSource } | { kind: "park"; reason: string };

export function routePull(recipe: Recipe, campaignIds?: number[]): PullRoute {
  const groups = campaignGroups(recipe, campaignIds);
  const mixed = mixedStackReason(groups);
  if (mixed) return { kind: "park", reason: mixed };

  const g = groups[0];
  if (!g) return { kind: "park", reason: "no target campaigns to pull" };
  const src = g.source.kind;
  const icp = g.kind;

  if (src === "mixed") {
    return {
      kind: "park",
      reason: "mixed ICP: route each campaign separately (leadgen-mcp-routing step zero). Do not pick one stack for the client.",
    };
  }

  if (icp === "physical") {
    if (src === "getleads" || src === "ai_ark") {
      return {
        kind: "park",
        reason: "do not fall back to the LinkedIn-native stack on a physical ICP (rooftops, trades, permits). Route Maps and/or PermitStack, then ask Josh if the buyer appears in neither.",
      };
    }
    if (src === "maps" || src === "permits") {
      return {
        kind: "park",
        reason: `${src} pull is documented in docs/servers.md but the adapter is not wired in this build. Physical cascade lands with the yield card and the ~100 pilot (D21). Ask Josh before improvising a third route.`,
      };
    }
    if (src === "supabase_table") {
      return { kind: "park", reason: "table-source pull has no adapter in this build; the rows must already be in a LeadPipe ingest or wait for that adapter." };
    }
  }

  if (src === "getleads" && g.source.kind === "getleads") return { kind: "run", source: "getleads", filters: g.source };
  if (src === "ai_ark") {
    return {
      kind: "park",
      reason: "AI Ark people pull is not a leadtopup client yet (D22: document it from its code in docs/servers.md first). On a LinkedIn-native ICP getleads is the free first pass.",
    };
  }
  if (src === "maps" || src === "permits") {
    return {
      kind: "park",
      reason: `ICP is ${icp} but the source is ${src}. Maps/PermitStack are the physical path. Check the campaign.`,
    };
  }
  return { kind: "park", reason: `no step 3 adapter for a ${src} source in this build` };
}

export type SizeLeaf =
  | { kind: "getleads"; source: GetleadsSource }
  | { kind: "maps"; source: MapsSource }
  | { kind: "permits"; source: PermitsSource }
  | { kind: "skip"; line: string }
  | { kind: "park"; reason: string };

export type SizeSegment = { label: string; campaignIds: number[]; route: SizeLeaf };

export type SizeRoute = SizeLeaf | { kind: "combine"; segments: SizeSegment[] };

/** tam-sizing: one list per segment. Several lists are counted separately and combined by the size step. */
export function routeSize(recipe: Recipe, campaignIds?: number[]): SizeRoute {
  const groups = campaignGroups(recipe, campaignIds);
  if (groups.length === 0) return { kind: "park", reason: "no target campaigns to size" };
  const segments = groups.flatMap((g) => segmentLists(g));
  if (segments.length === 1) return segments[0]!.route;
  return { kind: "combine", segments };
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
    return { kind: "park", reason: "mixed ICP: size each campaign separately. Do not report one TAM for two stacks." };
  }
  if (g.source.kind === "maps") return { kind: "maps", source: g.source };
  if (g.source.kind === "permits") return { kind: "permits", source: g.source };
  if (g.kind === "physical") {
    return {
      kind: "park",
      reason: "physical ICP on a getleads source: do not report a getleads number for a rooftop. Maps pipeline_stats and PermitStack metrics_monthly are the counters, and only for a maps or permits list.",
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

function mixedStackReason(groups: CampaignGroup[]): string | null {
  if (groups.length <= 1) return null;
  return (
    `mixed campaign ICPs in one run (${groups.map((g) => g.key).join("; ")}). ` +
    "Split them — do not pick one stack for two personas or kinds."
  );
}
