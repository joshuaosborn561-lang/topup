import { neverTopUp } from "../config.js";
import { GETLEADS_BANDS, type GetleadsSource, type Recipe, type RoutingRule, type Source } from "./schema.js";

/**
 * Campaign-scoped ICP / source (D30). A lane recipe is the default template;
 * each routing rule names the campaign's kind, persona, band, and optional
 * source override. Size and pull group campaigns that share a stack; mixed
 * kinds or personas in one run park.
 */

const SEGMENT_TO_BAND: Record<string, (typeof GETLEADS_BANDS)[number]> = {
  "1_10": "1 to 10",
  "11_50": "11 to 50",
  "51_200": "51 to 200",
  "201_500": "201 to 500",
  "501_1000": "501 to 1000",
  "1001_5000": "1001 to 5000",
  "5001_10000": "5001 to 10000",
  "10001_plus": "10001+",
};

export const TARGET_COUNT_PREFIX = "target_";

export function segmentToBand(segment: string): (typeof GETLEADS_BANDS)[number] | null {
  return SEGMENT_TO_BAND[segment] ?? null;
}

export function recipeCampaignIds(recipe: Pick<Recipe, "routing">): number[] {
  return [...new Set(recipe.routing.map((r) => r.campaign_id))];
}

export function targetRules(recipe: Recipe, campaignIds?: number[]): RoutingRule[] {
  if (!campaignIds?.length) return recipe.routing;
  const want = new Set(campaignIds);
  return recipe.routing.filter((r) => want.has(r.campaign_id));
}

/** Recipe source, or the campaign override, with getleads bands sliced to this cell's band. */
export function ruleSource(recipe: Recipe, rule: RoutingRule): Source {
  if (rule.source) return rule.source;
  const src = recipe.source;
  if (src.kind !== "getleads") return src;
  const band = rule.when.band ? segmentToBand(rule.when.band) : null;
  if (!band || !src.params.company_size.includes(band)) return src;
  return { ...src, params: { ...src.params, company_size: [band] } };
}

export function mergeGetleadsSources(sources: Source[]): Source {
  const first = sources[0];
  if (!first) throw new Error("mergeGetleadsSources needs a source");
  if (first.kind !== "getleads" || sources.some((s) => s.kind !== "getleads")) return first;
  const bands = [...new Set(sources.flatMap((s) => (s.kind === "getleads" ? s.params.company_size : [])))];
  const titles = [...new Set(sources.flatMap((s) => (s.kind === "getleads" ? s.params.job_titles : [])))];
  return {
    ...first,
    params: {
      ...first.params,
      company_size: bands.length ? (bands as GetleadsSource["params"]["company_size"]) : first.params.company_size,
      job_titles: titles.length ? titles : first.params.job_titles,
    },
  };
}

export type CampaignGroup = {
  key: string;
  kind: RoutingRule["icp"]["kind"];
  persona: string;
  campaignIds: number[];
  source: Source;
};

export function campaignGroups(recipe: Recipe, campaignIds?: number[]): CampaignGroup[] {
  const buckets = new Map<string, { kind: CampaignGroup["kind"]; persona: string; ids: number[]; sources: Source[] }>();
  for (const rule of targetRules(recipe, campaignIds)) {
    const src = ruleSource(recipe, rule);
    const key = `${rule.icp.kind}|${rule.icp.persona}|${src.kind}`;
    const b = buckets.get(key) ?? { kind: rule.icp.kind, persona: rule.icp.persona, ids: [], sources: [] };
    if (!b.ids.includes(rule.campaign_id)) b.ids.push(rule.campaign_id);
    b.sources.push(src);
    buckets.set(key, b);
  }
  return [...buckets.values()].map((b) => ({
    key: `${b.kind}|${b.persona}|${b.sources[0]!.kind}`,
    kind: b.kind,
    persona: b.persona,
    campaignIds: b.ids,
    source: mergeGetleadsSources(b.sources),
  }));
}

export function jobTitlesFor(recipe: Recipe, campaignIds?: number[]): string[] {
  const titles = new Set<string>();
  for (const rule of targetRules(recipe, campaignIds)) {
    const src = ruleSource(recipe, rule);
    if (src.kind === "getleads") for (const t of src.params.job_titles) titles.add(t);
  }
  return [...titles];
}

