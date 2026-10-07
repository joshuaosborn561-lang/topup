import type { Recipe, RoutingRule, Source } from "./schema.js";

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

/**
 * Industries the Sept 29 receipts stored as arrays.
 * Adjacent builds say "10 FinServ sibling industries (adjacent set)" in prose.
 * Those ten names are not on the receipt, so they are not sent.
 */
export const PARLAY_FINSERV_INDUSTRIES = ["Financial Services"] as const;
export const PARLAY_ARCH_INDUSTRIES = ["Architecture and Planning"] as const;

const PARLAY_CAMPAIGN_INDUSTRIES: Readonly<Record<number, readonly string[]>> = {
  4049046: PARLAY_FINSERV_INDUSTRIES,
  4049052: PARLAY_FINSERV_INDUSTRIES,
  4049053: PARLAY_FINSERV_INDUSTRIES,
  4049054: PARLAY_FINSERV_INDUSTRIES,
  4049055: PARLAY_FINSERV_INDUSTRIES,
  4049056: PARLAY_FINSERV_INDUSTRIES,
  4049061: PARLAY_ARCH_INDUSTRIES,
  4049062: PARLAY_ARCH_INDUSTRIES,
  4049063: PARLAY_ARCH_INDUSTRIES,
  4049064: PARLAY_ARCH_INDUSTRIES,
};

export function parlayCampaignIndustries(campaignId: number): readonly string[] | null {
  return PARLAY_CAMPAIGN_INDUSTRIES[campaignId] ?? null;
}

type Routed = {
  recipe_id: string;
  client_tag: string;
  lane: string;
  source: Source;
  routing: RoutingRule[];
  segments: Recipe["segments"];
};

function withParlayIndustry(fallback: Source, rule: RoutingRule): RoutingRule {
  const industries = PARLAY_CAMPAIGN_INDUSTRIES[rule.campaign_id];
  if (!industries) return rule;
  const base = rule.source ?? fallback;
  if (base.kind !== "getleads") return rule;
  const current = base.params.industries ?? [];
  const same = current.length === industries.length && current.every((name, i) => name === industries[i]);
  if (rule.source && same) return rule;
  return { ...rule, source: { ...base, params: { ...base.params, industries: [...industries] } } };
}

/** Drop retired Parlay campaigns from a recipe. A retired lane or recipe loses every route. */
export function shapeParlayRecipe<T extends Routed>(recipe: T): T {
  if (recipe.client_tag !== PARLAY_CLIENT) return recipe;
  const dropAll = isRetiredParlayRecipe(recipe.recipe_id) || isRetiredParlayLane(recipe.lane);
  const routing = (dropAll ? [] : recipe.routing.filter((rule) => isParlayRefreshCampaign(rule.campaign_id))).map((rule) =>
    withParlayIndustry(recipe.source, rule),
  );
  if (routing.length === recipe.routing.length && routing.every((rule, i) => rule === recipe.routing[i]) && !dropAll) return recipe;
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
