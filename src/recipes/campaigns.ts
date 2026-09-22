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

/** Watch / `/topup` targets, falling back to every campaign the recipe names. */
export function targetCampaignIds(
  recipe: Recipe,
  run?: { campaign_id: number | null; counts_by_status?: Record<string, number> },
  stepCounts?: Record<string, number>,
): number[] {
  const fromStep = idsFromTargetCounts(stepCounts);
  if (fromStep.length) return fromStep;
  const fromRun = idsFromTargetCounts(run?.counts_by_status);
  if (fromRun.length) return fromRun;
  if (run?.campaign_id) return [run.campaign_id];
  return recipeCampaignIds(recipe);
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
  const unique = [...new Set(requested ?? [])];
  if (unique.length === 0) return { ok: true, ids: all };
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

/** Industries / maps categories that distinguish two pulls that share a persona. */
export function pullExtraKey(source: Source): string {
  if (source.kind === "getleads") {
    return [...(source.params.industries ?? []), ...(source.params.companyIndustry ?? []), ...(source.params.states ?? [])]
      .map((s) => s.toLowerCase())
      .sort()
      .join("+");
  }
  if (source.kind === "maps") {
    return source.params.categories.map((s) => s.toLowerCase()).sort().join("+");
  }
  return source.kind;
}

/** One GetLeads (or Maps) pull. Gift / offer / mail class do not split this. */
export function pullIdentity(recipe: Pick<Recipe, "client_tag">, group: CampaignGroup): string {
  return `${recipe.client_tag}|${group.kind}|${group.persona}|${group.source.kind}|${pullExtraKey(group.source)}`;
}

export function recipePullKeys(recipe: Recipe): string[] {
  return [...new Set(campaignGroups(recipe).map((g) => pullIdentity(recipe, g)))];
}

export function samePull(a: Recipe, b: Recipe): boolean {
  if (a.client_tag !== b.client_tag) return false;
  const keys = new Set(recipePullKeys(a));
  return recipePullKeys(b).some((k) => keys.has(k));
}

/** Union sibling routing so one pull can segment into tickets + AirPods (D40). */
export function mergeSiblingRecipes(primary: Recipe, siblings: Recipe[]): Recipe {
  const routing = [...primary.routing];
  const seen = new Set(routing.map((r) => `${r.campaign_id}|${JSON.stringify(r.when)}`));
  const segments: Record<string, string[]> = Object.fromEntries(
    Object.entries(primary.segments).map(([k, vals]) => [k, [...vals]]),
  );
  const addSeg = (dim: string, value: string) => {
    const cur = segments[dim] ?? [];
    if (!cur.includes(value)) segments[dim] = [...cur, value];
  };
  for (const sib of siblings) {
    if (sib.client_tag !== primary.client_tag || !samePull(primary, sib)) continue;
    for (const [dim, vals] of Object.entries(sib.segments)) {
      for (const v of vals) addSeg(dim, v);
    }
    for (const rule of sib.routing) {
      const key = `${rule.campaign_id}|${JSON.stringify(rule.when)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      routing.push(rule);
      for (const [dim, value] of Object.entries(rule.when)) addSeg(dim, value);
    }
  }
  return { ...primary, routing, segments };
}

/** Drop campaigns that are not working so leftovers do not land on a dead list. */
export function keepCampaigns(recipe: Recipe, campaignIds: number[]): Recipe {
  const want = new Set(campaignIds);
  return { ...recipe, routing: recipe.routing.filter((r) => want.has(r.campaign_id)) };
}