export function targetCountPatch(ids: readonly number[]): Record<string, number> {
  return Object.fromEntries(ids.map((id) => [`${TARGET_COUNT_PREFIX}${id}`, 1]));
}

export function idsFromTargetCounts(counts?: Record<string, number>): number[] {
  if (!counts) return [];
  return Object.entries(counts)
    .filter(([k, v]) => k.startsWith(TARGET_COUNT_PREFIX) && v > 0)
    .map(([k]) => Number(k.slice(TARGET_COUNT_PREFIX.length)))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

function ownedTargets(recipe: Recipe, ids: readonly number[]): number[] {
  const allowed = new Set(recipeCampaignIds(recipe));
  return ids.filter((id) => allowed.has(id) && !neverTopUp(id));
}

/**
 * Watch / `/topup` targets, falling back to every campaign the recipe names.
 * A stale target_* set cannot bring back a campaign the recipe no longer
 * names, or one that is never topped up.
 */
export function targetCampaignIds(
  recipe: Recipe,
  run?: { campaign_id: number | null; counts_by_status?: Record<string, number> },
  stepCounts?: Record<string, number>,
): number[] {
  const fromStep = idsFromTargetCounts(stepCounts);
  if (fromStep.length) {
    const kept = ownedTargets(recipe, fromStep);
    if (kept.length) return kept;
  }
  const fromRun = idsFromTargetCounts(run?.counts_by_status);
  if (fromRun.length) {
    const kept = ownedTargets(recipe, fromRun);
    if (kept.length) return kept;
  }
  if (run?.campaign_id) {
    const one = ownedTargets(recipe, [run.campaign_id]);
    if (one.length) return one;
  }
  return ownedTargets(recipe, recipeCampaignIds(recipe));
}

/** Campaigns the size step marked skipped. The pull uses whoever is left. */
export function withoutSkipped(targets: readonly number[], sizeCounts?: Record<string, number>): number[] {
  if (!sizeCounts) return [...targets];
  const skipped = new Set(
    Object.entries(sizeCounts)
      .filter(([key, value]) => key.startsWith("skipped_") && value > 0)
      .map(([key]) => Number(key.slice("skipped_".length)))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
  if (skipped.size === 0) return [...targets];
  const kept = targets.filter((id) => !skipped.has(id));
  return kept.length ? kept : [...targets];
}

export async function runTargetCampaignIds(
  repo: { getStep: (runId: string, step: "trigger") => Promise<{ counts: Record<string, number> } | null> },
  run: { run_id: string; campaign_id: number | null; counts_by_status: Record<string, number> },
  recipe: Recipe,
): Promise<number[]> {
  const trigger = await repo.getStep(run.run_id, "trigger");
  return targetCampaignIds(recipe, run, trigger?.counts);
}

export function resolveTargetCampaignIds(
  recipe: Recipe,
  requested?: number[],
): { ok: true; ids: number[] } | { ok: false; message: string } {
  const all = recipeCampaignIds(recipe);
  const unique = [...new Set(requested ?? [])].filter((id) => !neverTopUp(id));
  if ((requested ?? []).some((id) => neverTopUp(id)) && unique.length === 0) {
    return { ok: false, message: `Campaign(s) ${(requested ?? []).map((id) => `#${id}`).join(", ")} are never topped up.` };
  }
  if (unique.length === 0) return { ok: true, ids: all.filter((id) => !neverTopUp(id)) };
  const unknown = unique.filter((id) => !all.includes(id));
  if (unknown.length) {
    return {
      ok: false,
      message: `Campaign(s) ${unknown.map((id) => `#${id}`).join(", ")} are not in ${recipe.client_tag}/${recipe.lane}. The recipe names ${all.map((id) => `#${id}`).join(", ") || "no campaigns"}.`,
    };
  }
  return { ok: true, ids: unique };
}

export function icpSummary(groups: CampaignGroup[]): string {
  if (groups.length === 0) return "no campaigns";
  return [...new Set(groups.map((g) => `${g.persona} / ${g.kind}`))].join("; ");
}
