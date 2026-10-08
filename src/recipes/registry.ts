import { neverTopUp } from "../config.js";
import { isParlayRefreshCampaign, isParlayRefreshLane, parlayCampaignRetired } from "./parlay.js";
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
  campaign_name?: string | null;
  client_tag: string;
  smartlead_client_id: number | null;
  lane: string | null;
  /** Missing means ACTIVE, so an older registry row still counts. */
  status?: string | null;
}

function registryActive(status: string | null | undefined): boolean {
  if (status == null || status.trim() === "") return true;
  return status.trim().toUpperCase() === "ACTIVE";
}

function routingFor(recipe: Recipe, ids: number[]): Recipe {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
  if (unique.length === 0) return { ...recipe, routing: [], segments: { ...recipe.segments, slot: [] } };
  const byId = new Map(recipe.routing.map((rule) => [rule.campaign_id, rule]));
  const fallback = recipe.routing.find((rule) => unique.includes(rule.campaign_id))?.icp ?? recipe.routing[0]?.icp ?? { kind: "linkedin_native" as const, persona: "unspecified" };
  const routing: RoutingRule[] = unique.map((id) => {
    const existing = byId.get(id);
    if (existing) return existing;
    return { when: { slot: String(id) }, campaign_id: id, icp: fallback };
  });
  const segments = { ...recipe.segments };
  if (recipe.segments.slot || routing.some((rule) => typeof rule.when.slot === "string")) {
    segments.slot = unique.map(String);
  }
  return { ...recipe, routing, segments };
}

/**
 * Lane targets are the recipe's campaigns that the registry also names for
 * this client's Smartlead id, this lane, and status ACTIVE. A registry row
 * that is not in the recipe is not added. A recipe campaign with no registry
 * row is dropped once any registry rows exist. No rows at all leaves the
 * recipe, minus campaigns that are never topped up.
 */
function parlayRefreshRouting(recipe: Recipe, rows: readonly RegistryCampaign[]): Recipe {
  const ids = new Set<number>();
  for (const id of recipe.routing.map((rule) => rule.campaign_id)) {
    if (isParlayRefreshCampaign(id) && !parlayCampaignRetired(id) && !neverTopUp(id)) ids.add(id);
  }
  for (const row of rows) {
    if (!ids.has(row.campaign_id)) continue;
    if (row.client_tag !== recipe.client_tag) ids.delete(row.campaign_id);
    else if (row.lane && row.lane !== recipe.lane) ids.delete(row.campaign_id);
    else if (row.status != null && row.status.trim() !== "" && row.status.trim().toUpperCase() !== "ACTIVE") ids.delete(row.campaign_id);
  }
  if (rows.length > 0) {
    for (const row of rows) {
      if (row.client_tag !== recipe.client_tag) continue;
      if (row.smartlead_client_id !== recipe.smartlead_client_id) continue;
      if (row.lane !== recipe.lane) continue;
      if (row.status != null && row.status.trim() !== "" && row.status.trim().toUpperCase() !== "ACTIVE") continue;
      if (!isParlayRefreshCampaign(row.campaign_id) || parlayCampaignRetired(row.campaign_id)) continue;
      if (neverTopUp(row.campaign_id, row.campaign_name)) continue;
      ids.add(row.campaign_id);
    }
  }
  return routingFor(recipe, [...ids]);
}

export function routingFromRegistry(recipe: Recipe, rows: readonly RegistryCampaign[]): Recipe {
  if (recipe.client_tag === "parlay" && isParlayRefreshLane(recipe.lane)) return parlayRefreshRouting(recipe, rows);
  const recipeIds = new Set(recipe.routing.map((rule) => rule.campaign_id));
  if (rows.length === 0) {
    return routingFor(
      recipe,
      recipe.routing.map((rule) => rule.campaign_id).filter((id) => !neverTopUp(id)),
    );
  }
  const ids = rows
    .filter((row) => {
      if (!recipeIds.has(row.campaign_id)) return false;
      if (row.client_tag !== recipe.client_tag) return false;
      if (row.smartlead_client_id !== recipe.smartlead_client_id) return false;
      if (row.lane !== recipe.lane) return false;
      if (!registryActive(row.status)) return false;
      if (neverTopUp(row.campaign_id, row.campaign_name)) return false;
      return true;
    })
    .map((row) => row.campaign_id);
  return routingFor(recipe, ids);
}

/** Registry rows as the repo returns them, mapped to the shape the routing helpers read. */
export function registryRows(rows: readonly Record<string, unknown>[]): RegistryCampaign[] {
  const out: RegistryCampaign[] = [];
  for (const row of rows) {
    const id = Number(row.campaign_id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const client = row.smartlead_client_id == null ? null : Number(row.smartlead_client_id);
    out.push({
      campaign_id: id,
      campaign_name: row.campaign_name == null ? null : String(row.campaign_name),
      client_tag: String(row.client_tag ?? ""),
      smartlead_client_id: client != null && Number.isFinite(client) ? client : null,
      lane: row.lane == null ? null : String(row.lane),
      status: row.status == null ? null : String(row.status),
    });
  }
  return out;
}

/**
 * D49 — the registry names a lane's campaigns. An ACTIVE registry row for
 * this client and this lane joins the inferred routing even when the receipt
 * that named the lane still lists older campaign ids; the campaign's own
 * build record then supplies its query (D47). Nothing is removed here and
 * nothing is invented: a campaign the registry puts on another lane, or
 * marks retired, or that is never topped up, stays out. Parlay keeps its
 * Sept 29 rule (D45) and does not come through here.
 */
export function addRegisteredLaneCampaigns(recipe: Recipe, rows: readonly RegistryCampaign[]): Recipe {
  if (recipe.client_tag === "parlay") return recipe;
  const have = new Set(recipe.routing.map((rule) => rule.campaign_id));
  const extra: number[] = [];
  for (const row of rows) {
    if (have.has(row.campaign_id) || extra.includes(row.campaign_id)) continue;
    if (row.client_tag !== recipe.client_tag) continue;
    if (row.smartlead_client_id != null && row.smartlead_client_id !== recipe.smartlead_client_id) continue;
    if (row.lane !== recipe.lane) continue;
    if (!registryActive(row.status)) continue;
    if (neverTopUp(row.campaign_id, row.campaign_name)) continue;
    extra.push(row.campaign_id);
  }
  if (extra.length === 0) return recipe;
  return routingFor(recipe, [...have, ...extra]);
}
