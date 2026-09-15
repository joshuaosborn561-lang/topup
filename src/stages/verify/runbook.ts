import type { VerifierResults, VerifierStatus } from "../../clients/verifier.js";

/**
 * The MillionVerifier stall runbook (design 3.3 E) as a pure decision
 * function. It used to be a paragraph pasted into a chat; now it is code with
 * tests. The stage applies the action; this module never calls anything.
 *
 *   1. At or above STALL_PERCENT with no progress for STALL_MINUTES -> resume once (free).
 *   2. No progress after the resume -> split the remainder in two. A split can
 *      bill, so the stage runs it through the spend rails.
 *   3. Repeat down to MIN_SPLIT_ROWS. Residue -> stalled_unverified, never sent.
 *   4. A completion with zero MV verdicts but rows marked rejected is a stall,
 *      not a verdict (a resume once merged 2,301 rows into REJECTED for zero credits).
 */

export interface RunbookConfig {
  stallPercent: number;
  stallMinutes: number;
  minSplitRows: number;
  /** Hard ceiling: no progress at any percent for this many minutes is also a stall. */
  deadMinutes: number;
}

export interface BatchState {
  batch: string;
  rows: number;
  vendorRunId: string | null;
  submittedAt: number;
  lastProgressAt: number;
  lastPercent: number;
  lastVerified: number;
  resumesUsed: number;
}

export type RunbookAction =
  | { kind: "wait"; reason: string }
  | { kind: "resume"; reason: string }
  | { kind: "split"; reason: string }
  | { kind: "salvage_then_split"; reason: string }
  | { kind: "residue"; reason: string }
  | { kind: "complete"; reason: string }
  | { kind: "zero_result"; reason: string };

export function mvAssessed(s: Pick<VerifierStatus, "mv_ok_count" | "mv_catch_all_count" | "mv_unknown_count" | "mv_invalid_count">): number {
  return s.mv_ok_count + s.mv_catch_all_count + s.mv_unknown_count + s.mv_invalid_count;
}

/** Fold a status observation into batch progress bookkeeping. Returns the updated state. */
export function observe(state: BatchState, obs: VerifierStatus, now: number): BatchState {
  const p = obs.progress;
  if (!p) return state;
  const moved = p.percent > state.lastPercent || p.verified > state.lastVerified;
  return moved
    ? { ...state, lastPercent: Math.max(p.percent, state.lastPercent), lastVerified: Math.max(p.verified, state.lastVerified), lastProgressAt: now }
    : state;
}

export function decide(state: BatchState, obs: VerifierStatus, results: VerifierResults | null, now: number, cfg: RunbookConfig): RunbookAction {
  const splitOrResidue = (reason: string): RunbookAction =>
    state.rows <= cfg.minSplitRows
      ? { kind: "residue", reason: `${reason}; ${state.rows} rows is at the ${cfg.minSplitRows}-row floor` }
      : { kind: "split", reason };

  if (obs.status === "completed") {
    if (mvAssessed(obs) === 0 && obs.final_rejected_count > 0) {
      return { kind: "zero_result", reason: "completed with zero MillionVerifier verdicts but rows marked rejected — a stall merged into REJECTED, not a verdict" };
    }
    if (mvAssessed(obs) === 0 && obs.final_sendable_count === 0) {
      return { kind: "zero_result", reason: "completed with zero verdicts and zero sendable — nothing was verified" };
    }
    return { kind: "complete", reason: `completed with ${obs.useful_output_count} sendable` };
  }

  if (obs.status === "failed" || obs.status === "paused") {
    const sd = results?.salvage_decision ?? null;
    const canResume = state.resumesUsed < 2 && !sd?.do_not_resume;
    switch (sd?.action) {
      case "done":
        return { kind: "complete", reason: sd.reason };
      case "resume":
        return canResume ? { kind: "resume", reason: sd.reason } : splitOrResidue(`server says resume but ${state.resumesUsed} resumes already burned`);
      case "salvage":
        return { kind: "salvage_then_split", reason: sd.reason };
      case "fresh_ok":
        if (state.resumesUsed === 0 && canResume) return { kind: "resume", reason: `first failure with no verdicts; one free resume before splitting (${sd.reason})` };
        return splitOrResidue(`no verdicts after ${state.resumesUsed} resume(s): ${sd.reason}`);
      default:
        return canResume && state.resumesUsed === 0 ? { kind: "resume", reason: `run ${obs.status}: ${obs.last_error ?? "no detail"}` } : splitOrResidue(`run ${obs.status} after resume`);
    }
  }

  // Still running.
  const sinceProgress = (now - state.lastProgressAt) / 60000;
  const stalledHigh = state.lastPercent >= cfg.stallPercent && sinceProgress >= cfg.stallMinutes;
  const dead = sinceProgress >= cfg.deadMinutes;
  if (!stalledHigh && !dead) {
    return { kind: "wait", reason: `${obs.status} · ${state.lastPercent}% · ${sinceProgress.toFixed(0)}m since progress` };
  }
  const why = stalledHigh
    ? `at ${state.lastPercent}% with no progress for ${sinceProgress.toFixed(0)}m`
    : `no progress at any percent for ${sinceProgress.toFixed(0)}m`;
  if (state.resumesUsed === 0) return { kind: "resume", reason: `${why}; free resume` };
  return splitOrResidue(`${why} after ${state.resumesUsed} resume(s)`);
}

/** Two child batch names for a split. */
export function splitNames(batch: string): [string, string] {
  return [`${batch}.1`, `${batch}.2`];
}
