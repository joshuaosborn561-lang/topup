import { JOB_DONE, JOB_FAILED, type JobStatus, type LeadPipe } from "../../clients/leadpipe.js";
import { dedupeMatchSql } from "./dedupe.js";
import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { JobSettings } from "../../jobs/settings.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, columnsOf, finish, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Ingest (D99): the pool Grokbot pulled the way the transcript did lands in
 * lp.<tag>_ingested_leads under a source_label naming this job.
 *
 *   file_url   LeadPipe `lp_run ingest_csv` from the signed URL(s). The file
 *              never passes through chat or through this process.
 *   table      a table or view on campaignintelligence the bot built in SQL;
 *              the standard columns are copied server side (insert … select).
 *
 * Gate: the rows that landed are claimed for this run. Counts only.
 */
export interface IngestDeps extends StageDeps {
  leadpipe: LeadPipe;
  rails: SpendRails;
  cfg: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export function sourceLabel(run: RunRow, campaignId?: number): string {
  const base = `topup_${run.client_tag}_${run.lane}_${run.run_id.slice(0, 8)}`;
  return campaignId ? `${base}_c${campaignId}` : base;
}

/** Vendor CSV headers that carry a phone, mapped onto the lane table's phone column (D56). getleads exports mobile_phone. */
export const PHONE_HEADER_MAP: Readonly<Record<string, string>> = { mobile_phone: "phone", cellphone: "phone", phone: "phone", phone_number: "phone", mobile: "phone", direct_phone: "phone", wf_phone: "phone" };

/** Lane column → the names a hand-built table may use for it. First present wins. */
export const TABLE_COLUMN_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  email: ["email", "work_email", "wf_email", "candidate_email", "person_email"],
  first_name: ["first_name", "first", "firstname"],
  last_name: ["last_name", "last", "lastname"],
  company_name: ["company_name", "company", "company_n", "current_employer", "organization"],
  title: ["title", "job_title", "owner_title", "current_title", "position"],
  company_domain: ["company_domain", "domain", "wf_domain", "website"],
  city: ["city"],
  state: ["state", "region"],
  industry: ["industry", "vertical"],
  employee_range: ["employee_range", "company_size", "size_band", "headcount"],
  phone: ["phone", "cellphone", "wf_phone", "mobile_phone", "phone_number", "mobile"],
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** A where clause the bot wrote for its own table: one expression, no statement separators, no comments. */
export function safeWhere(where: string | null | undefined): string {
  const w = (where ?? "").trim() || "true";
  if (/;|--|\/\*/.test(w)) throw new Error("where must be one SQL expression: no semicolons or comments");
  return w;
}

export class IngestStage {
  private readonly clock: Clock;

  constructor(private readonly d: IngestDeps) {
    this.clock = d.clock ?? realClock;
  }

