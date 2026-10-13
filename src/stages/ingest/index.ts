import { JOB_DONE, JOB_FAILED, type JobStatus, type LeadPipe } from "../../clients/leadpipe.js";
import { dedupeMatchSql } from "./dedupe.js";
import { ingestedTable } from "../../db/pool.js";
import { columnMapFor, fetchHeader } from "../../jobs/preflight.js";
import { peopleWithoutEmail, type NoEmailPerson } from "./noEmail.js";
import { runIsOpen, type RunRow } from "../../domain/runs.js";
import type { JobSettings } from "../../jobs/settings.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, columnsOf, finish, park, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";

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
  /** For tests: how the file's header line is fetched. */
  fetchImpl?: typeof fetch;
}

export function sourceLabel(run: RunRow, campaignId?: number): string {
  const base = `topup_${run.client_tag}_${run.lane}_${run.run_id.slice(0, 8)}`;
  return campaignId ? `${base}_c${campaignId}` : base;
}

/**
 * The label this job's rows land under. A one-campaign job stamps its
 * campaign on the label (route keeps that file on that campaign); a lane
 * job must not, or every row would be pinned to the lane's first campaign
 * and the recorded split would never run (D105).
 */
export function jobSourceLabel(run: RunRow, settings: Pick<JobSettings, "scope" | "campaign_id">): string {
  return sourceLabel(run, settings.scope === "lane" ? undefined : settings.campaign_id);
}

/** LeadPipe's canonical ingest columns. A header mapping may name only these as keys (a phone column is refused), with the file's own header cell as the value. */
export const LEADPIPE_CANONICAL_COLUMNS = ["first_name", "last_name", "email", "title", "company_name", "company_domain", "city", "state", "industry", "employee_range"] as const;

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

/**
 * A where clause the bot wrote for its own table: one expression made of
 * column names, string and number literals, comparisons, AND/OR/NOT,
 * IN (...), [NOT] [I]LIKE, IS [NOT] NULL, BETWEEN and parentheses. Nothing
 * else (no functions, no subqueries, no casts, no comments) runs against
 * the lane table.
 */
const WHERE_WORDS = new Set(["and", "or", "not", "in", "like", "ilike", "is", "null", "true", "false", "between"]);
/** Never a column name: anything that would turn a where into a statement, a subquery or a call. */
const WHERE_BANNED = new Set(["select", "from", "where", "union", "insert", "update", "delete", "drop", "alter", "create", "grant", "revoke", "truncate", "into", "exec", "execute", "call", "do", "copy", "with", "returning", "values", "lateral", "join", "case", "cast", "set", "limit", "offset", "order", "group", "having"]);
const WHERE_TOKEN = /\s+|'(?:[^']|'')*'|"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_.]*|\d+(?:\.\d+)?|<=|>=|<>|!=|=|<|>|\(|\)|,/giy;

