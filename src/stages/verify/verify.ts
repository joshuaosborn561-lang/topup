import type { LeadPipe } from "../../clients/leadpipe.js";
import type { Verifier, VerifierResults, VerifierStatus } from "../../clients/verifier.js";
import type { Repo } from "../../db/repo.js";
import { ingestedTable } from "../../db/pool.js";
import { MAX_STEP_ATTEMPTS, type RunRow } from "../../domain/runs.js";
import { parseCsv } from "../../lib/csv.js";
import { logger } from "../../lib/log.js";
import { recipeAuthorises, type Recipe } from "../../recipes/schema.js";
import { parkedCard, spendApprovalCard, stallCard } from "../../slack/cards.js";
import type { SlackConsole } from "../../slack/console.js";
import { usd, worstCaseCents } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import { sendableGate, type GateUnmet } from "../../spine/gate.js";
import { decide, observe, splitNames, type BatchState, type RunbookConfig } from "./runbook.js";
import { verdictFromCsvRow, type Verdict } from "./sendable.js";

const log = logger("verify");

export interface VerifyConfig {
  pollMs: number;
  cardTimeoutMs: number;
  runbook: RunbookConfig;
}

export interface VerifyDeps {
  repo: Repo;
  rails: SpendRails;
  console: SlackConsole;
  leadpipe: LeadPipe;
  verifier: Verifier;
  fetchImpl?: typeof fetch;
  cfg: VerifyConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type VerifyOutcome =
  | { kind: "done"; sendable: number; seg: number; other: number; rejected: number; stalled: number }
  | { kind: "nothing" }
  | { kind: "parked"; reason: string }
  | { kind: "declined" }
  | { kind: "retry"; error: string }
  | GateUnmet;

interface BatchRow {
  run_id: string;
  batch: string;
  parent_batch: string | null;
  rows: number;
  vendor_run_id: string | null;
  status: "claimed" | "submitted" | "completed" | "split" | "residue" | "aborted";
  submitted_at: string | null;
  last_progress_at: string | null;
  last_percent: number;
  last_verified: number;
  resumes_used: number;
  worst_case_cents: number | null;
  approved_cents: number | null;
}

const ACTIVE: ReadonlyArray<BatchRow["status"]> = ["claimed", "submitted"];

/** Batch marker written on lead rows: unique per run so an equality export selects exactly one batch. */
export function batchMarker(runId: string, batch: string): string {
  return `${runId.slice(0, 8)}:${batch}`;
}

export function verifyWorstCaseCents(rows: number): number {
  // Every row is billed by MillionVerifier; worst case every row is also a catch-all sent to No2Bounce.
  return worstCaseCents("millionverifier", "verify", rows) + worstCaseCents("no2bounce", "verify", rows);
}

export class VerifyStage {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly d: VerifyDeps) {
    this.now = d.now ?? (() => Date.now());
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.fetchImpl = d.fetchImpl ?? fetch;
  }

  async run(run: RunRow, recipe: Recipe): Promise<VerifyOutcome> {
    const { repo } = this.d;
    const table = ingestedTable(run.client_tag);
    const step = await repo.beginStep(run.run_id, "verify");
    if (!step.ok) return this.park(run, `verify failed ${step.attempts - 1} times`, step.attempts - 1);
    await repo.setRunStatus(run.run_id, "verifying", "verify");

    try {
      let batches = await this.loadBatches(run.run_id);
      if (batches.length === 0) {
        const claimed = await this.claimRows(run, table);
        if (claimed === 0) {
          await repo.finishStep(run.run_id, "verify", { useful_output: 0, counts: { needs_verify: 0 } });
          await this.d.console.postInThread(run, "Verify: nothing to verify (no rows in needs_verify).");
          return { kind: "nothing" };
        }
        await this.insertBatch(run.run_id, "A0", null, claimed);
        batches = await this.loadBatches(run.run_id);
        await this.d.console.postInThread(run, `Verify: ${claimed} rows claimed as batch A0.`);
      }

      for (;;) {
        batches = await this.loadBatches(run.run_id);
        const active = batches.filter((b) => ACTIVE.includes(b.status));
        if (active.length === 0) break;
        for (const b of active) {
          const r = b.status === "claimed" ? await this.submitBatch(run, recipe, table, b) : await this.pollBatch(run, table, b);
          if (r && r.kind !== "done") return r;
        }
        await this.sleep(this.d.cfg.pollMs);
      }
      return this.finish(run, table);
    } catch (err) {
      const message = (err as Error).message;
      const parked = step.attempts >= MAX_STEP_ATTEMPTS;
      await repo.failStep(run.run_id, "verify", message, parked);
      log.error("verify step failed", { run_id: run.run_id, attempt: step.attempts, parked, error: message });
      if (parked) return this.park(run, message, step.attempts);
      return { kind: "retry", error: message };
    }
  }

