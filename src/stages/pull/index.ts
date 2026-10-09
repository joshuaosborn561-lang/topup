import type { MapsQuote } from "../../clients/mapsStats.js";
import type { PermitCounts } from "../../clients/permits.js";
import type { RunRow } from "../../domain/runs.js";
import { runTargetCampaignIds, withoutSkipped } from "../../recipes/campaigns.js";
import { recipeAuthorises, type Recipe } from "../../recipes/schema.js";
import { usd, worstCaseCents } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import { spendApprovalCard } from "../../console/cards.js";
import { gateUnmet } from "../../spine/gate.js";
import { campaignReportFromCounts, formatCampaignReport } from "../report.js";
import { attempt, finish, park, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";
import type { PullAdapter, PullResult } from "./adapter.js";
import type { PullJob } from "./route.js";
import { pullPlans } from "./route.js";

/**
 * Step 3 — Pull. One job per campaign segment, so a lane with several
 * campaigns and a recipe with several segments does not pick one stack.
 * Maps and PermitStack spend stops on a card: under $5 the operator,
 * $5 or more Josh. A missing adapter URL parks with the credential name.
 */
export interface PullDeps extends StageDeps {
  rails: SpendRails;
  adapters: PullAdapter[];
  maps?: MapsQuote | null;
  permits?: PermitCounts | null;
  cfg: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export interface PullFile {
  campaignId: number;
  segment: string;
  source: PullJob["source"];
  export_url: string;
  rows_exported: number;
  cap_reason: string | null;
  cap_message: string | null;
  count_only: boolean;
  already_held?: number;
}

export interface ResolvedPull extends PullResult {
  files: PullFile[];
}

interface StoredJob {
  campaignId: number;
  segment: string;
  source: PullJob["source"];
  handle: string;
}

export class PullStage {
  private readonly clock: Clock;

  constructor(private readonly d: PullDeps) {
    this.clock = d.clock ?? realClock;
  }

  adapterFor(kind: string): PullAdapter {
    const adapter = this.d.adapters.find((item) => item.kind === kind);
    if (!adapter) throw new Error(`no step 3 adapter for a ${kind} source in this build`);
    return adapter;
  }

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "pull", "pulling", async (attempts) => {
      const sizeStep = await this.d.repo.getStep(run.run_id, "size");
      const campaignIds = withoutSkipped(await runTargetCampaignIds(this.d.repo, run, recipe), sizeStep?.counts);
      const routed = pullPlans(recipe, campaignIds);
      if (routed.kind === "park") {
        await this.d.repo.failStep(run.run_id, "pull", routed.reason, true);
        return park(this.d, run, "pull", routed.reason, attempts);
      }
      const declined = await this.declined(run.run_id);
      if (declined) {
        await this.d.repo.setRunStatus(run.run_id, "declined", "pull", "spend declined");
        return { kind: "declined" };
      }

      const own = await this.d.repo.getStep(run.run_id, "pull");
      const jobs = parseJobBook(own?.vendor_job_id ?? null, routed.plans);
      const missing = credentialGap(routed.plans, this.d.maps ?? null, this.d.permits ?? null);
      if (missing) {
        await this.d.repo.failStep(run.run_id, "pull", missing, true);
        return park(this.d, run, "pull", missing, attempts);
      }

      const shares = shareRows(routed.plans, sizeStep?.counts ?? {}, recipe.runway.max_per_run);
      const priced = pricePlans(routed.plans, shares);
      for (const plan of routed.plans) {
        if (!recipeAuthorises(recipe, "pull", vendorFor(plan))) {
          throw new Error(`pull blocked: step pull on ${vendorFor(plan)} is not in the lane recipe`);
        }
      }
      const spentToday = await this.d.repo.spentTodayCents();
      const approved = own?.approved_cents ?? 0;
      const decision = this.d.rails.decide(
        {
          runId: run.run_id,
          clientTag: run.client_tag,
          step: "pull",
          vendor: priced.vendor,
          action: priced.action,
          rows: priced.rows,
          recipeAuthorised: true,
          approvedCents: approved,
          worstCaseCents: priced.worst,
        },
        spentToday,
      );
      if (decision.kind === "blocked") throw new Error(`pull blocked: ${decision.reason}`);
      // D51: anything that costs money waits for a named approval; the auto cap is $0.
      const ask: "proceed" | "owner" = priced.worst <= 0 ? "proceed" : "owner";
      if (ask !== "proceed" && approved < priced.worst) {
        const open = await this.d.repo.openCardsForRun(run.run_id);
        if (!open.some((card) => card.kind === "spend_approval")) {
          await this.d.console.ask({
            run,
            kind: "spend_approval",
            audience: "owner",
            payload: {
              step: "pull",
              vendor: priced.vendor,
              action: priced.action,
              rows: priced.rows,
              worst_case_cents: priced.worst,
              campaign_report: campaignReportFromCounts(sizeStep?.counts as unknown as Record<string, unknown>),
            },
            text: `Pull spend ${usd(priced.worst)} on ${priced.vendor} needs a tap before any rows move.`,
            blocks: (cardId) =>
              spendApprovalCard({
                cardId,
                runId: run.run_id,
                clientTag: run.client_tag,
                step: "pull",
                vendor: priced.vendor,
                action: priced.action,
                rows: priced.rows,
                worstCaseCents: priced.worst,
                projectedUseful: null,
                spentTodayCents: spentToday,
                dailyCapCents: this.d.rails.cfg.dailyCapCents,
                report: formatCampaignReport(campaignReportFromCounts(sizeStep?.counts as unknown as Record<string, unknown>)) || undefined,
              }),
          });
        }
        return {
          kind: "waiting",
          on: ask === "owner" ? "owner" : "operator",
          why: `pull on ${priced.vendor} would cost ${usd(priced.worst)}; waiting on ${ask === "owner" ? "Josh" : "the operator"}`,
          worstCaseCents: priced.worst,
        };
      }

      if (priced.worst > 0 && this.d.maps) {
        const quoted = Number(own?.counts.maps_quoted ?? 0) === 1;
        if (!quoted) {
          const mapsPlans = routed.plans.filter((plan) => plan.source === "maps");
          for (const plan of mapsPlans) {
            if (plan.filters.kind !== "maps") continue;
            await this.d.maps.estimateCost({
              categories: plan.filters.params.categories,
              states: plan.filters.params.states ?? [],
              clientTag: run.client_tag,
            });
          }
          await this.d.repo.mergeStepCounts(run.run_id, "pull", { maps_quoted: 1 });
        }
      }

      for (const plan of routed.plans) {
        const key = jobKey(plan);
        if (jobs.some((job) => jobKey(job) === key)) continue;
        const adapter = this.adapterFor(plan.source);
        const started = await adapter.start(run, recipe, shares.get(key) ?? recipe.runway.max_per_run, plan.filters);
        jobs.push({ campaignId: plan.campaignId, segment: plan.segment, source: plan.source, handle: started.handle });
        await this.d.repo.setStepVendorJob(run.run_id, "pull", JSON.stringify({ v: 1, jobs }));
      }

      const files: PullFile[] = [];
      for (const job of jobs) {
        const adapter = this.adapterFor(job.source);
        const result = await poll<PullResult>(() => adapter.check(job.handle), {
          pollMs: this.d.cfg.pollMs,
          deadMs: this.d.cfg.deadMs,
          clock: this.clock,
          what: `${adapter.vendor} ${job.handle} for #${job.campaignId}`,
        });
        await this.d.rails.record({
          runId: run.run_id,
          clientTag: run.client_tag,
          step: "pull",
          vendor: adapter.vendor,
          action: job.source === "maps" ? "pool" : job.source === "permits" ? "metrics_monthly" : "export",
          rows: result.rows_exported,
          credits: 0,
          worstCaseCents: 0,
          balanceBefore: null,
          balanceAfter: null,
          vendorJobId: job.handle,
          approvedBy: null,
        });
        files.push({
          campaignId: job.campaignId,
          segment: job.segment,
          source: job.source,
          export_url: result.export_url,
          rows_exported: result.rows_exported,
          cap_reason: result.cap_reason,
          cap_message: result.cap_message,
          count_only: result.export_url.length === 0,
          already_held: result.already_held ?? 0,
        });
      }

      const rowsExported = files.reduce((sum, file) => sum + file.rows_exported, 0);
      const alreadyHeld = files.reduce((sum, file) => sum + (file.already_held ?? 0), 0);
      const counts: Record<string, number> = {
        plan_rows: priced.rows,
        rows_exported: rowsExported,
        already_held: alreadyHeld,
        campaigns: new Set(files.map((file) => file.campaignId)).size,
      };
      for (const file of files) {
        counts[`rows_${file.campaignId}`] = (counts[`rows_${file.campaignId}`] ?? 0) + file.rows_exported;
      }
      const csvRows = files.filter((file) => !file.count_only).reduce((sum, file) => sum + file.rows_exported, 0);
      if (files.some((file) => !file.count_only) && csvRows <= 0) {
        await this.d.repo.finishStep(run.run_id, "pull", { useful_output: 0, counts, vendor_job_id: JSON.stringify({ v: 1, jobs }) });
        return gateUnmet("pull", `export delivered 0 rows across ${files.length} segment(s). No useful output to count.`, counts);
      }
      const line = files
        .map((file) => `#${file.campaignId} ${file.segment}: ${file.rows_exported} via ${file.source}${file.count_only ? " (count)" : ""}`)
        .join("\n");
      const prior = campaignReportFromCounts(sizeStep?.counts as unknown as Record<string, unknown>);
      const report = prior.map((entry) => ({
        ...entry,
        found: counts[`rows_${entry.campaign_id}`] ?? entry.found,
      }));
      return finish(this.d, run, "pull", rowsExported, counts, `Pull done (${files.length} segment(s)):\n${line}`, report);
    });
  }

  /** Step 4 asks for the files again rather than the service remembering a URL across a restart. */
  async resolve(run: RunRow, recipe: Recipe): Promise<ResolvedPull> {
    const own = await this.d.repo.getStep(run.run_id, "pull");
    if (!own?.vendor_job_id) throw new Error("pull has no vendor job id; nothing to ingest");
    const sizeStep = await this.d.repo.getStep(run.run_id, "size");
    const campaignIds = withoutSkipped(await runTargetCampaignIds(this.d.repo, run, recipe), sizeStep?.counts);
    const routed = pullPlans(recipe, campaignIds);
    if (routed.kind !== "run") throw new Error(`pull cannot resolve: ${routed.reason}`);
    const jobs = parseJobBook(own.vendor_job_id, routed.plans);
    if (jobs.length === 0) throw new Error("pull has no vendor job id; nothing to ingest");
    const files: PullFile[] = [];
    for (const job of jobs) {
      const verdict = await this.adapterFor(job.source).check(job.handle);
      if (verdict.state !== "done") {
        throw new Error(`pull job ${job.handle} is ${verdict.state}${verdict.state === "failed" ? `: ${verdict.error}` : ""}; cannot ingest`);
      }
      files.push({
        campaignId: job.campaignId,
        segment: job.segment,
        source: job.source,
        export_url: verdict.value.export_url,
        rows_exported: verdict.value.rows_exported,
        cap_reason: verdict.value.cap_reason,
        cap_message: verdict.value.cap_message,
        count_only: verdict.value.export_url.length === 0,
        already_held: verdict.value.already_held ?? 0,
      });
    }
    const first = files[0]!;
    return {
      export_url: first.export_url,
      rows_exported: files.reduce((sum, file) => sum + file.rows_exported, 0),
      cap_reason: first.cap_reason,
      cap_message: first.cap_message,
      files,
    };
  }

  private async declined(runId: string): Promise<boolean> {
    const { rows } = await this.d.repo.raw().query(
      `select 1 from topup.cards where run_id = $1 and kind = 'spend_approval' and status = 'resolved' and resolution = 'decline_spend' limit 1`,
      [runId],
    );
    return rows.length > 0;
  }
}

