import type { Getleads } from "../../clients/getleads.js";
import type { RunRow } from "../../domain/runs.js";
import { backfillCompanySizes } from "../../recipes/backfillSize.js";
import { normalizeBand, type Band } from "../../recipes/bands.js";
import { campaignGroups, icpSummary, recipeCampaignIds, targetCampaignIds, targetCountPatch } from "../../recipes/campaigns.js";
import { leadmagicBackfillWorstCents, leadmagicCompanyBand, type PaidSizeHit } from "../../recipes/elsewhereSize.js";
import { isInferredRecipe } from "../../recipes/infer.js";
import type { Recipe } from "../../recipes/schema.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";
import { cellLabel, uncoveredCells } from "./cells.js";

/**
 * Step 1 — Nail the ICP (per campaign, D30 / D38).
 *
 * A handwritten recipe is the sign-off. When there is none, the service
 * infers titles from the list already in the campaign and the find-method
 * from receipt tags. Missing company_size bands are backfilled via
 * getleads counts (unlimited, no contact rows), then free sources, then
 * one LeadMagic leftover pass under $5 for the whole backfill. Missing
 * cells or campaigns that are not this client's still halt.
 */
export class TriggerStage {
  constructor(
    private readonly d: StageDeps & {
      getleads?: Getleads;
      leadmagicApiKey?: string;
      paidSize?: {
        lookup: (domain: string, companyName: string | null) => Promise<PaidSizeHit | null>;
        worstCaseCents: number;
      };
    },
  ) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "trigger", "open", async () => {
      const missing = uncoveredCells(recipe.segments, recipe.routing);
      const allIds = recipeCampaignIds(recipe);
      const campaignIds = targetCampaignIds(recipe, run);
      if (allIds.length === 0) {
        return gateUnmet("trigger", "the saved recipe has no campaigns in its routing; Josh signs off on the segment before anything is pulled", { cells: 0, campaigns: 0 });
      }
      if (missing.length) {
        return gateUnmet(
          "trigger",
          `saved ICP is missing a campaign for ${missing.length} cell(s): ${missing.slice(0, 6).map(cellLabel).join("; ")}${missing.length > 6 ? "…" : ""}. Josh knows one must be built.`,
          { cells: segmentCount(recipe), uncovered: missing.length, campaigns: allIds.length },
        );
      }
      const wrong = await this.foreignCampaigns(allIds, recipe.smartlead_client_id);
      if (wrong.length) {
        return gateUnmet(
          "trigger",
          `saved ICP names campaign(s) ${wrong.map((w) => `#${w.id} (${w.reason})`).join(", ")} — every cell needs a campaign of this client before a pull`,
          { cells: segmentCount(recipe), campaigns: allIds.length, foreign: wrong.length },
        );
      }

      const inferred = isInferredRecipe(recipe);
      let backfilled = 0;
      let unknown = 0;
      let paidCents = 0;
      if (this.d.getleads) {
        const paid = this.d.paidSize ?? paidSizeFromKey(this.d.leadmagicApiKey);
        const progress = await backfillCompanySizes(
          {
            listUnsizedDomains: (ids) => this.d.repo.listUnsizedDomains(ids),
            companyNameForDomain: (ids, domain) => this.d.repo.companyNameForDomain(ids, domain),
            cachedBand: async (domain) => normalizeBand((await this.d.repo.cachedCompanySize(domain)) ?? "") as Band | null,
            siblingBand: async (domain) => normalizeBand((await this.d.repo.siblingCompanySize(domain)) ?? "") as Band | null,
            applySiblingSizes: (ids) => this.d.repo.applySiblingSizes(ids),
            rememberBand: (domain, band, source) => this.d.repo.rememberCompanySize(domain, band, source),
            applyBand: (ids, domain, band) => this.d.repo.applyCompanySize(ids, domain, band),
            count: (filters) => this.d.getleads!.countRaw(filters),
            ...(paid
              ? { paidLookup: paid.lookup, paidWorstCaseCents: paid.worstCaseCents }
              : {}),
          },
          campaignIds,
        );
        backfilled = progress.leads_updated;
        unknown = progress.unknown;
        paidCents = progress.paid_cents;
      }

      const cells = segmentCount(recipe);
      const groups = campaignGroups(recipe, campaignIds);
      const scope =
        campaignIds.length === allIds.length
          ? `${campaignIds.length} campaign(s)`
          : `${campaignIds.length} of ${allIds.length} campaign(s): ${campaignIds.map((id) => `#${id}`).join(", ")}`;
      const fill =
        backfilled || unknown
          ? ` · backfilled company_size on ${backfilled} lead(s)${unknown ? `, ${unknown} domain(s) still unknown` : ""}${paidCents ? ` · paid $${(paidCents / 100).toFixed(2)} of $5.00` : ""}`
          : "";
      const line = inferred
        ? `Step 1: inferred ICP from the list already in the campaign + receipt tags for ${recipe.client_tag}/${recipe.lane} (\`${recipe.recipe_id}\`) · ${scope} (${icpSummary(groups)})${fill}. Not asking Josh for a handwritten recipe.`
        : `Step 1: using saved campaign ICPs for ${recipe.client_tag}/${recipe.lane} (\`${recipe.recipe_id}\`) · ${cells} cells → ${scope} (${icpSummary(groups)})${fill}. Not asking Josh again.`;
      return finish(
        this.d,
        run,
        "trigger",
        campaignIds.length,
        {
          icp_saved: inferred ? 0 : 1,
          icp_inferred: inferred ? 1 : 0,
          cells,
          campaigns: campaignIds.length,
          recipe_campaigns: allIds.length,
          sizes_backfilled: backfilled,
          sizes_unknown: unknown,
          sizes_paid_cents: paidCents,
          ...targetCountPatch(campaignIds),
        },
        line,
      );
    });
  }

  private async foreignCampaigns(ids: number[], clientId: number): Promise<Array<{ id: number; reason: string }>> {
    if (ids.length === 0) return [];
    const { rows: t } = await this.d.repo.raw().query<{ ok: boolean }>(`select to_regclass('public.campaigns') is not null as ok`);
    if (!t[0]?.ok) return ids.map((id) => ({ id, reason: "public.campaigns is not here" }));
    const { rows } = await this.d.repo.raw().query<{ id: string; client: string | null }>(
      `select smartlead_campaign_id::text as id, smartlead_client_id::text as client from public.campaigns where smartlead_campaign_id = any($1::bigint[])`,
      [ids],
    );
    const out: Array<{ id: number; reason: string }> = [];
    for (const id of ids) {
      const row = rows.find((r) => Number(r.id) === id);
      if (!row) out.push({ id, reason: "not in the mirror" });
      else if (row.client !== null && Number(row.client) !== clientId) out.push({ id, reason: `belongs to client ${row.client}` });
    }
    return out;
  }
}

function paidSizeFromKey(apiKey: string | undefined): {
  lookup: (domain: string, companyName: string | null) => Promise<PaidSizeHit | null>;
  worstCaseCents: number;
} | undefined {
  const key = apiKey?.trim();
  if (!key) return undefined;
  return {
    worstCaseCents: leadmagicBackfillWorstCents(),
    lookup: (domain, companyName) => leadmagicCompanyBand(domain, companyName, { apiKey: key }),
  };
}

function segmentCount(recipe: Recipe): number {
  const dims = Object.values(recipe.segments).filter((v) => v.length > 0);
  if (dims.length === 0) return 0;
  return dims.reduce((n, values) => n * values.length, 1);
}
