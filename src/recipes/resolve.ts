import type { Repo } from "../db/repo.js";
import { logger } from "../lib/log.js";
import { parseRecipe, type Recipe } from "./schema.js";
import { inferredRecipeId, laneFromReceipts, recipeFromReceipts, scopeCampaignIds, type ReceiptStamp } from "./infer.js";

const log = logger("recipes");

export type ResolvedRecipe = { ok: true; recipe: Recipe; inferred: boolean } | { ok: false; message: string };

function stampsFromRepo(rows: Awaited<ReturnType<Repo["listPullReceipts"]>>): ReceiptStamp[] {
  return rows.map((r) => ({
    receipt_id: r.receipt_id,
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
      return { ok: true, recipe: parseRecipe(found.body), inferred: false };
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

  // D46: scope the receipts' campaign ids to this lane and this client
  // before anything is routed, registered or counted.
  const allIds = [...new Set(stamps.flatMap((s) => s.campaign_ids))];
  const [laneRowClaims, owners] = await Promise.all([repo.laneRowCampaignLanes(input.clientTag), repo.campaignOwners(allIds)]);
  const scoped = scopeCampaignIds({ stamps, lane, smartleadClientId: clientId, laneRowClaims, owners });
  if (scoped.dropped.claimed_by_other_lane.length || scoped.dropped.other_client.length) {
    log.info("receipt campaign ids scoped", {
      client_tag: input.clientTag,
      lane,
      kept: scoped.own.length,
      claimed_by_other_lane: scoped.dropped.claimed_by_other_lane.length,
      other_client: scoped.dropped.other_client.length,
    });
  }
  if (!scoped.hasLaneRow && scoped.own.length === 0 && !input.campaignId) {
    const lanes = [...new Set(scoped.dropped.claimed_by_other_lane.map((d) => d.lane))];
    const foreign = scoped.dropped.other_client.length;
    return {
      ok: false,
      message:
        `${input.clientTag}/${lane} has no lane row and names no campaign of its own` +
        (lanes.length ? `; its build rows point at campaigns that belong to lane row(s) ${lanes.join(", ")}` : "") +
        (foreign ? `; ${foreign} id(s) belong to other Smartlead clients` : "") +
        ". It is a build segment, not a lane — no run. If it is a lane, write a lane row for it (skills/first-pull-receipt/BACKFILL.md).",
    };
  }

  let recipe: Recipe;
  try {
    recipe = recipeFromReceipts({
      receipts: scoped.stamps,
      smartleadClientId: clientId,
      extraCampaignIds: input.campaignId ? [input.campaignId] : [],
    });
  } catch (err) {
    return { ok: false, message: `Could not infer a recipe from receipts for ${input.clientTag}/${lane}: ${(err as Error).message}` };
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
