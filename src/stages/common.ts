import type { Repo } from "../db/repo.js";
import { funnelCounts, MAX_STEP_ATTEMPTS, runIsOpen, type Role, type RunRow, type RunStatus, type Step } from "../domain/runs.js";
import { withRulesHash } from "../jobs/rules.js";
import { logger } from "../lib/log.js";
import { parkedCard } from "../console/cards.js";
import type { Console } from "../console/console.js";
import { campaignReportFromCounts, formatCampaignReport, type CampaignReportEntry } from "./report.js";
import type { GateUnmet } from "../spine/gate.js";

const log = logger("stage");

/**
 * What one internal stage (one `run_steps.step`) can come back with. The
 * orchestrator only ever looks at `kind`.
 *
 *   done      the stage finished; counts are what its gate reported
 *   nothing   the stage had no rows to work on (a legal `done`)
 *   waiting   a card is open and the run halts until a human taps it; the
 *             step is marked waiting_approval so re-entry is not an attempt
 *   parked    three failures, or a refusal; one parked card is open
 *   declined  Josh declined the spend; the run closed as declined
 *   retry     one failure; the orchestrator waits and re-enters
 *   gate      the step's spine gate failed (D24); the orchestrator halts the run
 */
export type StageOutcome =
  | { kind: "done"; counts: Record<string, number> }
  | { kind: "nothing" }
  | { kind: "waiting"; on: Role; why: string; worstCaseCents?: number }
  | { kind: "parked"; reason: string }
  | { kind: "declined" }
  | { kind: "retry"; error: string }
  | { kind: "stopped" }
  | GateUnmet;

export interface StageDeps {
  repo: Repo;
  console: Console;
}

export interface Clock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/**
 * The attempt discipline every stage shares (design 3.2): begin the step
 * (bumps attempts unless it was only waiting on a card), set the run status,
 * run the body; a thrown error is one failed attempt, the third parks the run
 * with one card to Cayden. Gate failures and card waits are returned, not thrown.
 */
async function runStopReason(repo: Repo, runId: string): Promise<"aborted" | "closed" | null> {
  const fresh = await repo.getRun(runId);
  if (!fresh) return "aborted";
  if (fresh.status === "aborted") return "aborted";
  if (!runIsOpen(fresh.status)) return "closed";
  return null;
}

function isAbortError(err: unknown): boolean {
  return (err as Error).message === "aborted";
}

/** Leave the step cancelled and do not park, retry, or rewrite the run status. */
async function stopAborted(repo: Repo, runId: string): Promise<StageOutcome> {
  await repo.cancelRunningSteps(runId, "aborted");
  return { kind: "stopped" };
}

/** A job already failed (timeout, last_error written) must not be rewritten to done (D62). */
async function haltIfStopped(repo: Repo, runId: string): Promise<StageOutcome | null> {
  const why = await runStopReason(repo, runId);
  if (why === "aborted") return stopAborted(repo, runId);
  if (why === "closed") {
    const fresh = await repo.getRun(runId);
    await repo.cancelRunningSteps(runId, fresh?.last_error ?? "job already closed");
    return { kind: "stopped" };
  }
  return null;
}

export async function attempt(d: StageDeps, run: RunRow, stage: Step, status: RunStatus, body: (attempts: number) => Promise<StageOutcome>): Promise<StageOutcome> {
  const stopped = await haltIfStopped(d.repo, run.run_id);
  if (stopped) return stopped;
  const step = await d.repo.beginStep(run.run_id, stage);
  const afterBegin = await haltIfStopped(d.repo, run.run_id);
  if (afterBegin) return afterBegin;
  if (!step.ok) return park(d, run, stage, `${stage} exhausted its ${MAX_STEP_ATTEMPTS} attempts`, step.attempts - 1);
  await d.repo.setRunStatus(run.run_id, status, stage);
  const afterStatus = await haltIfStopped(d.repo, run.run_id);
  if (afterStatus) return afterStatus;
  try {
    const out = await body(step.attempts);
    const afterBody = await haltIfStopped(d.repo, run.run_id);
    if (afterBody) return afterBody;
    if (out.kind === "waiting") {
      await d.repo.setStepWaiting(run.run_id, stage, out.worstCaseCents ?? 0);
      await d.repo.setRunStatus(run.run_id, out.on === "owner" ? "awaiting_josh" : "awaiting_operator", stage);
    }
    return out;
  } catch (err) {
    const afterErr = await haltIfStopped(d.repo, run.run_id);
    if (afterErr || isAbortError(err)) return afterErr ?? stopAborted(d.repo, run.run_id);
    const message = (err as Error).message;
    const parked = step.attempts >= MAX_STEP_ATTEMPTS;
    await d.repo.failStep(run.run_id, stage, message, parked);
    log.error("stage failed", { run_id: run.run_id, stage, attempt: step.attempts, parked, error: message });
    if (parked) return park(d, run, stage, message, step.attempts);
    return { kind: "retry", error: message };
  }
}

