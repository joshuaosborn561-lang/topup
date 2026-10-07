import type { Repo } from "../db/repo.js";
import { parseRecipe, type Recipe } from "./schema.js";
import { getleadsParamsFromFilters, inferredRecipeId, laneFromReceipts, recipeFromReceipts, type ReceiptStamp } from "./infer.js";
import { isParlayRefreshCampaign, isParlayRefreshLane, isRetiredParlayLane, PARLAY_REFRESH_FIRST, PARLAY_REFRESH_LAST, shapeParlayRecipe } from "./parlay.js";
import { trimToOwningClient } from "./trim.js";

export type ResolvedRecipe = { ok: true; recipe: Recipe; inferred: boolean } | { ok: false; message: string };

function stampsFromRepo(rows: Awaited<ReturnType<Repo["listPullReceipts"]>>): ReceiptStamp[] {
  return rows.map((r) => ({
    written_by: r.written_by,
    written_at: r.written_at,
    client_tag: r.client_tag,
    smartlead_client_id: r.smartlead_client_id,
    lane: r.lane,
    campaign_ids: r.campaign_ids,
    icp_kind: r.icp_kind,
    persona: r.persona,
    company_source: r.company_source,
    company_filters: r.company_filters,
    domain_source: r.domain_source ?? undefined,
    person_source: r.person_source ?? undefined,
    email_source: r.email_source,
    email_max_tier: r.email_max_tier,
    how_i_did_it: r.how_i_did_it,
    notes: r.notes,
    segment: r.segment,
    granularity: r.granularity,
    rows_imported: r.rows_imported,
    rows_found: r.rows_found,
    tam_count: r.tam_count,
    build_label: r.build_label,
  }));
}

/**
 * File recipe wins. Otherwise infer from pull_receipts tags + notes and
 * persist as client.lane.v0 so the run FK holds (D45).
 */
export async function resolveRecipeForStart(
  repo: Repo,
  input: { clientTag: string; lane?: string | null; campaignId?: number | null; smartleadClientId?: number | null },
): Promise<ResolvedRecipe> {
  let lane = input.lane ?? null;
  if (!lane && input.campaignId) {
    lane = await repo.laneForCampaign(input.clientTag, input.campaignId);
  }
  if (!lane) {
    const receipts = await repo.listPullReceipts({ clientTag: input.clientTag, campaignId: input.campaignId });
    lane = laneFromReceipts(stampsFromRepo(receipts), input.campaignId ?? undefined);
  }
  if (input.clientTag === "parlay" && input.campaignId && !isParlayRefreshCampaign(input.campaignId)) {
    return {
      ok: false,
      message: `Campaign #${input.campaignId} is retired. Parlay top ups use campaigns ${PARLAY_REFRESH_FIRST} to ${PARLAY_REFRESH_LAST}.`,
    };
  }
  if (input.clientTag === "parlay" && lane && isRetiredParlayLane(lane)) {
    return {
      ok: false,
      message: `parlay/${lane} is retired. Top ups use the Sept 29 campaigns ${PARLAY_REFRESH_FIRST} to ${PARLAY_REFRESH_LAST}.`,
    };
  }
  if (!lane) {
    return {
      ok: false,
      message: input.campaignId
        ? `No pull receipt names ${input.clientTag} campaign #${input.campaignId}. Write a receipt (tags + notes) or a file recipe. The service does not invent a lane.`
        : `Need lane or campaign_id for ${input.clientTag}. start_topup(client_tag, campaign_id, count) or start_topup(client_tag, lane).`,
    };
  }

  const found = await repo.findRecipe(input.clientTag, lane);
  // File recipe (not .v0) is the override. A stored inferred v0 is
  // re-read from receipts so a new stamp is not stuck behind an old row.
  if (found && !found.recipe_id.endsWith(".v0")) {
    try {
      const parsed = shapeParlayRecipe(parseRecipe(found.body));
      if (parsed.client_tag !== "parlay" || parsed.routing.length > 0) {
        return { ok: true, recipe: parsed, inferred: false };
      }
    } catch (err) {
      return { ok: false, message: `Recipe ${found.recipe_id} does not validate: ${(err as Error).message}` };
    }
  }

  const receipts = await repo.listPullReceipts({
    clientTag: input.clientTag,
    lane,
    campaignId: input.campaignId,
  });
  const stamps = stampsFromRepo(receipts);
  if (stamps.length === 0) {
    return {
      ok: false,
      message: `No recipe and no pull receipt for ${input.clientTag}/${lane}. Recipes are inferred from topup.pull_receipts (tags + notes). The service does not invent one.`,
    };
  }

  const clientId =
    input.smartleadClientId ??
    stamps.find((s) => s.smartlead_client_id && s.smartlead_client_id > 0)?.smartlead_client_id ??
    null;
  if (!clientId) {
    return {
      ok: false,
      message: `Receipts for ${input.clientTag}/${lane} have no smartlead_client_id. Add topup.client_map. Do not invent an id.`,
    };
  }

  let recipe: Recipe;
  try {
    recipe = recipeFromReceipts({
      receipts: stamps,
      smartleadClientId: clientId,
      extraCampaignIds: input.campaignId ? [input.campaignId] : [],
    });
  } catch (err) {
    return { ok: false, message: `Could not infer a recipe from receipts for ${input.clientTag}/${lane}: ${(err as Error).message}` };
  }

  const trimmed = await trimToOwningClient(repo, shapeParlayRecipe(recipe));
  recipe = await addRegisteredParlayCampaigns(repo, trimmed.recipe);
  recipe = await sourceFromSept29Builds(repo, recipe);
  if (recipe.client_tag === "parlay" && recipe.routing.length === 0) {
    return {
      ok: false,
      message: `parlay/${recipe.lane} has no Sept 29 campaigns. Top ups use ${PARLAY_REFRESH_FIRST} to ${PARLAY_REFRESH_LAST}.`,
    };
  }

  await repo.upsertRecipe({
    recipe_id: inferredRecipeId(recipe.client_tag, recipe.lane),
    client_tag: recipe.client_tag,
    lane: recipe.lane,
    version: 0,
    body: recipe,
    owner_approved_at: null,
  });
  return { ok: true, recipe, inferred: true };
}

