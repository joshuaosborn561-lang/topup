import type { Recipe, RoutingRule } from "./schema.js";

/**
 * Peterson campaigns that were stamped into lane "schools".
 * The override wins over a receipt that still says schools.
 */
export const PETERSON_LANES: Readonly<Record<number, string>> = {
  3798227: "c1_general_contractors",
  3798228: "c1_general_contractors",
  3798229: "c2_property_managers",
  3798230: "c2_property_managers",
  3798231: "c3_churches",
};

export function repairedClient(
  row: { client_tag: string; smartlead_client_id: number | null },
  owner: { client_tag: string; smartlead_client_id: number } | null,
): { client_tag: string; smartlead_client_id: number | null } {
  if (!owner) return { client_tag: row.client_tag, smartlead_client_id: row.smartlead_client_id };
  return { client_tag: owner.client_tag, smartlead_client_id: owner.smartlead_client_id };
}

/** Latest lane receipt, then the Peterson override so "schools" does not win. */
export function repairedLane(campaignId: number, receiptLane: string | null, currentLane: string | null): string | null {
  const override = PETERSON_LANES[campaignId];
  if (override) return override;
  return receiptLane ?? currentLane;
}

/** The CASE the registry repair runs. Ids come from PETERSON_LANES, not from a request. */
export function petersonLaneCaseSql(): { caseSql: string; idsSql: string } {
  const ids = Object.keys(PETERSON_LANES).map((id) => Number(id));
  const caseSql = ids.map((id) => `when ${id} then '${PETERSON_LANES[id]}'`).join(" ");
  return { caseSql, idsSql: ids.join(", ") };
}

export interface RegistryCampaign {
  campaign_id: number;
  client_tag: string;
  smartlead_client_id: number | null;
  lane: string | null;
}

/**
 * A reopened run takes its campaigns from the registry rows for this
 * client's Smartlead id and this lane. Other clients' campaigns drop.
 * No rows for the lane means the saved routing stays.
 */
export function routingFromRegistry(recipe: Recipe, rows: readonly RegistryCampaign[]): Recipe {
  if (rows.length === 0) return recipe;
  const known = new Map(rows.map((row) => [row.campaign_id, row]));
  const laneIds = rows
    .filter(
      (row) =>
        row.client_tag === recipe.client_tag &&
        row.smartlead_client_id === recipe.smartlead_client_id &&
        row.lane === recipe.lane,
    )
    .map((row) => row.campaign_id);
  const kept = recipe.routing
    .map((rule) => rule.campaign_id)
    .filter((id) => {
      const row = known.get(id);
      if (!row) return true;
      return row.client_tag === recipe.client_tag && row.smartlead_client_id === recipe.smartlead_client_id && row.lane === recipe.lane;
    });
  const ids = [...new Set([...kept, ...laneIds])].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  if (ids.length === 0) return { ...recipe, routing: [], segments: { ...recipe.segments, slot: [] } };
  const byId = new Map(recipe.routing.map((rule) => [rule.campaign_id, rule]));
  const fallback = recipe.routing.find((rule) => ids.includes(rule.campaign_id))?.icp ?? recipe.routing[0]?.icp ?? { kind: "linkedin_native" as const, persona: "unspecified" };
  const routing: RoutingRule[] = ids.map((id) => {
    const existing = byId.get(id);
    if (existing) return existing;
    return { when: { slot: String(id) }, campaign_id: id, icp: fallback };
  });
  const segments = { ...recipe.segments };
  if (recipe.segments.slot || routing.some((rule) => typeof rule.when.slot === "string")) {
    segments.slot = ids.map(String);
  }
  return { ...recipe, routing, segments };
}
