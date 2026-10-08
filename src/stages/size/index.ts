import type { Getleads, GetleadsFilters } from "../../clients/getleads.js";
import type { MapsStats } from "../../clients/mapsStats.js";
import type { PermitCounts } from "../../clients/permits.js";
import type { RunRow } from "../../domain/runs.js";
import { campaignSnapshots } from "../../ledger/health.js";
import { Overlap, SIZE_ACROSS_CLIENTS, SIZE_WITHIN_CLIENT } from "../../lib/concurrency.js";
import { logger } from "../../lib/log.js";
import { campaignPerformance } from "../../builds/load.js";
import { RunStepPoolCache } from "../../plan/cache.js";
import { campaignOwners } from "../../plan/facts.js";
import { planSize, type PlannerDeps } from "../../plan/planner.js";
import { VendorCallLog } from "../../plan/vendorLog.js";
import { runTargetCampaignIds } from "../../recipes/campaigns.js";
import { loadGeoFenceCities } from "../../recipes/geoFence.js";
import type { Recipe } from "../../recipes/schema.js";
import type { SpendRails } from "../../spend/rails.js";
import { attempt, finish, park, type StageDeps, type StageOutcome } from "../common.js";
import { campaignSizeRoutes } from "../pull/route.js";
import { formatCampaignReport } from "./campaignReport.js";

export { bandMismatchReason, bandSizeDecision, outsideBandCount, partitionCheck, rowsNeeded, sourcesAgree, type Partition } from "./partition.js";

const log = logger("size");

/**
 * Step 2 — Size it (skill lead-list-build; skill tam-sizing; D29, D33, D46, D48).
 *
 * The stage is a thin wrapper over the size planner. The planner judges every
 * target campaign with the policy layer, counts each distinct query once and
 * concurrently (getleads, AI Ark People Preview when a token is set, Maps and
 * PermitStack for physical lists), reuses counts and pilot scores from the
 * fingerprint cache, subtracts what the client already holds, splits each pool
 * across its campaigns by need, and writes one line per campaign with its gate
 * and reason. A campaign that fails is skipped; the rest continue. The run
 * closes as sized, with the report, when nothing qualifies. This step always
 * recounts a changed recipe and never treats a backfill receipt as TAM (D33).
 */
export interface SizeDeps extends StageDeps {
  getleads: Getleads;
  rails: SpendRails;
  maps: MapsStats | null;
  permits: PermitCounts | null;
  /** Same filters as getleads. Unset means the preview count is not available, and the size stays single_source. */
  aiArk?: { count(filters: GetleadsFilters): Promise<{ total_matching: number }> } | null;
  fetchText?: (url: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class SizeStage {
  /** Lists of one client overlap. Lists of other clients overlap those. */
  private readonly overlap = new Overlap(SIZE_WITHIN_CLIENT, SIZE_ACROSS_CLIENTS);

  constructor(private readonly d: SizeDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "size", "sizing", async (attempts) => {
      const campaignIds = await runTargetCampaignIds(this.d.repo, run, recipe);
      if (campaignIds.length === 0) {
        const reason = "no target campaigns to size";
        await this.d.repo.failStep(run.run_id, "size", reason, true);
        return park(this.d, run, "size", reason, attempts);
      }
      const db = this.d.repo.raw();
      const vendorLog = new VendorCallLog(this.d.now);
      const deps: PlannerDeps = {
        db,
        getleads: this.d.getleads,
        aiArk: this.d.aiArk ?? null,
        maps: this.d.maps,
        permits: this.d.permits,
        rails: this.d.rails,
        loadGeo: (ref) => loadGeoFenceCities(db, ref),
        log: vendorLog,
        overlap: this.overlap,
        fetchText: this.d.fetchText ?? defaultFetchText,
        sleep: this.d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        now: this.d.now ?? (() => Date.now()),
        cache: new RunStepPoolCache(db, this.d.now),
        campaignBuilds: (tag, ids) => this.d.repo.campaignBuilds(tag, ids),
        workingOverrides: (ids) => this.d.repo.workingOverrides(ids),
        clientIcpKind: (tag) => this.d.repo.clientIcpKind(tag),
        snapshots: (ids) => campaignSnapshots(db, ids),
        performance: (ids) => campaignPerformance(db, ids),
        owners: (ids) => campaignOwners(db, ids),
        loadsPaused: () => this.d.repo.loadsPaused(),
      };
      const plan = await planSize(deps, run, recipe, campaignIds, { pilotOnly: run.counts_by_status?.stop_after_pilot === 1 });
      await this.d.repo.mergeStepExtra(run.run_id, "size", plan.extra);
      if (!plan.pilotOnly && plan.qualifying.length === 0) {
        await this.d.repo.mergeRunCounts(run.run_id, { nothing_to_pull: 1 });
        log.info("nothing qualifies; the run closes as sized", { run_id: run.run_id, campaigns: campaignIds.length });
      }
      const useful = plan.pilotOnly ? plan.pools.filter((p) => p.pilot).length : plan.counts.plan_rows ?? 0;
      return finish(this.d, run, "size", useful, plan.counts, plan.lines.join("\n"), plan.report);
    });
  }
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`export could not be read: HTTP ${res.status}`);
  return res.text();
}

/** A campaign whose route parks is skipped. The others still size. Kept for the pull stage's planning. */
export function skippedSizeRoutes(recipe: Recipe, campaignIds: readonly number[]): { run: number[]; skipped: string[] } {
  const run: number[] = [];
  const skipped: string[] = [];
  for (const id of campaignIds) {
    const route = campaignSizeRoutes(recipe, [id])[0]?.route;
    if (!route || route.kind === "park") {
      skipped.push(`#${id}: ${route && route.kind === "park" ? route.reason : "no size route"}`);
      continue;
    }
    run.push(id);
  }
  return { run, skipped };
}

export { formatCampaignReport };
