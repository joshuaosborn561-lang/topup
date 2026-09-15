import { JOB_DONE, JOB_FAILED, type JobStatus, type LeadPipe } from "../../clients/leadpipe.js";
import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { jobTitlesFor, runTargetCampaignIds } from "../../recipes/campaigns.js";
import type { Recipe } from "../../recipes/schema.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, columnsOf, finish, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";
import type { PullStage } from "../pull/index.js";

/**
 * Step 4 — Ingest (skill lead-list-build): LeadPipe `lp_run ingest_csv` from
 * the pull's URL into lp.<tag>_ingested_leads with a `source_label` naming
 * the lane and run; confirm `city, state, industry, employee_range` landed
 * (the parlay skill's known failure: the importer drops three of them).
 * Gate: row count equals the export count.
 *
 * Also here, because the rows only exist now: step 3's "titles audited" —
 * a row whose title matches none of the recipe's titles is flagged
 * `qa_flags.off_title` and counted; step 8 decides what happens to it.
 *
 * The rows LeadPipe inserts are claimed for this run in one UPDATE (the
 * write lock needs app.run_id, which withRun sets). `company_size` and
 * `vertical` are filled from LeadPipe's `employee_range` and `industry`
 * where those columns exist, so the copy's merge fields have a source.
 */
export interface IngestDeps extends StageDeps {
  leadpipe: LeadPipe;
  pull: PullStage;
  rails: SpendRails;
  cfg: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export function sourceLabel(run: RunRow): string {
  return `topup_${run.client_tag}_${run.lane}_${run.run_id.slice(0, 8)}`;
}

/** Case-insensitive regex that matches a title containing any of the recipe's titles as a phrase. */
export function titlePattern(titles: readonly string[]): string {
  const esc = titles.map((t) => t.trim()).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  return esc.length ? `(^|[^a-z])(${esc.join("|")})([^a-z]|$)` : ".*";
}

export class IngestStage {
  private readonly clock: Clock;

  constructor(private readonly d: IngestDeps) {
    this.clock = d.clock ?? realClock;
  }

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "ingest", "ingesting", async () => {
      const table = ingestedTable(run.client_tag);
      const label = sourceLabel(run);
      const pulled = await this.d.pull.resolve(run, recipe);

      const own = await this.d.repo.getStep(run.run_id, "ingest");
      let jobId = own?.vendor_job_id ?? null;
      if (!jobId) {
        const started = await this.d.leadpipe.ingestCsv(run.client_tag, { urls: [pulled.export_url], source_label: label, dedupe_key: "email" });
        jobId = started.job_id;
        await this.d.repo.setStepVendorJob(run.run_id, "ingest", jobId);
        await this.d.console.postInThread(run, `Ingest: LeadPipe ingest_csv started (job \`${jobId}\`, source_label \`${label}\`) for ${pulled.rows_exported} exported rows.`);
      }
      const status = await poll<JobStatus>(
        async () => {
          const s = await this.d.leadpipe.jobStatus(jobId!);
          if (JOB_FAILED.includes(s.status)) return { state: "failed", error: s.error ?? s.status };
          if (JOB_DONE.includes(s.status)) return { state: "done", value: s };
          return { state: "running" };
        },
        { pollMs: this.d.cfg.pollMs, deadMs: this.d.cfg.deadMs, clock: this.clock, what: `LeadPipe ingest ${jobId}` },
      );
      // LeadPipe spends nothing (docs/servers.md §1); the ledger row is the record that the job ran.
      await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "ingest", vendor: "leadpipe", action: "ingest_csv", rows: status.rows_read ?? 0, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: jobId, approvedBy: null });