  async run(run: RunRow, settings: JobSettings): Promise<StageOutcome> {
    return attempt(this.d, run, "ingest", "ingesting", async () => {
      const table = ingestedTable(run.client_tag);
      const cols = await columnsOf(this.d.repo, table);
      if (!cols.has("source_label")) throw new Error(`${table} has no source_label column; the lane table is not a LeadPipe table. Ask Josh.`);
      const label = sourceLabel(run, settings.campaign_id);
      const already = await this.rowsForLabel(table, label);
      let rowsRead: number | null = null;
      let expected: number | null = null;
      if (already === 0) {
        if (settings.source.kind === "file_url") {
          rowsRead = await this.ingestFiles(run, settings.source.urls, label, cols);
          expected = rowsRead;
        } else {
          rowsRead = await this.copyTable(run, settings.source.table, settings.source.where, label, cols);
          expected = rowsRead;
        }
      }
      const deduped = await this.dedupeLanded(table, run.run_id, label, cols);
      const fills: string[] = [];
      if (cols.has("employee_range") && cols.has("company_size")) fills.push("company_size = coalesce(company_size, employee_range)");
      if (cols.has("industry") && cols.has("vertical")) fills.push("vertical = coalesce(vertical, industry)");
      const claimed = await this.d.repo.withRun(run.run_id, async (tx) => {
        await tx.query(
          `update ${table} set run_id = $1, lead_status = 'ingested', status_changed_at = now()${fills.length ? ", " + fills.join(", ") : ""}
           where source_label = $2 and run_id is null`,
          [run.run_id, label],
        );
        const { rows } = await tx.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and source_label = $2`, [run.run_id, label]);
        return Number(rows[0]?.n ?? 0);
      });
      const landed = await this.landedCounts(table, run.run_id, cols);
      const counts: Record<string, number> = { rows_exported: expected ?? claimed, rows_read: rowsRead ?? -1, rows_claimed: claimed, dedupe_dropped: deduped, ...landed };
      if (claimed === 0) {
        await this.d.repo.finishStep(run.run_id, "ingest", { useful_output: 0, counts });
        return gateUnmet("ingest", `nothing landed in ${table} from the pool (${settings.source.kind === "file_url" ? "the file" : `table ${settings.source.table}`}). Check the pool has rows and an email or a name column.`, counts);
      }
      const nulls = Object.entries(landed).filter(([k, n]) => k.startsWith("null_") && n > 0).map(([k, n]) => `${k.replace("null_", "")} ${n}`);
      const line =
        `Ingest done: ${claimed} rows landed for this job from ${settings.source.kind === "file_url" ? `${settings.source.urls.length} file(s)` : `table ${settings.source.table}`}` +
        (already > 0 ? " (rows already ingested under this job's label were reused)" : "") +
        (deduped > 0 ? ` · ${deduped} duplicate people removed within the pool` : "") +
        (nulls.length ? ` · empty after ingest: ${nulls.join(", ")}` : "") +
        ".";
      return finish(this.d, run, "ingest", claimed, counts, line);
    });
  }

  private async ingestFiles(run: RunRow, urls: string[], label: string, cols: Set<string>): Promise<number | null> {
    const own = await this.d.repo.getStep(run.run_id, "ingest");
    let jobId = own?.vendor_job_id ?? null;
    if (!jobId) {
      const started = await this.d.leadpipe.ingestCsv(run.client_tag, { urls, source_label: label, dedupe_key: "email", ...(cols.has("phone") ? { column_map: PHONE_HEADER_MAP } : {}) });
      jobId = started.job_id;
      await this.d.repo.setStepVendorJob(run.run_id, "ingest", jobId);
      await this.d.console.postInThread(run, `Ingest: LeadPipe ingest_csv started (job \`${jobId}\`, source_label \`${label}\`).`);
    }
    const status = await poll<JobStatus>(
      async () => {
        const s = await this.d.leadpipe.jobStatus(jobId!);
        if (JOB_FAILED.includes(s.status)) return { state: "failed", error: s.error ?? s.status };
        if (JOB_DONE.includes(s.status)) return { state: "done", value: s };
        return { state: "running" };
      },
      { pollMs: this.d.cfg.pollMs, deadMs: this.d.cfg.deadMs, clock: this.clock, what: `LeadPipe ingest ${jobId}`, stop: async () => (await this.d.repo.getRun(run.run_id))?.status === "aborted" },
    );
    await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "ingest", vendor: "leadpipe", action: "ingest_csv", rows: status.rows_read ?? 0, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: jobId, approvedBy: null });
    return status.rows_read;
  }

  /** insert … select from the bot's table into the lane table: only the standard columns both sides have. Rows never leave Postgres. */
  private async copyTable(run: RunRow, qualified: string, where: string, label: string, laneCols: Set<string>): Promise<number> {
    const [schema, name] = qualified.split(".");
    if (!schema || !name || !IDENT.test(schema) || !IDENT.test(name)) throw new Error(`table must be schema.table, not ${qualified}`);
    const src = await columnsOf(this.d.repo, `${schema}.${name}`);
    if (src.size === 0) throw new Error(`${qualified} does not exist on campaignintelligence, or the service cannot read it. Ask Josh to grant select.`);
    const pairs: Array<[string, string]> = [];
    for (const [lane, names] of Object.entries(TABLE_COLUMN_SYNONYMS)) {
      if (!laneCols.has(lane)) continue;
      const found = names.find((n) => src.has(n));
      if (found) pairs.push([lane, `nullif(btrim(s."${found}"::text), '')`]);
    }
    if (!pairs.some(([c]) => c === "email") && !pairs.some(([c]) => c === "first_name")) {
      throw new Error(`${qualified} has no email and no first_name column the service recognises (${Object.values(TABLE_COLUMN_SYNONYMS).flat().join(", ")})`);
    }
    const w = safeWhere(where);
    const emailCol = pairs.find(([c]) => c === "email")?.[1];
    const { rowCount } = await this.d.repo.withRun(run.run_id, (tx) =>
      tx.query(
        `insert into ${ingestedTable(run.client_tag)} (${pairs.map(([c]) => c).join(", ")}, source_label)
         select ${pairs.map(([, e]) => e).join(", ")}, $1
           from "${schema}"."${name}" s
          where (${w})${emailCol ? ` and not exists (select 1 from ${ingestedTable(run.client_tag)} t where lower(t.email) = lower(${emailCol}))` : ""}`,
        [label],
      ),
    );
    await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "ingest", vendor: "supabase", action: "table_copy", rows: rowCount ?? 0, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: null, approvedBy: null });
    return rowCount ?? 0;
  }

  private async rowsForLabel(table: string, label: string): Promise<number> {
    const { rows } = await this.d.repo.raw().query<{ n: string }>(`select count(*)::text as n from ${table} where source_label = $1`, [label]);
    return Number(rows[0]?.n ?? 0);
  }

  /** One row per email and per person across this job's label. */
  private async dedupeLanded(table: string, runId: string, label: string, cols: Set<string>): Promise<number> {
    const match = dedupeMatchSql(cols);
    if (!match) return 0;
    return this.d.repo.withRun(runId, async (tx) => {
      const { rowCount } = await tx.query(`delete from ${table} a using ${table} b where a.source_label = $1 and b.source_label = $1 and a.ctid > b.ctid and (${match})`, [label]);
      return rowCount ?? 0;
    });
  }

  private async landedCounts(table: string, runId: string, cols: Set<string>): Promise<Record<string, number>> {
    const want = ["city", "state", "industry", "employee_range"].filter((c) => cols.has(c));
    const sel = want.map((c) => `count(*) filter (where coalesce(${c}::text, '') = '')::text as "${c}"`);
    if (cols.has("phone")) sel.push(`count(*) filter (where coalesce(phone, '') <> '')::text as "with_phone"`);
    if (cols.has("email")) sel.push(`count(*) filter (where coalesce(email, '') <> '')::text as "with_email"`);
    if (sel.length === 0) return {};
    const { rows } = await this.d.repo.raw().query<Record<string, string>>(`select ${sel.join(", ")} from ${table} where run_id = $1`, [runId]);
    const out: Record<string, number> = Object.fromEntries(want.map((c) => [`null_${c}`, Number(rows[0]?.[c] ?? 0)]));
    if (cols.has("phone")) out.with_phone = Number(rows[0]?.with_phone ?? 0);
    if (cols.has("email")) out.with_email = Number(rows[0]?.with_email ?? 0);
    return out;
  }
}
