import { IMPORT_DONE, IMPORT_FAILED, type ImportStatus, type Smartlead } from "../../clients/smartlead.js";
import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { campaignSnapshots, WINDOW_DAYS } from "../../ledger/health.js";
import type { Recipe } from "../../recipes/schema.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { STAGING_TABLE } from "../stage/index.js";
import { attempt, finish, poll, realClock, type Clock, type PollVerdict, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 11 — Import (skill lead-list-build). Smartlead `start_lead_import`
 * from staging, one campaign at a time, polled with `get_lead_import_status`.
 * "The only success test is upload_count equals submitted. A mismatch stops
 * that campaign's import and is reported." Gate: counts match on every
 * campaign.
 *
 * The import job reads public.leads_staging where imported=false for the
 * campaign and marks rows imported (docs/servers.md §10); this service never
 * posts a lead row itself. Each campaign's job id is kept on the step so a
 * restart polls instead of starting twice. Runway before the import is
 * recorded from the mirror for the receipt.
 */
export interface ImportDeps extends StageDeps {
  smartlead: Smartlead;
  rails: SpendRails;
  cfg: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export interface CampaignImport {
  campaign_id: number;
  submitted: number;
  imported: number | null;
  duplicates: number | null;
  invalid: number | null;
  status: string;
  matched: boolean;
  runway_before: number | null;
  per_day: number | null;
}

/** The skill's success test: imported equals submitted. Duplicates Smartlead already had are not imported. */
export function importMatched(submitted: number, s: ImportStatus): boolean {
  return s.imported_count !== null && s.imported_count === submitted;
}

export class ImportStage {
  private readonly clock: Clock;

  constructor(private readonly d: ImportDeps) {
    this.clock = d.clock ?? realClock;
  }

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "import", "importing", async () => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const { rows: staged } = await db.query<{ campaign: string; n: string }>(`select campaign_id::text as campaign, count(*)::text as n from ${STAGING_TABLE} where run_id = $1 and imported = false group by 1 order by 1`, [run.run_id]);
      const { rows: already } = await db.query<{ campaign: string; n: string }>(`select campaign_id::text as campaign, count(*)::text as n from ${STAGING_TABLE} where run_id = $1 and imported = true group by 1 order by 1`, [run.run_id]);
      if (staged.length === 0 && already.length === 0) return { kind: "nothing" };

      const own = await this.d.repo.getStep(run.run_id, "import");
      const jobs = parseJobs(own?.vendor_job_id ?? null);
      const campaignIds = [...new Set([...staged, ...already].map((r) => Number(r.campaign)))].sort((a, b) => a - b);
      const before = await campaignSnapshots(db, campaignIds).catch(() => []);
      const results: CampaignImport[] = [];
      const stagingMarked: Record<number, number> = {};
      let stoppedAt: string | null = null;

      for (const campaign of campaignIds) {
        const submitted = Number(staged.find((r) => Number(r.campaign) === campaign)?.n ?? 0) + Number(already.find((r) => Number(r.campaign) === campaign)?.n ?? 0);
        const snap = before.find((s) => s.smartlead_campaign_id === campaign);
        const perDay = snap && snap.sends_window > 0 ? snap.sends_window / WINDOW_DAYS : null;
        const runwayBefore = snap && perDay ? Math.round((snap.untouched / perDay) * 10) / 10 : null;

        let jobId = jobs[campaign] ?? null;
        if (!jobId) {
          const decision = await this.d.rails.gate({ runId: run.run_id, clientTag: run.client_tag, step: "import", vendor: "smartlead", action: "start_lead_import", rows: submitted, recipeAuthorised: true });
          if (decision.kind === "blocked") throw new Error(`import blocked: ${decision.reason}`);
          if (decision.kind === "ask") throw new Error(`Smartlead import priced above the auto cap; the price table says included. Check src/spend/prices.ts.`);
          const started = await this.d.smartlead.startImport(campaign);
          jobId = started.run_id;
          jobs[campaign] = jobId;
          await this.d.repo.setStepVendorJob(run.run_id, "import", JSON.stringify(jobs));
        }
        const status = await poll<ImportStatus>(async () => this.check(jobId!), { pollMs: this.d.cfg.pollMs, deadMs: this.d.cfg.deadMs, clock: this.clock, what: `Smartlead import ${jobId} for #${campaign}` });
        await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "import", vendor: "smartlead", action: "start_lead_import", rows: submitted, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: jobId, approvedBy: null });
        const matched = importMatched(submitted, status);
        results.push({ campaign_id: campaign, submitted, imported: status.imported_count, duplicates: status.duplicate_count, invalid: status.invalid_count, status: status.status, matched, runway_before: runwayBefore, per_day: perDay });

        // The skill's only success test is the count. The staging mark (imported=true, set by the import job) is reported, not judged.
        const marked = await db.query<{ n: string }>(`select count(*)::text as n from ${STAGING_TABLE} where run_id = $1 and campaign_id = $2 and imported = true`, [run.run_id, campaign]);
        stagingMarked[campaign] = Number(marked.rows[0]?.n ?? 0);
        await this.d.repo.withRun(run.run_id, (tx) =>
          tx.query(`update ${table} set lead_status = $3, status_changed_at = now() where run_id = $1 and lead_status = 'staged' and routed_campaign_id = $2`, [run.run_id, campaign, matched ? "imported" : "import_mismatch"]),
        );
        if (!matched) {
          stoppedAt = `#${campaign}: submitted ${submitted}, imported ${status.imported_count ?? "?"}, duplicates ${status.duplicate_count ?? "?"}, invalid ${status.invalid_count ?? "?"} (${status.status})`;
          break;
        }
      }

      const counts: Record<string, number> = {
        imported: results.reduce((a, r) => a + (r.matched ? (r.imported ?? 0) : 0), 0),
        import_mismatch: results.filter((r) => !r.matched).reduce((a, r) => a + r.submitted, 0),
        campaigns_imported: results.filter((r) => r.matched).length,
      };
      for (const r of results) {
        counts[`imported_${r.campaign_id}`] = r.matched ? (r.imported ?? 0) : 0;
        if (r.runway_before !== null) counts[`runway_before_${r.campaign_id}_x10`] = Math.round(r.runway_before * 10);
        if (r.per_day !== null) counts[`per_day_${r.campaign_id}_x10`] = Math.round(r.per_day * 10);
        if (r.duplicates) counts[`duplicates_${r.campaign_id}`] = r.duplicates;
        if (r.invalid) counts[`invalid_${r.campaign_id}`] = r.invalid;
        counts[`staging_marked_${r.campaign_id}`] = stagingMarked[r.campaign_id] ?? 0;
      }
      const unmarked = results.filter((r) => r.matched && (stagingMarked[r.campaign_id] ?? 0) < r.submitted);
      await this.d.repo.mergeStepCounts(run.run_id, "import", counts);
      if (stoppedAt) {
        const notStarted = campaignIds.filter((c) => !results.some((r) => r.campaign_id === c));
        return gateUnmet("import", `${stoppedAt}. Import stopped there${notStarted.length ? `; ${notStarted.map((c) => `#${c}`).join(", ")} not started` : ""}.`, counts);
      }
      const line =
        `Import done: ${counts.imported} imported across ${counts.campaigns_imported} campaign(s)` +
        results.map((r) => ` · #${r.campaign_id} ${r.imported}/${r.submitted}${r.duplicates ? ` (${r.duplicates} dup)` : ""}`).join("") +
        (unmarked.length ? ` · staging rows not yet marked imported by the import job: ${unmarked.map((r) => `#${r.campaign_id} ${stagingMarked[r.campaign_id] ?? 0}/${r.submitted}`).join(", ")}` : "") +
        ".";
      return finish(this.d, run, "import", counts.imported, counts, line);
    });
  }

  private async check(jobId: string): Promise<PollVerdict<ImportStatus>> {
    const s = await this.d.smartlead.importStatus(jobId);
    const st = (s.status ?? "").toLowerCase();
    if (IMPORT_DONE.includes(st)) return { state: "done", value: s };
    if (IMPORT_FAILED.includes(st)) return { state: "failed", error: s.error_message ?? st };
    return { state: "running" };
  }
}

/** Campaign → Smartlead import run id, kept as JSON on run_steps.vendor_job_id. */
export function parseJobs(raw: string | null): Record<number, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([, id]) => typeof id === "string").map(([c, id]) => [Number(c), id as string]));
  } catch {
    return {};
  }
}