export function jobKey(job: { campaignId: number; segment: string; source: string }): string {
  return `${job.campaignId}:${job.source}:${job.segment}`;
}

export function shareRows(plans: readonly PullJob[], counts: Record<string, number>, maxPerRun: number): Map<string, number> {
  const byCampaign = new Map<number, PullJob[]>();
  for (const plan of plans) {
    const list = byCampaign.get(plan.campaignId) ?? [];
    list.push(plan);
    byCampaign.set(plan.campaignId, list);
  }
  const out = new Map<string, number>();
  for (const [campaignId, list] of byCampaign) {
    const planned = Number(counts[`plan_rows_${campaignId}`] ?? 0);
    const total = Math.max(1, Math.min(maxPerRun, planned > 0 ? planned : maxPerRun));
    const each = Math.max(1, Math.ceil(total / list.length));
    for (const plan of list) out.set(jobKey(plan), Math.min(maxPerRun, each));
  }
  return out;
}

export function pricePlans(plans: readonly PullJob[], shares: Map<string, number>): { vendor: string; action: string; rows: number; worst: number } {
  let worst = 0;
  let rows = 0;
  let vendor = "getleads";
  let action = "export";
  for (const plan of plans) {
    const n = shares.get(jobKey(plan)) ?? 1;
    rows += n;
    const planVendor = vendorFor(plan);
    const planAction = plan.source === "maps" ? "pool" : plan.source === "permits" ? "metrics_monthly" : "export";
    const cents = worstCaseCents(planVendor, planAction, n);
    if (cents > 0) {
      vendor = planVendor;
      action = planAction;
    }
    worst += cents;
  }
  return { vendor, action, rows, worst };
}

function vendorFor(plan: PullJob): string {
  if (plan.source === "permits") return "permitstack";
  return plan.source;
}

export function credentialGap(plans: readonly PullJob[], _maps: MapsQuote | null, permits: PermitCounts | null): string | null {
  if (plans.some((plan) => plan.source === "permits") && !permits) return "missing credentials for permitstack";
  return null;
}

export function parseJobBook(raw: string | null, plans: readonly PullJob[]): StoredJob[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { v?: number; jobs?: StoredJob[] };
    if (parsed && Array.isArray(parsed.jobs)) return parsed.jobs;
  } catch {
    /* a single getleads export id from an older run */
  }
  const first = plans.find((plan) => plan.source === "getleads") ?? plans[0];
  if (!first) return [];
  return [{ campaignId: first.campaignId, segment: first.segment, source: first.source, handle: raw }];
}