  // ---------------------------------------------------------------------

  private async claimRows(run: RunRow, table: string): Promise<number> {
    const marker = batchMarker(run.run_id, "A0");
    return this.d.repo.withRun(run.run_id, async (tx) => {
      const { rowCount } = await tx.query(
        `update ${table} set lead_status = 'verifying', run_id = $1, verify_batch = $2, status_changed_at = now()
         where lead_status = 'needs_verify' and (run_id is null or run_id = $1)`,
        [run.run_id, marker],
      );
      return rowCount ?? 0;
    });
  }

  private async loadBatches(runId: string): Promise<BatchRow[]> {
    const { rows } = await this.d.repo.raw().query<BatchRow>(`select * from topup.verify_batches where run_id = $1 order by batch`, [runId]);
    return rows;
  }

  private async insertBatch(runId: string, batch: string, parent: string | null, rows: number): Promise<void> {
    await this.d.repo.raw().query(
      `insert into topup.verify_batches (run_id, batch, parent_batch, rows) values ($1,$2,$3,$4)
       on conflict (run_id, batch) do nothing`,
      [runId, batch, parent, rows],
    );
  }

  private async patchBatch(runId: string, batch: string, patch: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(patch);
    if (keys.length === 0) return;
    const sets = keys.map((k, i) => `"${k}" = $${i + 3}`).join(", ");
    await this.d.repo.raw().query(`update topup.verify_batches set ${sets} where run_id = $1 and batch = $2`, [runId, batch, ...keys.map((k) => patch[k])]);
  }

  private async submitBatch(run: RunRow, recipe: Recipe, table: string, b: BatchRow): Promise<VerifyOutcome | { kind: "done" }> {
    const { repo, rails, console: slack } = this.d;
    const worst = verifyWorstCaseCents(b.rows);
    // An approval survives a restart on run_steps.approved_cents; a batch that
    // was never submitted has none of its own yet.
    const stepRow = await repo.getStep(run.run_id, "verify");
    const priorApproval = b.approved_cents ?? stepRow?.approved_cents ?? 0;
    const decision = await rails.gate({
      runId: run.run_id,
      clientTag: run.client_tag,
      step: "verify",
      vendor: "millionverifier",
      action: b.parent_batch ? "verify_split" : "verify",
      rows: b.rows,
      recipeAuthorised: recipeAuthorises(recipe, "verify", "millionverifier"),
      approvedCents: priorApproval,
      worstCaseCents: worst,
    });
    let approved = priorApproval;
    if (decision.kind === "blocked") {
      await slack.postInThread(run, `:octagonal_sign: Verify batch ${b.batch} blocked: ${decision.reason}`);
      return this.park(run, decision.reason, 0);
    }
    if (decision.kind === "ask") {
      const outcome = await this.askSpend(run, b, worst);
      if (outcome !== "approved") return outcome === "declined" ? this.declineBatch(run, table, b) : this.park(run, `spend card for batch ${b.batch} got no answer`, 0);
      approved = worst;
    }

    const marker = batchMarker(run.run_id, b.batch);
    const exported = await this.d.leadpipe.exportIngested(run.client_tag, { verify_batch: marker }, ["email", "id"]);
    if (exported.row_count !== b.rows) {
      throw new Error(`export for batch ${b.batch} returned ${exported.row_count} rows, expected ${b.rows}; refusing to submit a truncated file`);
    }
    const balanceBefore = await rails.readBalance("millionverifier");
    const segment = `${recipe.recipe_id}_${run.run_id.slice(0, 8)}_${b.batch}`;
    const started = await this.d.verifier.start(exported.signed_url, segment);
    await rails.record({
      runId: run.run_id,
      clientTag: run.client_tag,
      step: "verify",
      vendor: "millionverifier",
      action: b.parent_batch ? "verify_split" : "verify",
      rows: b.rows,
      credits: null,
      worstCaseCents: worst,
      balanceBefore,
      balanceAfter: null,
      vendorJobId: started.run_id,
      approvedBy: null,
    });
    const nowIso = new Date(this.now()).toISOString();
    await this.patchBatch(run.run_id, b.batch, {
      status: "submitted",
      vendor_run_id: started.run_id,
      submitted_at: nowIso,
      last_progress_at: nowIso,
      worst_case_cents: worst,
      approved_cents: approved,
    });
    await repo.setStepVendorJob(run.run_id, "verify", started.run_id);
    await slack.postInThread(run, `Verify batch ${b.batch}: ${b.rows} rows submitted (verifier run \`${started.run_id}\`, worst case ${usd(worst)}).`);
    return { kind: "done" };
  }

