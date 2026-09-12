import type { Repo } from "../../db/repo.js";
import type { RunRow } from "../../domain/runs.js";
import { campaignGroups, runTargetCampaignIds } from "../../recipes/campaigns.js";
import { parsePullReceipt, type COMPANY_SOURCES } from "../../recipes/receipt.js";
import type { Recipe } from "../../recipes/schema.js";

type CompanySource = (typeof COMPANY_SOURCES)[number];

function companySourceOf(recipe: Recipe, kind: string | undefined): CompanySource {
  const k = kind ?? recipe.source.kind;
  if (k === "getleads" || k === "maps" || k === "permits" || k === "ai_ark") return k;
  return "other";
}

/**
 * Step 11.5 — insert a build receipt for this run. Never update in place.
 * A failed insert must not fail the import (the leads are already in Smartlead).
 */
export async function writeRunReceipt(
  repo: Pick<Repo, "insertPullReceipt" | "getStep">,
  run: RunRow,
  recipe: Recipe,
  counts: Record<string, number>,
): Promise<string | null> {
  const campaignIds = await runTargetCampaignIds(repo, run, recipe);
  const groups = campaignGroups(recipe, campaignIds);
  const g = groups[0];
  const size = await repo.getStep(run.run_id, "size");
  const imported = counts.imported ?? 0;
  const found = counts.rows_exported ?? counts.rows_claimed ?? imported;
  const spend = Object.values(run.spend_cents_by_vendor ?? {}).reduce((a, n) => a + n, 0);
  const parsed = parsePullReceipt({
    written_by: "leadtopup",
    granularity: "build",
    build_label: `topup_${run.client_tag}_${run.lane}_${run.run_id.slice(0, 8)}`,
    client_tag: recipe.client_tag,
    smartlead_client_id: recipe.smartlead_client_id,
    lane: recipe.lane,
    campaign_ids: campaignIds,
    icp_kind: g?.kind ?? "linkedin_native",
    persona: g?.persona ?? recipe.lane,
    company_source: companySourceOf(recipe, g?.source.kind),
    company_filters: g?.source.kind === "getleads" ? (g.source.params as unknown as Record<string, unknown>) : {},
    domain_source: recipe.source.kind === "getleads" ? "already" : "domain_waterfall",
    person_source: recipe.source.kind === "getleads" ? "getleads" : "people_waterfall",
    email_source: recipe.email_finding.enabled ? "email_waterfall" : recipe.source.kind === "getleads" ? "getleads" : "none",
    email_max_tier: recipe.email_finding.enabled ? recipe.email_finding.max_tier : null,
    rows_found: found,
    rows_imported: imported,
    tam_count: size?.counts.total_matching ?? counts.total_matching ?? null,
    yield_by_step: { imported, verified_sendable: counts.verified ?? undefined },
    spend_cents: spend,
    segment: recipe.segments,
    suppression_scope: "response_based_v1",
    how_i_did_it: `leadtopup run ${run.run_id.slice(0, 8)} on ${recipe.recipe_id}: ${recipe.source.kind} then the shared tail. Build label is the run source_label.`,
    notes: null,
  });
  return repo.insertPullReceipt({
    written_by: parsed.written_by,
    client_tag: parsed.client_tag,
    smartlead_client_id: parsed.smartlead_client_id,
    lane: parsed.lane,
    campaign_ids: parsed.campaign_ids,
    icp_kind: parsed.icp_kind,
    persona: parsed.persona,
    company_source: parsed.company_source,
    company_filters: parsed.company_filters,
    domain_source: parsed.domain_source,
    person_source: parsed.person_source,
    email_source: parsed.email_source,
    email_max_tier: parsed.email_max_tier,
    rows_found: parsed.rows_found,
    rows_imported: parsed.rows_imported,
    tam_count: parsed.tam_count,
    how_i_did_it: parsed.how_i_did_it,
    notes: parsed.notes,
    segment: parsed.segment,
    yield_by_step: parsed.yield_by_step,
    spend_cents: parsed.spend_cents,
    suppression_scope: parsed.suppression_scope,
    build_label: parsed.build_label,
    granularity: parsed.granularity,
  });
}