/** Park the run at a stage with one card to Cayden. A parked run never retries on its own. */
export async function park(d: StageDeps, run: RunRow, stage: Step, reason: string, attempts: number): Promise<StageOutcome> {
  await d.repo.setRunStatus(run.run_id, "awaiting_operator", stage, reason);
  const [sizeStep, pullStep] = await Promise.all([d.repo.getStep(run.run_id, "size"), d.repo.getStep(run.run_id, "pull")]);
  const report = formatCampaignReport(
    campaignReportFromCounts((pullStep?.counts ?? sizeStep?.counts) as unknown as Record<string, unknown>),
  );
  const open = (await d.repo.openCardsForRun(run.run_id)).some((c) => c.kind === "parked" && c.payload.step === stage);
  if (!open) {
    await d.console.ask({
      run,
      kind: "parked",
      audience: "operator",
      payload: { step: stage, reason, campaign_report: campaignReportFromCounts((pullStep?.counts ?? sizeStep?.counts) as unknown as Record<string, unknown>) },
      text: `Run parked at ${stage}: ${reason}`,
      blocks: (cardId) => parkedCard({ cardId, runId: run.run_id, clientTag: run.client_tag, step: stage, attempts, error: reason, report: report || undefined }),
    });
  }
  return { kind: "parked", reason };
}

/** Finish a step: all counts on run_steps, the funnel numbers on the run, one counts-only line in the thread. */
export async function finish(
  d: StageDeps,
  run: RunRow,
  stage: Step,
  useful: number,
  counts: Record<string, number>,
  line: string,
  report?: readonly CampaignReportEntry[],
  actualCents?: number,
): Promise<StageOutcome> {
  const stored: Record<string, unknown> = withRulesHash(stage, { ...counts });
  if (report && report.length) stored.campaign_report = report;
  await d.repo.finishStep(run.run_id, stage, {
    useful_output: useful,
    counts: stored,
    ...(actualCents != null && Number.isFinite(actualCents) ? { actual_cents: Math.max(0, Math.round(actualCents)) } : {}),
  });
  await d.repo.mergeRunCounts(run.run_id, funnelCounts(counts));
  const reportLine = report && report.length ? `\n${formatCampaignReport(report)}` : "";
  await d.console.postInThread(run, `${line}${reportLine}`.slice(0, 3500));
  return { kind: "done", counts };
}

export type PollVerdict<T> = { state: "running" } | { state: "done"; value: T } | { state: "failed"; error: string };

/**
 * Poll a vendor job until it is done, failed, or has been running longer than
 * `deadMs` (then it is an error and the attempt fails: a job nobody can cancel
 * is not a job to wait on forever — docs/servers.md, "no cancel" on every server).
 */
export async function poll<T>(
  check: () => Promise<PollVerdict<T>>,
  opts: { pollMs: number; deadMs: number; clock: Clock; what: string; stop?: () => boolean | Promise<boolean> },
): Promise<T> {
  const started = opts.clock.now();
  for (;;) {
    if (await opts.stop?.()) throw new Error("aborted");
    const v = await check();
    if (v.state === "done") return v.value;
    if (v.state === "failed") throw new Error(`${opts.what} failed: ${v.error}`);
    if (opts.clock.now() - started > opts.deadMs) throw new Error(`${opts.what} still running after ${Math.round(opts.deadMs / 60000)} min; giving up on this attempt`);
    await opts.clock.sleep(opts.pollMs);
  }
}

/** Count rows of one run by lead_status. */
export async function statusCounts(repo: Repo, table: string, runId: string): Promise<Record<string, number>> {
  const { rows } = await repo.raw().query<{ lead_status: string; n: string }>(`select lead_status, count(*)::text as n from ${table} where run_id = $1 group by 1`, [runId]);
  return Object.fromEntries(rows.map((r) => [r.lead_status, Number(r.n)]));
}

/** Columns a table actually has; the LeadPipe tables differ by client and the fakes differ from production. */
export async function columnsOf(repo: Repo, table: string): Promise<Set<string>> {
  const [schema, name] = table.replace(/"/g, "").split(".");
  const { rows } = await repo.raw().query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, name]);
  return new Set(rows.map((r) => r.column_name));
}

/** The phone columns the service keeps on every lane table (D56), and the ones the waterfalls write back. */
export const PHONE_COLUMN = "phone";
export const PHONE_TYPE_COLUMN = "phone_type";

/**
 * D56: a phone found by any step is kept. Copy the waterfalls' writeback
 * (wf_phone / wf_phone_type) onto phone / phone_type for every row of the
 * run that has no phone yet. Returns how many rows gained a phone.
 */
export async function keepPhones(repo: Repo, table: string, runId: string, cols?: Set<string>): Promise<number> {
  const have = cols ?? (await columnsOf(repo, table));
  if (!have.has(PHONE_COLUMN) || !have.has("wf_phone")) return 0;
  const typeSet = have.has(PHONE_TYPE_COLUMN) && have.has("wf_phone_type") ? `, ${PHONE_TYPE_COLUMN} = coalesce(nullif(${PHONE_TYPE_COLUMN}, ''), nullif(wf_phone_type, ''))` : "";
  const { rowCount } = await repo.withRun(runId, (tx) =>
    tx.query(
      `update ${table} set ${PHONE_COLUMN} = nullif(wf_phone, '')${typeSet}
       where run_id = $1 and coalesce(${PHONE_COLUMN}, '') = '' and coalesce(wf_phone, '') <> ''`,
      [runId],
    ),
  );
  return rowCount ?? 0;
}

/** Rows of a run that carry a phone. Zero when the table has no phone column. */
export async function phoneCount(repo: Repo, table: string, runId: string, cols?: Set<string>): Promise<number> {
  const have = cols ?? (await columnsOf(repo, table));
  if (!have.has(PHONE_COLUMN)) return 0;
  const { rows } = await repo.raw().query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and coalesce(${PHONE_COLUMN}, '') <> ''`, [runId]);
  return Number(rows[0]?.n ?? 0);
}
