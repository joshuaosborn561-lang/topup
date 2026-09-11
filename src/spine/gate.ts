import type { Step } from "../domain/runs.js";
import { gateLabel, stepForStage } from "./steps.js";

/**
 * A gate is the test between two spine steps. When it fails the run halts at
 * the step, the ledger records why, and one card posts. It never retries on
 * its own and silence never means yes (D24).
 */
export interface GateUnmet {
  kind: "gate";
  /** Spine step whose gate failed. */
  step: number;
  /** The gate text from the spine, e.g. "every merge field populated". */
  gate: string;
  /** Why, in one line of counts. Never rows. */
  why: string;
  counts: Record<string, number>;
}

/** Build the outcome a stage returns when its step's gate fails. */
export function gateUnmet(stage: Step, why: string, counts: Record<string, number> = {}): GateUnmet {
  const s = stepForStage(stage);
  if (!s) throw new Error(`stage ${stage} is not placed on a spine step; it cannot fail a gate`);
  return { kind: "gate", step: s.n, gate: gateLabel(s.n), why, counts };
}

/** Step 6, sendable rule: verification that produced nothing sendable is a failed step, not a small list. */
export function sendableGate(counts: { sendable: number; rejected: number; stalled: number }): GateUnmet | null {
  const seen = counts.sendable + counts.rejected + counts.stalled;
  if (seen === 0 || counts.sendable > 0) return null;
  return gateUnmet("verify", `0 sendable of ${seen} verified (${counts.rejected} rejected, ${counts.stalled} left unverified)`, counts);
}

/**
 * Step 7, every merge field populated. The two fields with no fallback in
 * copy are the first name and the company; location and team have defined
 * fallbacks (NO_GEOCODE → blank, no team → AirPods) in the normalizer spec.
 * Whether those fallbacks count as "populated" is a question in the PR.
 */
export const REQUIRED_MERGE_FIELDS = ["first_name_n", "company_n"] as const;

export function mergeFieldsGate(counts: { normalized: number; rows_with_empty: number; empty_by_field: Record<string, number> }): GateUnmet | null {
  const empties = Object.entries(counts.empty_by_field).filter(([, n]) => n > 0);
  if (counts.normalized === 0 || counts.rows_with_empty === 0) return null;
  const detail = empties.map(([f, n]) => `${f} ${n}`).join(", ");
  return gateUnmet("normalize", `${counts.rows_with_empty} of ${counts.normalized} normalized rows have an empty merge field (${detail})`, {
    normalized: counts.normalized,
    rows_with_empty: counts.rows_with_empty,
    ...Object.fromEntries(empties.map(([f, n]) => [`empty_${f}`, n])),
  });
}