export function safeWhere(where: string | null | undefined): string {
  const w = (where ?? "").trim() || "true";
  if (/;|--|\/\*|\$/.test(w)) throw new Error("where must be one SQL expression: no semicolons, comments or parameters");
  WHERE_TOKEN.lastIndex = 0;
  let pos = 0;
  let depth = 0;
  for (;;) {
    if (pos >= w.length) break;
    WHERE_TOKEN.lastIndex = pos;
    const m = WHERE_TOKEN.exec(w);
    if (!m || m.index !== pos || m[0].length === 0) throw new Error(`where has something the service does not run: near "${w.slice(pos, pos + 20)}"`);
    const t = m[0];
    pos += t.length;
    if (t === "(") depth += 1;
    else if (t === ")") depth -= 1;
    else if (/^[a-z_]/i.test(t)) {
      const word = t.toLowerCase();
      if (WHERE_BANNED.has(word) || word.startsWith("pg_")) throw new Error(`where has something the service does not run: "${t}"`);
      if (!WHERE_WORDS.has(word) && !/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(word)) throw new Error(`where has something the service does not run: "${t}"`);
      if (!WHERE_WORDS.has(word) && /^\s*\(/.test(w.slice(pos))) throw new Error(`where has something the service does not run: a call to "${t}"`);
    }
    if (depth < 0) throw new Error("where has unbalanced parentheses");
  }
  if (depth !== 0) throw new Error("where has unbalanced parentheses");
  return w;
}

/** `schema.table` names this client's own lane table (lp.<tag>_ingested_leads). */
export function isLaneTable(qualified: string, clientTag: string): boolean {
  return qualified.replace(/"/g, "").toLowerCase() === ingestedTable(clientTag).replace(/"/g, "").toLowerCase();
}

export class IngestStage {
  private readonly clock: Clock;

  constructor(private readonly d: IngestDeps) {
    this.clock = d.clock ?? realClock;
  }

  async run(run: RunRow, settings: JobSettings): Promise<StageOutcome> {
    return attempt(this.d, run, "ingest", "ingesting", async (attempts) => {
      const table = ingestedTable(run.client_tag);
      const cols = await columnsOf(this.d.repo, table);
      if (!cols.has("source_label")) throw new Error(`${table} has no source_label column; the lane table is not a LeadPipe table. Ask Josh.`);
      const label = jobSourceLabel(run, settings);
      const already = await this.rowsForLabel(table, label);
      let rowsRead: number | null = null;
      let expected: number | null = null;
      let vendor: { filtered_out: number | null; dupes_dropped: number | null; rows_inserted: number | null; note: string | null } = { filtered_out: null, dupes_dropped: null, rows_inserted: null, note: null };
      let leadpipeDone = false;
      const own = await this.d.repo.getStep(run.run_id, "ingest");
      if (settings.source.kind === "file_url" && (already === 0 || own?.vendor_job_id)) {
        // A started LeadPipe job is always polled to its end before anything is counted: a resumed or retried
        // ingest must not claim a pool LeadPipe is still writing. ingestFiles skips the start when the job exists.
        const status = await this.ingestFiles(run, settings.source.urls, label);
        if (JOB_FAILED.includes(status.status)) return park(this.d, run, "ingest", `LeadPipe could not ingest the file(s): ${status.error ?? status.status}. Export again and open a new job.`, attempts);
        rowsRead = status.rows_read;
        expected = status.rows_inserted ?? status.rows_read;
        vendor = { filtered_out: status.filtered_out, dupes_dropped: status.dupes_dropped, rows_inserted: status.rows_inserted, note: status.note };
        leadpipeDone = true;
      } else if (already === 0 && settings.source.kind === "table") {
        const copied = await this.copyTable(run, settings.source.table, settings.source.where, label, cols);
        rowsRead = copied.read;
        expected = copied.inserted;
        vendor = { filtered_out: null, dupes_dropped: copied.already_in_lane, rows_inserted: copied.inserted, note: null };
      }
      // D103: LeadPipe drops a row with no email; the email finder needs exactly those people. Same file, server to server.
      const noEmail = settings.source.kind === "file_url" && leadpipeDone ? await this.addPeopleWithoutEmail(run, settings.source.urls, label, cols) : null;
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
      const counts: Record<string, number> = {
        rows_exported: expected ?? claimed,
        rows_read: rowsRead ?? -1,
        rows_claimed: claimed,
        dedupe_dropped: deduped,
        ...(vendor.filtered_out != null ? { leadpipe_filtered_out: vendor.filtered_out } : {}),
        ...(vendor.dupes_dropped != null ? { already_in_lane: vendor.dupes_dropped } : {}),
        ...(vendor.rows_inserted != null ? { rows_inserted: vendor.rows_inserted } : {}),
        ...(noEmail ? { no_email_kept: noEmail.kept, no_email_without_name: noEmail.no_name, no_email_without_company: noEmail.no_company } : {}),
        ...landed,
      };
      // Every row read is accounted for: inserted + already in the lane + LeadPipe's own filter + duplicates within the pool.
      const accounted = (vendor.rows_inserted ?? claimed) + (vendor.dupes_dropped ?? 0) + (vendor.filtered_out ?? 0);
      if (rowsRead != null && vendor.rows_inserted != null && accounted !== rowsRead) counts.rows_unaccounted = rowsRead - accounted;
      const vendorWords =
        vendor.rows_inserted != null
          ? ` · of ${rowsRead ?? "?"} read: ${vendor.dupes_dropped ?? 0} already in the lane table (the client has them), ${vendor.filtered_out ?? 0} dropped by LeadPipe's own filter${vendor.note ? ` (${vendor.note.slice(0, 160)})` : ""}, ${vendor.rows_inserted} new` +
            (noEmail ? ` · ${noEmail.kept} people with no email kept for the email finder (${noEmail.no_name} without a full name and ${noEmail.no_company} without a company were left out)` : "")
          : "";
      if (claimed === 0) {
        await this.d.repo.finishStep(run.run_id, "ingest", { useful_output: 0, counts });
        const why =
          settings.source.kind === "file_url"
            ? vendor.rows_inserted === 0
              ? `the file(s): LeadPipe read ${rowsRead ?? 0} rows and inserted none (${vendor.dupes_dropped ?? 0} already in the lane table, ${vendor.filtered_out ?? 0} dropped by its own filter${vendor.note ? `: ${vendor.note.slice(0, 160)}` : ""})`
              : "the file: check it has rows and an email or a name column"
            : isLaneTable(settings.source.table, run.client_tag)
              ? `${settings.source.table} is the lane table itself: the where must pick rows with run_id null (for example source_label = 'your label'); rows another job already claimed do not count`
              : `table ${settings.source.table}: every email it holds is already in ${table}, or no row matched the where`;
        return gateUnmet("ingest", `nothing landed in ${table} from ${why}.`, counts);
      }
      const nulls = Object.entries(landed).filter(([k, n]) => k.startsWith("null_") && n > 0).map(([k, n]) => `${k.replace("null_", "")} ${n}`);
      const line =
        `Ingest done: ${claimed} rows landed for this job from ${settings.source.kind === "file_url" ? `${settings.source.urls.length} file(s)` : `table ${settings.source.table}`}` +
        vendorWords +
        (already > 0 ? " (rows already ingested under this job's label were reused)" : "") +
        (deduped > 0 ? ` · ${deduped} duplicate people removed within the pool` : "") +
        (nulls.length ? ` · empty after ingest: ${nulls.join(", ")}` : "") +
        ".";
      return finish(this.d, run, "ingest", claimed, counts, line);
    });
  }

  private async ingestFiles(run: RunRow, urls: string[], label: string): Promise<JobStatus> {
    const own = await this.d.repo.getStep(run.run_id, "ingest");
    let jobId = own?.vendor_job_id ?? null;
    if (!jobId) {
      // The file's own header names for LeadPipe's canonical columns, so a hand-built export still lands (keys canonical, values the file's cells).
      const header = await fetchHeader(urls[0]!, this.d.fetchImpl ?? fetch);
      const map = header ? columnMapFor(header) : {};
      const canonicalOnly = Object.fromEntries(Object.entries(map).filter(([k]) => (LEADPIPE_CANONICAL_COLUMNS as readonly string[]).includes(k)));
      const started = await this.d.leadpipe.ingestCsv(run.client_tag, { urls, source_label: label, dedupe_key: "email", ...(Object.keys(canonicalOnly).length ? { column_map: canonicalOnly } : {}) });
      jobId = started.job_id;
      await this.d.repo.setStepVendorJob(run.run_id, "ingest", jobId);
      await this.d.console.postInThread(run, `Ingest: LeadPipe ingest_csv started (job \`${jobId}\`, source_label \`${label}\`).`);
    }
    const status = await poll<JobStatus>(
      async () => {
        const s = await this.d.leadpipe.jobStatus(jobId!);
        if (JOB_FAILED.includes(s.status)) return { state: "done", value: s };
        if (JOB_DONE.includes(s.status)) return { state: "done", value: s };
        return { state: "running" };
      },
      { pollMs: this.d.cfg.pollMs, deadMs: this.d.cfg.deadMs, clock: this.clock, what: `LeadPipe ingest ${jobId}`, stop: async () => !runIsOpen((await this.d.repo.getRun(run.run_id))?.status ?? "aborted") },
    );
    await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "ingest", vendor: "leadpipe", action: "ingest_csv", rows: status.rows_read ?? 0, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: jobId, approvedBy: null });
    return status;
  }

  /**
   * insert … select from the bot's table into the lane table: only the standard
   * columns both sides have. Rows never leave Postgres. When the bot points at
   * the lane table itself (it ingested through LeadPipe under its own label),
   * the rows its where picks are relabelled for this job instead of copied.
   */
  private async copyTable(run: RunRow, qualified: string, where: string, label: string, laneCols: Set<string>): Promise<{ read: number; inserted: number; already_in_lane: number }> {
    const [schema, name] = qualified.split(".");
    if (!schema || !name || !IDENT.test(schema) || !IDENT.test(name)) throw new Error(`table must be schema.table, not ${qualified}`);
    if (isLaneTable(qualified, run.client_tag)) {
      const w = safeWhere(where);
      if (w === "true") throw new Error(`${qualified} is this job's own lane table. Pass a where that picks the rows you ingested (for example source_label = '…'), not the whole table.`);
      const { rowCount } = await this.d.repo.withRun(run.run_id, (tx) =>
        tx.query(
          `update ${ingestedTable(run.client_tag)} set qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('pool_label', source_label), source_label = $1
            where (${w}) and run_id is null`,
          [label],
        ),
      );
      await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "ingest", vendor: "supabase", action: "table_copy", rows: rowCount ?? 0, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: null, approvedBy: null });
      return { read: rowCount ?? 0, inserted: rowCount ?? 0, already_in_lane: 0 };
    }
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
    const { rows: sized } = await this.d.repo.raw().query<{ n: string; in_lane: string }>(
      `select count(*)::text as n,
              count(*) filter (where ${emailCol ? `exists (select 1 from ${ingestedTable(run.client_tag)} t where lower(t.email) = lower(${emailCol}))` : "false"})::text as in_lane
         from "${schema}"."${name}" s where (${w})`,
    );
    const read = Number(sized[0]?.n ?? 0);
    const alreadyInLane = Number(sized[0]?.in_lane ?? 0);
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
    return { read, inserted: rowCount ?? 0, already_in_lane: alreadyInLane };
  }

  /**
   * D103. The people in the file(s) with no email, added under this job's
   * label so the claim below picks them up with LeadPipe's rows. Once per
   * job: a resumed ingest finds them already there. Rows never leave the
   * process except into Postgres; nothing is logged.
   */
  private async addPeopleWithoutEmail(run: RunRow, urls: string[], label: string, cols: Set<string>): Promise<{ kept: number; no_name: number; no_company: number }> {
    const table = ingestedTable(run.client_tag);
    const { rows: had } = await this.d.repo.raw().query<{ n: string }>(
      `select count(*)::text as n from ${table} where source_label = $1 and qa_flags->>'email_source' = 'none_in_file'`,
      [label],
    );
    const prior = Number(had[0]?.n ?? 0);
    if (prior > 0) return { kept: prior, no_name: 0, no_company: 0 };
    const people: NoEmailPerson[] = [];
    const seen = new Set<string>();
    let noName = 0;
    let noCompany = 0;
    for (const url of urls) {
      const res = await (this.d.fetchImpl ?? fetch)(url);
      if (!res.ok) throw new Error(`could not read the export file for its people without an email (HTTP ${res.status}); export again and open a new job`);
      const scan = peopleWithoutEmail(await res.text());
      noName += scan.no_name;
      noCompany += scan.no_company;
      for (const p of scan.kept) {
        const key = `${p.first_name.toLowerCase()}|${p.last_name.toLowerCase()}|${p.company_domain ?? (p.company_name ?? "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        people.push(p);
      }
    }
    if (people.length === 0) return { kept: 0, no_name: noName, no_company: noCompany };
    const fields = (["first_name", "last_name", "title", "company_name", "company_domain", "city", "state", "industry", "employee_range"] as const).filter((c) => cols.has(c));
    const flag = JSON.stringify({ email_source: "none_in_file" });
    let kept = 0;
    for (let i = 0; i < people.length; i += 1000) {
      const chunk = people.slice(i, i + 1000);
      const arrays = fields.map((f) => chunk.map((p) => p[f]));
      const { rowCount } = await this.d.repo.withRun(run.run_id, (tx) =>
        tx.query(
          `insert into ${table} (${fields.join(", ")}, source_label, qa_flags)
           select ${fields.map((f) => `v.${f}`).join(", ")}, $1, $2::jsonb
             from unnest(${fields.map((_, j) => `$${j + 3}::text[]`).join(", ")}) as v(${fields.join(", ")})`,
          [label, flag, ...arrays],
        ),
      );
      kept += rowCount ?? 0;
    }
    return { kept, no_name: noName, no_company: noCompany };
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