  private async askSpend(run: RunRow, b: BatchRow, worst: number): Promise<"approved" | "declined" | "timeout"> {
    const { repo, rails, console: slack } = this.d;
    const spentToday = await repo.spentTodayCents();
    const card = await slack.ask({
      run,
      kind: "spend_approval",
      audience: "owner",
      payload: { batch: b.batch, rows: b.rows, worst_case_cents: worst, vendor: "millionverifier+no2bounce" },
      text: `Spend ask: verify ${b.rows} rows, worst case ${usd(worst)}`,
      blocks: (cardId) =>
        spendApprovalCard({
          cardId,
          runId: run.run_id,
          clientTag: run.client_tag,
          step: "verify",
          vendor: "millionverifier + no2bounce",
          action: b.parent_batch ? "verify_split (re-bill)" : "verify",
          rows: b.rows,
          worstCaseCents: worst,
          projectedUseful: null,
          spentTodayCents: spentToday,
          dailyCapCents: rails.cfg.dailyCapCents,
        }),
      expiresAt: new Date(this.now() + this.d.cfg.cardTimeoutMs),
    });
    await repo.setRunStatus(run.run_id, "awaiting_josh", "verify");
    await repo.setStepWaiting(run.run_id, "verify", worst);
    const resolved = await slack.awaitCard(card.card_id, { pollMs: Math.min(this.d.cfg.pollMs, 15000), timeoutMs: this.d.cfg.cardTimeoutMs, sleep: this.sleep });
    await repo.setStepRunning(run.run_id, "verify");
    await repo.setRunStatus(run.run_id, "verifying", "verify");
    if (!resolved) return "timeout";
    if (resolved.resolution === "approve_spend") {
      await repo.approveStep(run.run_id, "verify", worst);
      await rails.record({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "verify",
        vendor: "millionverifier",
        action: "approval",
        rows: b.rows,
        credits: null,
        worstCaseCents: worst,
        balanceBefore: null,
        balanceAfter: null,
        vendorJobId: null,
        approvedBy: resolved.resolved_by,
      });
      return "approved";
    }
    return "declined";
  }

  private async declineBatch(run: RunRow, table: string, b: BatchRow): Promise<VerifyOutcome> {
    // Declined spend: rows go back to needs_verify. They are not verified and must not be sent.
    await this.d.repo.withRun(run.run_id, (tx) =>
      tx.query(`update ${table} set lead_status = 'needs_verify', verify_batch = null, status_changed_at = now() where run_id = $1 and verify_batch = $2 and lead_status = 'verifying'`, [
        run.run_id,
        batchMarker(run.run_id, b.batch),
      ]),
    );
    await this.patchBatch(run.run_id, b.batch, { status: "aborted", finished_at: new Date(this.now()).toISOString() });
    await this.d.repo.failStep(run.run_id, "verify", `spend declined for batch ${b.batch}`, false);
    await this.d.repo.setRunStatus(run.run_id, "declined", "verify");
    await this.d.console.postInThread(run, `Verify batch ${b.batch}: spend declined. ${b.rows} rows returned to needs_verify; nothing was sent.`);
    return { kind: "declined" };
  }

  private toState(b: BatchRow): BatchState {
    return {
      batch: b.batch,
      rows: b.rows,
      vendorRunId: b.vendor_run_id,
      submittedAt: b.submitted_at ? Date.parse(b.submitted_at) : this.now(),
      lastProgressAt: b.last_progress_at ? Date.parse(b.last_progress_at) : this.now(),
      lastPercent: b.last_percent,
      lastVerified: b.last_verified,
      resumesUsed: b.resumes_used,
    };
  }

