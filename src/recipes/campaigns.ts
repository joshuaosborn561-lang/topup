import { neverTopUp } from "../config.js";
import { NON_TARGET_CAMPAIGN_STATUSES } from "../policy/index.js";
import { PARLAY_REFRESH_FIRST, PARLAY_REFRESH_LAST, parlayCampaignRetired } from "./parlay.js";
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
  if (!band || !src.params.company_size?.includes(band)) return src;
  return { ...src, params: { ...src.params, company_size: [band] } };
}

export function mergeGetleadsSources(sources: Source[]): Source {
  const first = sources[0];
  if (!first) throw new Error("mergeGetleadsSources needs a source");
  if (first.kind !== "getleads" || sources.some((s) => s.kind !== "getleads")) return first;
  const bands = [...new Set(sources.flatMap((s) => (s.kind === "getleads" && s.params.company_size ? s.params.company_size : [])))];
  const titles = [...new Set(sources.flatMap((s) => (s.kind === "getleads" ? (s.params.job_titles ?? []) : [])))];
  const params = {
    ...first.params,
    job_titles: titles.length ? titles : first.params.job_titles,
  };
  if (bands.length) params.company_size = bands as GetleadsSource["params"]["company_size"];
  else delete params.company_size;
  return { ...first, params };
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
    if (src.kind === "getleads") for (const t of src.params.job_titles ?? []) titles.add(t);
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
  return ids.filter((id) => allowed.has(id) && !neverTopUp(id) && !parlayCampaignRetired(id));
}

/** Smartlead statuses that are not topped up (policy, D46). STOPPED stays. A blank status stays. */
export const NON_LIVE_CAMPAIGN_STATUSES = NON_TARGET_CAMPAIGN_STATUSES;

export function isLiveCampaignStatus(status: string | null | undefined): boolean {
  if (status == null) return true;
  const name = status.trim().toUpperCase();
  if (!name) return true;
  return !(NON_LIVE_CAMPAIGN_STATUSES as readonly string[]).includes(name);
}

/** ACTIVE, or a blank status the mirror did not classify. */
function isActiveCampaignStatus(status: string | null | undefined): boolean {
  if (status == null) return true;
  const name = status.trim().toUpperCase();
  if (!name) return true;
  return name === "ACTIVE";
}

/**
 * Drop completed, drafted, paused, and archived campaigns.
 * An id with no status row stays, so a mirror that has no status does not wipe the recipe.
 */
export function keepLiveCampaigns(ids: readonly number[], statusById: ReadonlyMap<number, string | null | undefined>): number[] {
  return ids.filter((id) => {
    if (!statusById.has(id)) return true;
    return isLiveCampaignStatus(statusById.get(id));
  });
}

/**
 * Targets for a run: the stored set minus campaigns that are not live, plus
 * every ACTIVE recipe campaign the stored set left out.
 * An empty status map leaves the stored set alone.
 */
export function liveTargetCampaignIds(
  recipe: Recipe,
  stored: readonly number[],
  statusById: ReadonlyMap<number, string | null | undefined>,
): number[] {
  const recipeIds = ownedTargets(recipe, recipeCampaignIds(recipe));
  const keptStored = ownedTargets(recipe, stored);
  if (statusById.size === 0) return keptStored.length ? keptStored : recipeIds;
  const liveStored = keepLiveCampaigns(keptStored, statusById);
  const extras = recipeIds.filter((id) => {
    if (liveStored.includes(id)) return false;
    if (!statusById.has(id)) return false;
    return isActiveCampaignStatus(statusById.get(id));
  });
  return [...liveStored, ...extras];
}

type StatusQuery = {
  query: <R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>;
};

/** public.campaigns status by Smartlead id. Empty when the mirror is not here. */
export async function loadCampaignStatuses(db: StatusQuery, ids: readonly number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  if (ids.length === 0) return out;
  const { rows: tables } = await db.query<{ ok: boolean }>(`select to_regclass('public.campaigns') is not null as ok`);
  if (!tables[0]?.ok) return out;
  const { rows } = await db.query<{ id: string; status: string | null }>(
    `select smartlead_campaign_id::text as id, status from public.campaigns where smartlead_campaign_id = any($1::bigint[])`,
    [ids],
  );
  for (const row of rows) out.set(Number(row.id), row.status == null ? null : String(row.status));
  return out;
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
  repo: {
    getStep: (runId: string, step: "trigger") => Promise<{ counts: Record<string, number> } | null>;
    raw: () => StatusQuery;
  },
  run: { run_id: string; campaign_id: number | null; counts_by_status: Record<string, number> },
  recipe: Recipe,
): Promise<number[]> {
  const trigger = await repo.getStep(run.run_id, "trigger");
  const stored = targetCampaignIds(recipe, run, trigger?.counts);
  const statuses = await loadCampaignStatuses(repo.raw(), recipeCampaignIds(recipe));
  return liveTargetCampaignIds(recipe, stored, statuses);
}

export function resolveTargetCampaignIds(
  recipe: Recipe,
  requested?: number[],
): { ok: true; ids: number[] } | { ok: false; message: string } {
  const all = recipeCampaignIds(recipe).filter((id) => !parlayCampaignRetired(id));
  const requestedIds = [...new Set(requested ?? [])];
  const retired = requestedIds.filter((id) => parlayCampaignRetired(id));
  const unique = requestedIds.filter((id) => !neverTopUp(id) && !parlayCampaignRetired(id));
  if (retired.length && unique.length === 0) {
    return {
      ok: false,
      message: `Campaign(s) ${retired.map((id) => `#${id}`).join(", ")} are retired. Parlay top ups use campaigns ${PARLAY_REFRESH_FIRST} to ${PARLAY_REFRESH_LAST}.`,
    };
  }
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