/** Registry rows in the Sept 29 range join the lane even when the receipt still lists the old campaign ids. */
async function addRegisteredParlayCampaigns(repo: Repo, recipe: Recipe): Promise<Recipe> {
  if (recipe.client_tag !== "parlay" || !isParlayRefreshLane(recipe.lane)) return recipe;
  let rows: Array<{ id: string }> = [];
  try {
    const res = await repo.raw().query<{ id: string }>(
      `select campaign_id::text as id from topup.campaign_registry
        where client_tag = 'parlay' and lane = $1
          and campaign_id between $2 and $3
          and coalesce(status, '') <> 'retired'`,
      [recipe.lane, PARLAY_REFRESH_FIRST, PARLAY_REFRESH_LAST],
    );
    rows = res.rows;
  } catch {
    return recipe;
  }
  const have = new Set(recipe.routing.map((rule) => rule.campaign_id));
  const extra = rows.map((row) => Number(row.id)).filter((id) => isParlayRefreshCampaign(id) && !have.has(id));
  if (extra.length === 0) return recipe;
  const icp = recipe.routing[0]?.icp ?? { kind: "linkedin_native" as const, persona: recipe.lane };
  const routing = [...recipe.routing, ...extra.map((id) => ({ when: { slot: String(id) }, campaign_id: id, icp }))].sort(
    (a, b) => a.campaign_id - b.campaign_id,
  );
  return { ...recipe, routing, segments: { ...recipe.segments, slot: routing.map((rule) => String(rule.campaign_id)) } };
}

/**
 * A Sept 29 build that counted by job function replaces an older title list.
 * Owner lanes that already name titles stay on those titles.
 */
async function sourceFromSept29Builds(repo: Repo, recipe: Recipe): Promise<Recipe> {
  if (recipe.client_tag !== "parlay" || !isParlayRefreshLane(recipe.lane)) return recipe;
  if (recipe.source.kind === "getleads" && recipe.source.params.job_function) return recipe;
  const ids = recipe.routing.map((rule) => rule.campaign_id);
  const rows = await repo.campaignBuilds(recipe.client_tag, ids).catch(() => [] as Record<string, unknown>[]);
  const sept = rows.filter((row) => String(row.build_label ?? "").includes("20260929"));
  for (const row of sept) {
    const filters = row.company_filters;
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) continue;
    const params = getleadsParamsFromFilters(filters as Record<string, unknown>);
    if (!params?.job_function) continue;
    return { ...recipe, source: { kind: "getleads", params, widening_candidates: [] } };
  }
  return recipe;
}
