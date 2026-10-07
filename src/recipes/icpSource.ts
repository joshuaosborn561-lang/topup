import { ruleSource } from "./campaigns.js";
import type { Recipe, RoutingRule, Source } from "./schema.js";

/**
 * Per campaign, the ICP source is chosen in this order:
 * 1. The file recipe's cell for that campaign.
 * 2. The receipt (tags, notes, or a complete adapter the receipt named).
 * 3. The lane recipe's ICP.
 * A campaign with none of the three stays mixed and is named.
 */
export type IcpSourceUsed = "cell" | "receipt" | "lane";

export function applyIcpSources(
  recipe: Recipe,
  fileRecipes: readonly Recipe[],
): { recipe: Recipe; used: Record<string, IcpSourceUsed>; missing: number[] } {
  const used: Record<string, IcpSourceUsed> = {};
  const missing: number[] = [];
  const routing = recipe.routing.map((rule) => {
    const cell = fileCellSource(recipe, fileRecipes, rule.campaign_id);
    if (cell) {
      used[String(rule.campaign_id)] = "cell";
      return { ...rule, source: cell };
    }
    const receipt = receiptSource(recipe, rule);
    if (receipt) {
      used[String(rule.campaign_id)] = "receipt";
      return { ...rule, source: receipt };
    }
    const lane = laneSource(recipe, fileRecipes, rule);
    if (lane) {
      used[String(rule.campaign_id)] = "lane";
      return { ...rule, source: lane };
    }
    missing.push(rule.campaign_id);
    return rule;
  });
  return { recipe: { ...recipe, routing }, used, missing };
}

function concreteSource(source: Source | undefined): Source | null {
  if (!source) return null;
  if (source.kind === "mixed") return source.parts.length > 0 ? source : null;
  return source;
}

function fileCellSource(recipe: Recipe, files: readonly Recipe[], campaignId: number): Source | null {
  const candidates = files.filter(
    (file) =>
      file.client_tag === recipe.client_tag &&
      !file.recipe_id.endsWith(".v0") &&
      file.routing.some((rule) => rule.campaign_id === campaignId),
  );
  candidates.sort((a, b) => Number(a.lane !== recipe.lane) - Number(b.lane !== recipe.lane));
  for (const file of candidates) {
    const rule = file.routing.find((item) => item.campaign_id === campaignId);
    if (!rule) continue;
    const source = concreteSource(ruleSource(file, rule));
    if (source) return source;
  }
  return null;
}

function receiptSource(recipe: Recipe, rule: RoutingRule): Source | null {
  const own = concreteSource(rule.source);
  if (own) return own;
  if (recipe.source.kind === "mixed" && recipe.source.parts.length > 0) return recipe.source;
  if (recipe.recipe_id.endsWith(".v0")) return concreteSource(ruleSource(recipe, rule));
  return null;
}

function laneSource(recipe: Recipe, files: readonly Recipe[], rule: RoutingRule): Source | null {
  const laneFile = files.find(
    (file) => file.client_tag === recipe.client_tag && file.lane === recipe.lane && !file.recipe_id.endsWith(".v0") && concreteSource(file.source),
  );
  if (laneFile) {
    const inherited = concreteSource(ruleSource(laneFile, { ...rule, source: undefined }));
    if (inherited) return inherited;
  }
  if (!recipe.recipe_id.endsWith(".v0")) return concreteSource(ruleSource(recipe, rule));
  return null;
}