      const cols = await columnsOf(this.d.repo, table);
      if (!cols.has("source_label")) throw new Error(`${table} has no source_label column; cannot claim the ingested rows for this run`);
      const fills: string[] = [];
      if (cols.has("employee_range")) fills.push("company_size = coalesce(company_size, employee_range)");
      if (cols.has("industry")) fills.push("vertical = coalesce(vertical, industry)");
      const claimed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const { rowCount } = await tx.query(
          `update ${table} set run_id = $1, lead_status = 'ingested', status_changed_at = now()${fills.length ? ", " + fills.join(", ") : ""}
           where source_label = $2 and run_id is null`,
          [run.run_id, label],
        );
        return rowCount ?? 0;
      });
      const landed = await this.landedCounts(table, run.run_id, cols);
      const titles = jobTitlesFor(recipe, await runTargetCampaignIds(this.d.repo, run, recipe));
      const offTitle = titles.length ? await this.auditTitles(table, run, titles, cols) : 0;

      const rowsRead = status.rows_read;
      const counts: Record<string, number> = {
        rows_exported: pulled.rows_exported,
        rows_read: rowsRead ?? -1,
        rows_claimed: claimed,
        dedupe_dropped: rowsRead === null ? -1 : Math.max(0, rowsRead - claimed),
        ...landed,
        off_title: offTitle,
      };
      if (rowsRead !== null && rowsRead !== pulled.rows_exported) {
        await this.d.repo.finishStep(run.run_id, "ingest", { useful_output: claimed, counts });
        return gateUnmet("ingest", `LeadPipe read ${rowsRead} rows but the export had ${pulled.rows_exported}. ${claimed} rows landed for this run.`, counts);
      }
      if (rowsRead === null && claimed < pulled.rows_exported) {
        await this.d.repo.finishStep(run.run_id, "ingest", { useful_output: claimed, counts });
        return gateUnmet("ingest", `LeadPipe reported no read count (lp_status keys: ${status.raw_keys.join(", ") || "none"}) and ${claimed} of ${pulled.rows_exported} exported rows landed; the rest are dedupe drops or missing and the service cannot tell which.`, counts);
      }
      const nulls = Object.entries(landed).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace("null_", "")} ${n}`);
      const line =
        `Ingest done: ${pulled.rows_exported} exported, ${rowsRead === null ? "read count not reported (all landed)" : `${rowsRead} read`}, ${claimed} claimed for this run` +
        (rowsRead !== null && rowsRead > claimed ? ` (${rowsRead - claimed} dropped as already in the table)` : "") +
        (nulls.length ? ` · empty after ingest: ${nulls.join(", ")} (LeadPipe column drop; see the parlay skill)` : " · city, state, industry, employee_range all landed") +
        ` · titles audited: ${offTitle} off-title flagged for step 8.`;
      return finish(this.d, run, "ingest", claimed, counts, line);
    });
  }

  private async landedCounts(table: string, runId: string, cols: Set<string>): Promise<Record<string, number>> {
    const want = ["city", "state", "industry", "employee_range"].filter((c) => cols.has(c));
    if (want.length === 0) return {};
    const sel = want.map((c) => `count(*) filter (where coalesce(${c}::text, '') = '')::text as "${c}"`).join(", ");
    const { rows } = await this.d.repo.raw().query<Record<string, string>>(`select ${sel} from ${table} where run_id = $1`, [runId]);
    return Object.fromEntries(want.map((c) => [`null_${c}`, Number(rows[0]?.[c] ?? 0)]));
  }

  /** Step 3 gate, "titles audited": flag rows whose title matches none of the recipe's titles. Counts only. */
  private async auditTitles(table: string, run: RunRow, titles: readonly string[], cols: Set<string>): Promise<number> {
    const col = cols.has("title") ? "title" : cols.has("job_title") ? "job_title" : null;
    if (!col) return 0;
    return this.d.repo.withRun(run.run_id, async (tx) => {
      const { rowCount } = await tx.query(
        `update ${table} set qa_flags = coalesce(qa_flags, '{}'::jsonb) || '{"off_title": true}'::jsonb
         where run_id = $1 and lead_status = 'ingested' and coalesce(${col}, '') !~* $2`,
        [run.run_id, titlePattern(titles)],
      );
      return rowCount ?? 0;
    });
  }
}
