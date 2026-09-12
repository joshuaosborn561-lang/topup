import type { Recipe } from "../../recipes/schema.js";

/**
 * Step zero of leadgen-mcp-routing: LinkedIn-native vs physical, then the
 * source the recipe named. getleads is the free first pass on desk ICPs and
 * structurally zero on rooftops — never a fallback.
 */
export type PullRoute = { kind: "run"; source: "getleads" } | { kind: "park"; reason: string };

export function routePull(recipe: Recipe): PullRoute {
  const icp = recipe.icp.kind;
  const src = recipe.source.kind;

  if (src === "mixed") {
    return {
      kind: "park",
      reason: "mixed ICP: route each lane separately (leadgen-mcp-routing step zero). Do not pick one stack for the client.",
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

  if (src === "getleads") return { kind: "run", source: "getleads" };
  if (src === "ai_ark") {
    return {
      kind: "park",
      reason: "AI Ark people pull is not a leadtopup client yet (D22: document it from its code in docs/servers.md first). On a LinkedIn-native ICP getleads is the free first pass.",
    };
  }
  if (src === "maps" || src === "permits") {
    return {
      kind: "park",
      reason: `ICP is ${icp} but the source is ${src}. Maps/PermitStack are the physical path. Check the recipe.`,
    };
  }
  return { kind: "park", reason: `no step 3 adapter for a ${src} source in this build` };
}

export type SizeRoute = { kind: "getleads" } | { kind: "skip"; line: string } | { kind: "park"; reason: string };

/** tam-sizing: classify the ICP, then pick the cheapest counter that can express it. */
export function routeSize(recipe: Recipe): SizeRoute {
  if (recipe.source.kind === "mixed") {
    return { kind: "park", reason: "mixed ICP: size each lane separately. Do not report one TAM for two stacks." };
  }
  if (recipe.icp.kind === "physical") {
    return {
      kind: "park",
      reason: "physical ICP: TAM is a range from Maps estimate_cost and/or PermitStack permit counts (tam-sizing), never a getleads number and never a single hard count. Those counters are not wired in this build. Ask Josh if the buyer appears in neither Maps nor permits.",
    };
  }
  if (recipe.source.kind === "getleads") return { kind: "getleads" };
  if (recipe.source.kind === "supabase_table") {
    return { kind: "skip", line: "Size: the source is a table, not a vendor; nothing to count (the pull reads the table)." };
  }
  if (recipe.source.kind === "ai_ark") {
    return {
      kind: "park",
      reason: "LinkedIn-native TAM default is AI Ark People Preview (1 credit, tam-sizing) plus getleads count_contacts as the free second opinion. AI Ark is not a leadtopup client yet (D22).",
    };
  }
  return { kind: "park", reason: `no sizing method for a ${recipe.source.kind} source on a ${recipe.icp.kind} ICP` };
}
