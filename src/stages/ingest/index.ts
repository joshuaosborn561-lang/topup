import { JOB_DONE, JOB_FAILED, type JobStatus, type LeadPipe } from "../../clients/leadpipe.js";
import { dedupeMatchSql, shouldReuseIngest } from "./dedupe.js";
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

export function sourceLabel(run: RunRow, campaignId?: number): string {
  const base = `topup_${run.client_tag}_${run.lane}_${run.run_id.slice(0, 8)}`;
  return campaignId ? `${base}_c${campaignId}` : base;
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
      const pulled = await this.d.pull.resolve(run, recipe);
      const files = pulled.files.length > 0 ? pulled.files : [];
      const csvs = files.filter((file) => file.export_url);
      if (csvs.length === 0) {
        const counts: Record<string, number> = { rows_exported: pulled.rows_exported, rows_claimed: 0, count_only: 1 };
        for (const file of files) counts[`rows_${file.campaignId}`] = (counts[`rows_${file.campaignId}`] ?? 0) + file.rows_exported;
        return finish(
          this.d,
          run,
          "ingest",
          0,
          counts,
          `Ingest: ${files.length} segment(s) are counts, not a lead file. Nothing was loaded into ${table}.`,
        );
      }

      const own = await this.d.repo.getStep(run.run_id, "ingest");
      const jobs = parseIngestJobs(own?.vendor_job_id ?? null);
      const labels = csvs.map((file) => sourceLabel(run, file.campaignId));
      let readTotal = 0;
      let readKnown = true;
      let reusedExisting = false;
      for (const file of csvs) {
        const label = sourceLabel(run, file.campaignId);
        let jobId = jobs[label] ?? null;
        const already = jobId ? 0 : await this.rowsForLabel(table, label);
        if (shouldReuseIngest(jobId, already) && !jobId) {
          reusedExisting = true;
          continue;
        }
        if (!jobId) {
          // D56: the lane table keeps phones; tell LeadPipe which vendor headers carry one.
          const laneCols = await columnsOf(this.d.repo, table);
          const started = await this.d.leadpipe.ingestCsv(run.client_tag, {
            urls: file.export_url.split("\n").map((url) => url.trim()).filter(Boolean),
            source_label: label,
            dedupe_key: "email",
            ...(laneCols.has("phone") ? { column_map: PHONE_HEADER_MAP } : {}),
          });
          jobId = started.job_id;
          jobs[label] = jobId;
          await this.d.repo.setStepVendorJob(run.run_id, "ingest", JSON.stringify(jobs));
          await this.d.console.postInThread(run, `Ingest: LeadPipe ingest_csv started (job \`${jobId}\`, source_label \`${label}\`) for ${file.rows_exported} exported rows on #${file.campaignId}.`);
        }
        const status = await poll<JobStatus>(
          async () => {
            const s = await this.d.leadpipe.jobStatus(jobId!);
            if (JOB_FAILED.includes(s.status)) return { state: "failed", error: s.error ?? s.status };
            if (JOB_DONE.includes(s.status)) return { state: "done", value: s };
            return { state: "running" };
          },
          {
            pollMs: this.d.cfg.pollMs,
            deadMs: this.d.cfg.deadMs,
            clock: this.clock,
            what: `LeadPipe ingest ${jobId}`,
            stop: async () => (await this.d.repo.getRun(run.run_id))?.status === "aborted",
          },
        );
        await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "ingest", vendor: "leadpipe", action: "ingest_csv", rows: status.rows_read ?? 0, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: jobId, approvedBy: null });
        if (status.rows_read === null) readKnown = false;
        else readTotal += status.rows_read;
      }
      const csvExported = csvs.reduce((sum, file) => sum + file.rows_exported, 0);

      const cols = await columnsOf(this.d.repo, table);
      const deduped = cols.has("source_label") ? await this.dedupeLanded(table, run.run_id, labels, cols) : 0;
      if (!cols.has("source_label")) throw new Error(`${table} has no source_label column; cannot claim the ingested rows for this run`);
      const fills: string[] = [];
      if (cols.has("employee_range")) fills.push("company_size = coalesce(company_size, employee_range)");
      if (cols.has("industry")) fills.push("vertical = coalesce(vertical, industry)");
      const claimed = await this.d.repo.withRun(run.run_id, async (tx) => {
        await tx.query(
          `update ${table} set run_id = $1, lead_status = 'ingested', status_changed_at = now()${fills.length ? ", " + fills.join(", ") : ""}
           where source_label = any($2::text[]) and run_id is null`,
          [run.run_id, labels],
        );
        const { rows } = await tx.query<{ n: string }>(
          `select count(*)::text as n from ${table} where run_id = $1 and source_label = any($2::text[])`,
          [run.run_id, labels],
        );
        return Number(rows[0]?.n ?? 0);
      });
      const landed = await this.landedCounts(table, run.run_id, cols);
      const titles = jobTitlesFor(recipe, await runTargetCampaignIds(this.d.repo, run, recipe));
      const offTitle = titles.length ? await this.auditTitles(table, run, titles, cols) : 0;

      if (reusedExisting && readTotal === 0) readKnown = false;
      const rowsRead = readKnown ? readTotal : null;
      const counts: Record<string, number> = {
        rows_exported: csvExported,
        rows_read: rowsRead ?? -1,
        rows_claimed: claimed,
        dedupe_dropped: deduped,
        ...landed,
        off_title: offTitle,
      };
      for (const file of files) counts[`rows_${file.campaignId}`] = (counts[`rows_${file.campaignId}`] ?? 0) + file.rows_exported;
      if (!reusedExisting && rowsRead !== null && rowsRead !== csvExported) {
        await this.d.repo.finishStep(run.run_id, "ingest", { useful_output: claimed, counts });
        return gateUnmet("ingest", `LeadPipe read ${rowsRead} rows but the export had ${csvExported}. ${claimed} rows landed for this run.`, counts);
      }
      if (!reusedExisting && rowsRead === null && claimed < csvExported) {
        await this.d.repo.finishStep(run.run_id, "ingest", { useful_output: claimed, counts });
        return gateUnmet("ingest", `LeadPipe reported no read count and ${claimed} of ${csvExported} exported rows landed; the rest are dedupe drops or missing and the service cannot tell which.`, counts);
      }
      const nulls = Object.entries(landed).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace("null_", "")} ${n}`);
      const line =
        `Ingest done: ${csvExported} exported, ${rowsRead === null ? "read count not reported (all landed)" : `${rowsRead} read`}, ${claimed} claimed for this run` +
        (reusedExisting ? " · reused rows already ingested for this run" : "") +
        (deduped > 0 ? ` (${deduped} duplicate people removed across campaigns)` : "") +
        (rowsRead !== null && rowsRead > claimed ? ` (${rowsRead - claimed} dropped as already in the table)` : "") +
        (nulls.length ? ` · empty after ingest: ${nulls.join(", ")} (LeadPipe column drop; see the parlay skill)` : " · city, state, industry, employee_range all landed") +
        ` · titles audited: ${offTitle} off-title flagged for step 8.`;
      return finish(this.d, run, "ingest", claimed, counts, line);
    });
  }

  private async rowsForLabel(table: string, label: string): Promise<number> {
    const { rows } = await this.d.repo.raw().query<{ n: string }>(`select count(*)::text as n from ${table} where source_label = $1`, [label]);
    return Number(rows[0]?.n ?? 0);
  }

  /** One row per email and per person id across this run's campaign labels. */
  private async dedupeLanded(table: string, runId: string, labels: string[], cols: Set<string>): Promise<number> {
    const match = dedupeMatchSql(cols);
    if (!match || labels.length === 0) return 0;
    return this.d.repo.withRun(runId, async (tx) => {
      const { rowCount } = await tx.query(
        `delete from ${table} a
         using ${table} b
         where a.source_label = any($1::text[])
           and b.source_label = any($1::text[])
           and a.ctid > b.ctid
           and (${match})`,
        [labels],
      );
      return rowCount ?? 0;
    });
  }

  private async landedCounts(table: string, runId: string, cols: Set<string>): Promise<Record<string, number>> {
    const want = ["city", "state", "industry", "employee_range"].filter((c) => cols.has(c));
    const sel = want.map((c) => `count(*) filter (where coalesce(${c}::text, '') = '')::text as "${c}"`);
    if (cols.has("phone")) sel.push(`count(*) filter (where coalesce(phone, '') <> '')::text as "with_phone"`);
    if (sel.length === 0) return {};
    const { rows } = await this.d.repo.raw().query<Record<string, string>>(`select ${sel.join(", ")} from ${table} where run_id = $1`, [runId]);
    const out: Record<string, number> = Object.fromEntries(want.map((c) => [`null_${c}`, Number(rows[0]?.[c] ?? 0)]));
    if (cols.has("phone")) out.with_phone = Number(rows[0]?.with_phone ?? 0); // D56
    return out;
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

/** Vendor CSV headers that carry a phone, mapped onto the lane table's phone column (D56). getleads exports mobile_phone. */
export const PHONE_HEADER_MAP: Readonly<Record<string, string>> = { mobile_phone: "phone", cellphone: "phone", phone: "phone", phone_number: "phone", mobile: "phone", direct_phone: "phone", wf_phone: "phone" };

function parseIngestJobs(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") out[key] = value;
      }
      return out;
    }
  } catch {
    /* a single job id from an older run is not reused across several labels */
  }
  return {};
}
