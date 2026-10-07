import type { Recipe, RoutingRule } from "./schema.js";

/**
 * Sept 29 2026 Parlay refresh. Top ups use only these campaigns.
 * Older Sports Offer, Trendrr, Receipts, EOS, Tickets, and Choice
 * campaigns are retired.
 */
export const PARLAY_CLIENT = "parlay";
export const PARLAY_REFRESH_FIRST = 4049046;
export const PARLAY_REFRESH_LAST = 4049064;

export const PARLAY_RETIRED_RECIPE_IDS = [
  "parlay.it_dm_legacy_sports.v0",
  "parlay.it_dm_tickets.v0",
  "parlay.it_dm_airpods.v0",
  "parlay.adjacent_dm.v0",
] as const;

export const PARLAY_RETIRED_LANES = ["it_dm_legacy_sports", "it_dm_tickets", "it_dm_airpods", "adjacent_dm"] as const;

/** Lanes the Sept 29 refresh still fills. */
export const PARLAY_REFRESH_LANES = ["owner", "ops_dm", "it_dm"] as const;

/**
 * Campaigns Cayden retired on 2026-10-07. Includes the Sports Offer ids,
 * 3847837–3847850, and the two Choice campaigns that sat past that range.
 */
export const PARLAY_RETIRED_CAMPAIGN_IDS: readonly number[] = [
  3479011,
  3628957,
  3705889,
  ...Array.from({ length: 3847850 - 3847837 + 1 }, (_, i) => 3847837 + i),
  3929973,
  3929974,
];

/**
 * Sept 29 campaigns already named in the live registry or on a Sept 29 build.
 * The rest of 4049046–4049064 are registered from pull receipts when a row exists.
 */
export const PARLAY_REFRESH_KNOWN: readonly { campaign_id: number; lane: string; campaign_name: string }[] = [
  { campaign_id: 4049046, lane: "ops_dm", campaign_name: "Parlay Ops FinServ Choice" },
  { campaign_id: 4049052, lane: "ops_dm", campaign_name: "Parlay Ops FinServ SEG Choice" },
  { campaign_id: 4049053, lane: "owner", campaign_name: "Parlay Owner FinServ Choice" },
  { campaign_id: 4049054, lane: "owner", campaign_name: "Parlay Owner FinServ SEG Choice" },
  { campaign_id: 4049055, lane: "it_dm", campaign_name: "Parlay IT FinServ Choice" },
  { campaign_id: 4049056, lane: "it_dm", campaign_name: "Parlay IT FinServ SEG Choice" },
  { campaign_id: 4049061, lane: "it_dm", campaign_name: "Parlay IT Arch Choice" },
  { campaign_id: 4049062, lane: "it_dm", campaign_name: "Parlay IT Arch SEG Choice" },
];

const RETIRED_IDS = new Set<number>(PARLAY_RETIRED_CAMPAIGN_IDS);
const RETIRED_RECIPES = new Set<string>(PARLAY_RETIRED_RECIPE_IDS);
const RETIRED_LANES = new Set<string>(PARLAY_RETIRED_LANES);
const REFRESH_LANES = new Set<string>(PARLAY_REFRESH_LANES);

export function isParlayRefreshCampaign(id: number): boolean {
  return Number.isInteger(id) && id >= PARLAY_REFRESH_FIRST && id <= PARLAY_REFRESH_LAST;
}

export function parlayCampaignRetired(id: number): boolean {
  return RETIRED_IDS.has(id);
}

export function isRetiredParlayRecipe(recipeId: string): boolean {
  return RETIRED_RECIPES.has(recipeId);
}

export function isRetiredParlayLane(lane: string): boolean {
  return RETIRED_LANES.has(lane);
}

export function isParlayRefreshLane(lane: string): boolean {
  return REFRESH_LANES.has(lane);
}

/** Queue, watch, and start_topup keep a Parlay campaign only inside the Sept 29 range. */
export function parlayQueueKeeps(clientTag: string, campaignId: number): boolean {
  if (clientTag !== PARLAY_CLIENT) return true;
  return isParlayRefreshCampaign(campaignId);
}

type Routed = {
  recipe_id: string;
  client_tag: string;
  lane: string;
  routing: RoutingRule[];
  segments: Recipe["segments"];
};

/** Drop retired Parlay campaigns from a recipe. A retired lane or recipe loses every route. */
export function shapeParlayRecipe<T extends Routed>(recipe: T): T {
  if (recipe.client_tag !== PARLAY_CLIENT) return recipe;
  const dropAll = isRetiredParlayRecipe(recipe.recipe_id) || isRetiredParlayLane(recipe.lane);
  const routing = dropAll ? [] : recipe.routing.filter((rule) => isParlayRefreshCampaign(rule.campaign_id));
  if (routing.length === recipe.routing.length && !dropAll) return recipe;
  const segments = { ...recipe.segments };
  if (Array.isArray(segments.slot)) {
    const keep = new Set(routing.map((rule) => String(rule.campaign_id)));
    segments.slot = segments.slot.filter((slot) => keep.has(slot));
  }
  return { ...recipe, routing, segments };
}

/**
 * A file recipe that names no Sept 29 campaign must not override the receipt
 * for that lane. An empty route list counts: there is no live cell to inherit.
 */
export function parlayLaneFileSuperseded(file: { client_tag: string; recipe_id: string; routing: { campaign_id: number }[] }): boolean {
  if (file.client_tag !== PARLAY_CLIENT) return false;
  if (file.recipe_id.endsWith(".v0")) return false;
  if (isRetiredParlayRecipe(file.recipe_id)) return true;
  return file.routing.every((rule) => !isParlayRefreshCampaign(rule.campaign_id));
}