  private async pollBatch(run: RunRow, table: string, b: BatchRow): Promise<VerifyOutcome | { kind: "done" }> {
    const { repo, console: slack, verifier } = this.d;
    if (!b.vendor_run_id) throw new Error(`batch ${b.batch} is submitted without a vendor run id`);
    const now = this.now();
    const obs = await verifier.status(b.vendor_run_id);
    const state = observe(this.toState(b), obs, now);
    if (state.lastProgressAt !== this.toState(b).lastProgressAt || state.lastPercent !== b.last_percent) {
      await this.patchBatch(run.run_id, b.batch, {
        last_progress_at: new Date(state.lastProgressAt).toISOString(),
        last_percent: state.lastPercent,
        last_verified: state.lastVerified,
      });
    }
    const needResults = obs.status === "completed" || obs.status === "failed" || obs.status === "paused";
    const results = needResults ? await verifier.results(b.vendor_run_id) : null;
    const action = decide(state, obs, results, now, this.d.cfg.runbook);
    log.info("runbook", { run_id: run.run_id, batch: b.batch, vendor_run_id: b.vendor_run_id, status: obs.status, action: action.kind, reason: action.reason });

    switch (action.kind) {
      case "wait":
        return { kind: "done" };
      case "resume":
        return this.resumeBatch(run, b, state, action.reason);
      case "zero_result": {
        await repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "zero_result_resume", rows: b.rows, detail: { reason: action.reason } });
        await slack.postInThread(run, `:warning: Verify batch ${b.batch}: ${action.reason}. Treating as a stall, not as rejected.`);
        if (state.resumesUsed === 0) return this.resumeBatch(run, b, state, action.reason);
        return b.rows <= this.d.cfg.runbook.minSplitRows ? this.residue(run, table, b, action.reason) : this.splitBatch(run, table, b, action.reason);
      }
      case "complete":
        return this.completeBatch(run, table, b, obs, results!);
      case "salvage_then_split":
        await this.completeBatch(run, table, b, obs, results!, /* partial */ true);
        return this.splitBatch(run, table, b, action.reason);
      case "split":
        return this.splitBatch(run, table, b, action.reason);
      case "residue":
        return this.residue(run, table, b, action.reason);
    }
  }

  private async resumeBatch(run: RunRow, b: BatchRow, state: BatchState, reason: string): Promise<{ kind: "done" }> {
    const { repo, rails, console: slack, verifier } = this.d;
    await repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "stalled", percent: state.lastPercent, verified: state.lastVerified, rows: b.rows, detail: { reason } });
    try {
      await verifier.resume(b.vendor_run_id!);
    } catch (err) {
      // The server refuses a third resume on an unmoving file; count it and let the next poll split.
      log.warn("resume refused", { run_id: run.run_id, batch: b.batch, error: (err as Error).message });
    }
    await repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "resumed", percent: state.lastPercent, verified: state.lastVerified, rows: b.rows });
    await rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "verify", vendor: "millionverifier", action: "resume", rows: b.rows, credits: 0, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: b.vendor_run_id, approvedBy: null });
    await this.patchBatch(run.run_id, b.batch, { resumes_used: state.resumesUsed + 1, last_progress_at: new Date(this.now()).toISOString() });
    await slack.postInThread(run, `Verify batch ${b.batch}: stalled (${reason}). Resumed for free (${state.resumesUsed + 1} of 2).`);
    return { kind: "done" };
  }

  /** A split resubmits rows the vendor may bill again: it is an ask when over the cap (rail 5). */
  private async splitBatch(run: RunRow, table: string, b: BatchRow, reason: string): Promise<VerifyOutcome | { kind: "done" }> {
    const { repo, rails, console: slack } = this.d;
    const remaining = await this.remainingRows(run, table, b);
    if (remaining <= this.d.cfg.runbook.minSplitRows) return this.residue(run, table, b, `${reason}; ${remaining} rows remain`);
    const splitWorst = verifyWorstCaseCents(remaining);
    await repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "split_asked", rows: remaining, detail: { reason, worst_case_cents: splitWorst } });

    const card = await slack.ask({
      run,
      kind: "stall",
      audience: splitWorst > rails.cfg.autoCapCents ? "owner" : "operator",
      payload: { batch: b.batch, remaining, worst_case_cents: splitWorst },
      text: `Verification stalled on batch ${b.batch}: ${remaining} rows unverified`,
      blocks: (cardId) =>
        stallCard({
          cardId,
          runId: run.run_id,
          clientTag: run.client_tag,
          vendorRunId: b.vendor_run_id ?? "?",
          percent: b.last_percent,
          verified: b.last_verified,
          total: b.rows,
          resumesUsed: b.resumes_used,
          splitRows: remaining,
          splitWorstCaseCents: splitWorst,
          autoCapCents: rails.cfg.autoCapCents,
        }),
      expiresAt: new Date(this.now() + this.d.cfg.cardTimeoutMs),
    });
    await repo.setRunStatus(run.run_id, splitWorst > rails.cfg.autoCapCents ? "awaiting_josh" : "awaiting_operator", "verify");
    await repo.setStepWaiting(run.run_id, "verify", splitWorst);
    const resolved = await slack.awaitCard(card.card_id, { pollMs: Math.min(this.d.cfg.pollMs, 15000), timeoutMs: this.d.cfg.cardTimeoutMs, sleep: this.sleep });
    await repo.setStepRunning(run.run_id, "verify");
    await repo.setRunStatus(run.run_id, "verifying", "verify");
    if (!resolved) return this.park(run, `stall card for batch ${b.batch} got no answer`, 0);

    if (resolved.resolution === "abort") {
      await repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "abort", rows: remaining });
      return this.residue(run, table, b, "aborted from Slack");
    }
    if (resolved.resolution === "resume") {
      // A human asked for one more free resume; the runbook takes over again on the next poll.
      return this.resumeBatch(run, b, this.toState(b), "resume tapped");
    }

    const [c1, c2] = splitNames(b.batch);
    const [m1, m2] = [batchMarker(run.run_id, c1), batchMarker(run.run_id, c2)];
    const counts = await repo.withRun(run.run_id, async (tx) => {
      await tx.query(
        `with r as (
           select id, ntile(2) over (order by id) as half from ${table}
           where run_id = $1 and verify_batch = $2 and lead_status = 'verifying')
         update ${table} t set verify_batch = case when r.half = 1 then $3 else $4 end
         from r where t.id = r.id`,
        [run.run_id, batchMarker(run.run_id, b.batch), m1, m2],
      );
      const { rows } = await tx.query<{ verify_batch: string; n: string }>(
        `select verify_batch, count(*)::text as n from ${table} where run_id = $1 and verify_batch in ($2, $3) group by 1`,
        [run.run_id, m1, m2],
      );
      return Object.fromEntries(rows.map((r) => [r.verify_batch, Number(r.n)]));
    });
    const approvedEach = resolved.resolution === "split" && splitWorst > rails.cfg.autoCapCents ? Math.ceil(splitWorst / 2) : 0;
    await this.insertBatch(run.run_id, c1, b.batch, counts[m1] ?? 0);
    await this.insertBatch(run.run_id, c2, b.batch, counts[m2] ?? 0);
    if (approvedEach > 0) {
      await this.patchBatch(run.run_id, c1, { approved_cents: approvedEach });
      await this.patchBatch(run.run_id, c2, { approved_cents: approvedEach });
      await repo.approveStep(run.run_id, "verify", splitWorst);
    }
    await this.patchBatch(run.run_id, b.batch, { status: "split", finished_at: new Date(this.now()).toISOString() });
    await repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "split", rows: remaining, detail: { children: [c1, c2], approved_by: resolved.resolved_by } });
    await slack.postInThread(run, `Verify batch ${b.batch}: split into ${c1} (${counts[m1] ?? 0}) and ${c2} (${counts[m2] ?? 0}) by <@${resolved.resolved_by}>.`);
    return { kind: "done" };
  }

  private async remainingRows(run: RunRow, table: string, b: BatchRow): Promise<number> {
    const { rows } = await this.d.repo.raw().query<{ n: string }>(
      `select count(*)::text as n from ${table} where run_id = $1 and verify_batch = $2 and lead_status = 'verifying'`,
      [run.run_id, batchMarker(run.run_id, b.batch)],
    );
    return Number(rows[0]?.n ?? 0);
  }

  private async residue(run: RunRow, table: string, b: BatchRow, reason: string): Promise<{ kind: "done" }> {
    const n = await this.d.repo.withRun(run.run_id, async (tx) => {
      const { rowCount } = await tx.query(
        `update ${table} set lead_status = 'stalled_unverified', ev_status = 'unresolved', status_changed_at = now()
         where run_id = $1 and verify_batch = $2 and lead_status = 'verifying'`,
        [run.run_id, batchMarker(run.run_id, b.batch)],
      );
      return rowCount ?? 0;
    });
    await this.patchBatch(run.run_id, b.batch, { status: "residue", unresolved: n, finished_at: new Date(this.now()).toISOString() });
    await this.d.repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "residue", rows: n, detail: { reason } });
    await this.d.console.postInThread(run, `Verify batch ${b.batch}: ${n} rows left as stalled_unverified (${reason}). They will not be sent.`);
    return { kind: "done" };
  }

  private async downloadVerdicts(url: string | null, file: "sendable" | "rejected" | "unresolved"): Promise<Verdict[]> {
    if (!url) return [];
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`download ${file} CSV: HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    return rows.map((r) => verdictFromCsvRow(r, file)).filter((v): v is Verdict => v !== null);
  }

  private async completeBatch(run: RunRow, table: string, b: BatchRow, obs: VerifierStatus, results: VerifierResults, partial = false): Promise<{ kind: "done" }> {
    const { repo, rails, console: slack } = this.d;
    const [sendable, rejected, unresolved] = await Promise.all([
      this.downloadVerdicts(results.sendable_url, "sendable"),
      this.downloadVerdicts(results.rejected_url, "rejected"),
      this.downloadVerdicts(results.unresolved_url, "unresolved"),
    ]);
    const verdicts = [...sendable, ...rejected, ...unresolved];
    const marker = batchMarker(run.run_id, b.batch);

    const written = await repo.withRun(run.run_id, async (tx) => {
      let n = 0;
      for (let i = 0; i < verdicts.length; i += 500) {
        const chunk = verdicts.slice(i, i + 500);
        const { rowCount } = await tx.query(
          `update ${table} t set
             mv_status = v.mv_status, n2b_status = v.n2b_status, mail_class = v.mail_class,
             verify_path = v.verify_path, ev_status = v.ev_status, verify_run_id = $3, verified_at = now(),
             lead_status = case when v.ev_status = 'sendable' then 'verified'
                                when v.ev_status = 'rejected' then 'rejected'
                                else 'stalled_unverified' end,
             status_changed_at = now()
           from unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])
             as v(email, mv_status, n2b_status, mail_class, verify_path, ev_status)
           where t.run_id = $1 and t.verify_batch = $2 and t.lead_status = 'verifying' and lower(t.email) = v.email`,
          [
            run.run_id,
            marker,
            b.vendor_run_id,
            chunk.map((v) => v.email),
            chunk.map((v) => v.mv_status),
            chunk.map((v) => v.n2b_status),
            chunk.map((v) => v.mail_class),
            chunk.map((v) => v.verify_path),
            chunk.map((v) => v.ev_status),
          ],
        );
        n += rowCount ?? 0;
      }
      // Domain answers are shared across clients and runs.
      const byDomain = new Map(verdicts.map((v) => [v.domain, v]));
      const doms = [...byDomain.values()];
      for (let i = 0; i < doms.length; i += 500) {
        const chunk = doms.slice(i, i + 500);
        await tx.query(
          `insert into topup.mx_class (domain, mx_host, mail_class, gateway_provider)
           select * from unnest($1::text[], $2::text[], $3::text[], $4::text[])
           on conflict (domain) do update set mx_host = excluded.mx_host, mail_class = excluded.mail_class,
             gateway_provider = excluded.gateway_provider, checked_at = now()`,
          [chunk.map((v) => v.domain), chunk.map((v) => v.mx_host), chunk.map((v) => v.mail_class), chunk.map((v) => v.gateway_provider)],
        );
      }
      return n;
    });

    // Rows the verifier never mentioned are not "passed"; they stay unverified.
    let strays = 0;
    if (!partial) {
      strays = await repo.withRun(run.run_id, async (tx) => {
        const { rowCount } = await tx.query(
          `update ${table} set lead_status = 'stalled_unverified', ev_status = 'unresolved', status_changed_at = now()
           where run_id = $1 and verify_batch = $2 and lead_status = 'verifying'`,
          [run.run_id, marker],
        );
        return rowCount ?? 0;
      });
    }

    // Spend: what the vendors say they used, priced by our table; rail 4 drift check.
    const approved = b.approved_cents ?? b.worst_case_cents ?? 0;
    const balanceAfter = await rails.readBalance("millionverifier");
    const mvCents = await rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "verify", vendor: "millionverifier", action: "credits_used", rows: b.rows, credits: obs.mv_credits_used, worstCaseCents: b.worst_case_cents, balanceBefore: null, balanceAfter, vendorJobId: b.vendor_run_id, approvedBy: null });
    const n2bCents = await rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "verify", vendor: "no2bounce", action: "credits_used", rows: b.rows, credits: obs.n2b_credits_used, worstCaseCents: null, balanceBefore: null, balanceAfter: null, vendorJobId: b.vendor_run_id, approvedBy: null });
    if (mvCents + n2bCents > rails.allowanceCents(approved)) {
      await slack.postOps(`:rotating_light: Verify batch ${b.batch} on run \`${run.run_id.slice(0, 8)}\` billed ${usd(mvCents + n2bCents)} against an approval of ${usd(approved)}. Nothing else submits on this run until Josh looks.`);
      await repo.stallEvent({ run_id: run.run_id, vendor_run_id: b.vendor_run_id, event: "abort", rows: b.rows, detail: { reason: "spend drift", billed_cents: mvCents + n2bCents, approved_cents: approved } });
    }

    const seg = sendable.filter((v) => v.mail_class === "seg").length;
    const counts = { sendable: sendable.filter((v) => v.sendable).length, rejected: rejected.length + sendable.filter((v) => !v.sendable).length, unresolved: unresolved.length + strays };
    await this.patchBatch(run.run_id, b.batch, {
      ...(partial ? {} : { status: "completed", finished_at: new Date(this.now()).toISOString() }),
      mv_credits_used: obs.mv_credits_used,
      n2b_credits_used: obs.n2b_credits_used,
      sendable: counts.sendable,
      rejected: counts.rejected,
      unresolved: counts.unresolved,
    });
    await slack.postInThread(
      run,
      `Verify batch ${b.batch}${partial ? " (partial salvage)" : ""}: ${counts.sendable} sendable (SEG ${seg} / OTHER ${counts.sendable - seg}), ` +
        `${counts.rejected} rejected, ${counts.unresolved} unverified · ${written} rows written · MV ${obs.mv_credits_used} credits, N2B ${obs.n2b_credits_used} credits (${usd(mvCents + n2bCents)}).`,
    );
    if (mvCents + n2bCents > rails.allowanceCents(approved)) {
      throw new Error(`spend drift on batch ${b.batch}: billed ${usd(mvCents + n2bCents)} vs approved ${usd(approved)}`);
    }
    return { kind: "done" };
  }

  private async finish(run: RunRow, table: string): Promise<VerifyOutcome> {
    const { rows } = await this.d.repo.raw().query<{ lead_status: string; mail_class: string | null; n: string }>(
      `select lead_status, mail_class, count(*)::text as n from ${table} where run_id = $1 group by 1, 2`,
      [run.run_id],
    );
    let sendable = 0;
    let seg = 0;
    let rejected = 0;
    let stalled = 0;
    for (const r of rows) {
      const n = Number(r.n);
      if (r.lead_status === "verified") {
        sendable += n;
        if (r.mail_class === "seg") seg += n;
      } else if (r.lead_status === "rejected") rejected += n;
      else if (r.lead_status === "stalled_unverified") stalled += n;
    }
    const counts = { verified: sendable, verified_seg: seg, verified_other: sendable - seg, rejected, stalled_unverified: stalled };
    await this.d.repo.finishStep(run.run_id, "verify", { useful_output: sendable, counts });
    await this.d.repo.mergeRunCounts(run.run_id, counts);
    const gate = sendableGate({ sendable, rejected, stalled });
    if (gate) return gate;
    await this.d.console.postInThread(run, `:white_check_mark: Verify done: *${sendable}* sendable (SEG ${seg} / OTHER ${sendable - seg}), ${rejected} rejected, ${stalled} left unverified.`);
    return { kind: "done", sendable, seg, other: sendable - seg, rejected, stalled };
  }

  private async park(run: RunRow, reason: string, attempts: number): Promise<VerifyOutcome> {
    await this.d.repo.setRunStatus(run.run_id, "awaiting_operator", "verify", reason);
    await this.d.console.ask({
      run,
      kind: "parked",
      audience: "operator",
      payload: { step: "verify", reason },
      text: `Run parked at verify: ${reason}`,
      blocks: (cardId) => parkedCard({ cardId, runId: run.run_id, clientTag: run.client_tag, step: "verify", attempts, error: reason }),
    });
    return { kind: "parked", reason };
  }
}
