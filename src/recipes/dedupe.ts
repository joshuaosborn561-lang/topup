import { recipeCampaignIds } from "./campaigns.js";
import type { Recipe } from "./schema.js";

/**
 * Two lanes that name the same campaigns and differ only by a trailing s
 * are one lane. PowerGRYD has both msp_owner and msp_owners. Keep the
 * recipe that names a real source. If both do, keep the longer lane name.
 */
export function dedupeAliasLanes(recipes: readonly Recipe[]): Recipe[] {
  const drop = new Set<string>();
  for (let i = 0; i < recipes.length; i++) {
    for (let j = i + 1; j < recipes.length; j++) {
      const a = recipes[i]!;
      const b = recipes[j]!;
      if (a.client_tag !== b.client_tag) continue;
      if (!sameCampaigns(a, b) || recipeCampaignIds(a).length === 0) continue;
      if (!aliasLanes(a.lane, b.lane)) continue;
      drop.add(loser(a, b).recipe_id);
    }
  }
  return recipes.filter((r) => !drop.has(r.recipe_id));
}

function sameCampaigns(a: Recipe, b: Recipe): boolean {
  const left = recipeCampaignIds(a).slice().sort((x, y) => x - y);
  const right = recipeCampaignIds(b).slice().sort((x, y) => x - y);
  return left.length === right.length && left.every((id, i) => id === right[i]);
}

/** msp_owner and msp_owners. Not two unrelated lanes that happen to share a letter. */
export function aliasLanes(a: string, b: string): boolean {
  if (a === b) return false;
  return stem(a) === stem(b);
}

function stem(lane: string): string {
  if (lane.endsWith("es") && lane.length > 3) return lane.slice(0, -2);
  if (lane.endsWith("s") && lane.length > 2) return lane.slice(0, -1);
  return lane;
}

function emptyMixed(recipe: Recipe): boolean {
  return recipe.source.kind === "mixed" && recipe.source.parts.length === 0;
}

function loser(a: Recipe, b: Recipe): Recipe {
  const aEmpty = emptyMixed(a);
  const bEmpty = emptyMixed(b);
  if (aEmpty !== bEmpty) return aEmpty ? a : b;
  if (a.lane.length !== b.lane.length) return a.lane.length < b.lane.length ? a : b;
  return a.lane < b.lane ? a : b;
}
