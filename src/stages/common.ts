import type { Repo } from "../db/repo.js";
import { funnelCounts, MAX_STEP_ATTEMPTS, type Role, type RunRow, type RunStatus, type Step } from "../domain/runs.js";
import { logger } from "../lib/log.js";
import { parkedCard } from "../slack/cards.js";
import type { SlackConsole } from "../slack/console.js";
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
  | { kind: "waiting"; on: Role; why: string }
  | { kind: "parked"; reason: string }
  | { kind: "declined" }
  | { kind: "retry"; error: string }
  | GateUnmet;

export interface StageDeps {
  repo: Repo;
  console: SlackConsole;
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
export async function attempt(d: StageDeps, run: RunRow, stage: Step, status: RunStatus, body: (attempts: number) => Promise<StageOutcome>): Promise<StageOutcome> {
  const step = await d.repo.beginStep(run.run_id, stage);
  if (!step.ok) return park(d, run, stage, `${stage} exhausted its ${MAX_STEP_ATTEMPTS} attempts`, step.attempts - 1);
  await d.repo.setRunStatus(run.run_id, status, stage);
  try {
    const out = await body(step.attempts);
    if (out.kind === "waiting") {
      await d.repo.setStepWaiting(run.run_id, stage, 0);
      await d.repo.setRunStatus(run.run_id, out.on === "owner" ? "awaiting_josh" : "awaiting_operator", stage);
    }
    return out;
  } catch (err) {
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
  const open = (await d.repo.openCardsForRun(run.run_id)).some((c) => c.kind === "parked" && c.payload.step === stage);
  if (!open) {
    await d.console.ask({
      run,
      kind: "parked",
      audience: "operator",
      payload: { step: stage, reason },
      text: `Run parked at ${stage}: ${reason}`,
      blocks: (cardId) => parkedCard({ cardId, runId: run.run_id, clientTag: run.client_tag, step: stage, attempts, error: reason }),
    });
  }
  return { kind: "parked", reason };
}

/** Finish a step: all counts on run_steps, the funnel numbers on the run, one counts-only line in the thread. */
export async function finish(d: StageDeps, run: RunRow, stage: Step, useful: number, counts: Record<string, number>, line: string): Promise<StageOutcome> {
  await d.repo.finishStep(run.run_id, stage, { useful_output: useful, counts });
  await d.repo.mergeRunCounts(run.run_id, funnelCounts(counts));
  await d.console.postInThread(run, line);
  return { kind: "done", counts };
}

export type PollVerdict<T> = { state: "running" } | { state: "done"; value: T } | { state: "failed"; error: string };

/**
 * Poll a vendor job until it is done, failed, or has been running longer than
 * `deadMs` (then it is an error and the attempt fails: a job nobody can cancel
 * is not a job to wait on forever — docs/servers.md, "no cancel" on every server).
 */
export async function poll<T>(check: () => Promise<PollVerdict<T>>, opts: { pollMs: number; deadMs: number; clock: Clock; what: string }): Promise<T> {
  const started = opts.clock.now();
  for (;;) {
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
