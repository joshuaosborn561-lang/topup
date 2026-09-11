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
  /** The gate text from the skill, verbatim. */
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

/**
 * Step 6 gate (skill: "sendable count and reject rate reported. A reject rate
 * far above the lane's norm means the source is bad, stop and say so.").
 *
 * The reject rate is rejected / (sendable + rejected); rows a stall left
 * unverified are not verdicts and stay out of the ratio. "Far above" is not a
 * number in the skill, so it is one here and named (D25): at least twice the
 * lane's norm AND at least ten points over it, on at least fifty verdicts.
 * With no norm on the recipe only the unarguable case fires: nothing sendable.
 */
export const REJECT_RATE_FAR_ABOVE_FACTOR = 2;
export const REJECT_RATE_FAR_ABOVE_MIN_GAP = 0.1;
export const REJECT_RATE_MIN_VERDICTS = 50;

export interface VerifyCounts {
  sendable: number;
  rejected: number;
  stalled: number;
}

export function rejectRate(c: VerifyCounts): number | null {
  const verdicts = c.sendable + c.rejected;
  return verdicts === 0 ? null : c.rejected / verdicts;
}

export function pct(x: number | null): string {
  return x === null ? "n/a" : `${(x * 100).toFixed(1)}%`;
}

export function rejectRateGate(c: VerifyCounts, norm: number | null): GateUnmet | null {
  const seen = c.sendable + c.rejected + c.stalled;
  if (seen === 0) return null;
  const rate = rejectRate(c);
  const counts = { sendable: c.sendable, rejected: c.rejected, stalled: c.stalled, reject_rate_bp: rate === null ? 0 : Math.round(rate * 10000) };
  if (c.sendable === 0) {
    return gateUnmet("verify", `0 sendable of ${seen} verified (${c.rejected} rejected, ${c.stalled} left unverified); reject rate ${pct(rate)}`, counts);
  }
  if (norm === null || rate === null || c.sendable + c.rejected < REJECT_RATE_MIN_VERDICTS) return null;
  const threshold = Math.max(norm * REJECT_RATE_FAR_ABOVE_FACTOR, norm + REJECT_RATE_FAR_ABOVE_MIN_GAP);
  if (rate < threshold) return null;
  return gateUnmet(
    "verify",
    `reject rate ${pct(rate)} is far above the lane's norm ${pct(norm)} (stop line ${pct(threshold)}): ${c.rejected} rejected, ${c.sendable} sendable, ${c.stalled} left unverified. The source is bad.`,
    { ...counts, norm_bp: Math.round(norm * 10000), stop_line_bp: Math.round(threshold * 10000) },
  );
}

/**
 * Step 7 gate (skill: "every merge field the copy uses is populated or the
 * row is held."). The fields the copy uses are the recipe's `required_fields`.
 * `local_sports_team` is never a hold on its own: the skill routes a row with
 * no team to the AirPods tier, whose copy does not use the team. A row with
 * any other required field empty is held (`qa_hold`) for step 8, and the run
 * goes on; the gate reports how many were held and why, never the rows.
 */
export const NEVER_HOLD_FIELDS: readonly string[] = ["local_sports_team"];

/** Columns the hold may test. Anything else in required_fields is a recipe bug, not SQL. */
export const HOLDABLE_FIELDS: readonly string[] = ["first_name_n", "company_n", "location", "job_title", "company_size", "vertical", "first_name", "last_name", "email", "company_name"];

export function mergeFieldsToHold(required: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of required) {
    if (NEVER_HOLD_FIELDS.includes(f)) continue;
    if (!HOLDABLE_FIELDS.includes(f)) throw new Error(`required field ${f} is not a column the step 7 hold can test`);
    if (!out.includes(f)) out.push(f);
  }
  return out;
}

/** Pure form of the hold test, for one row in memory. Returns the empty fields. */
export function emptyMergeFields(row: Record<string, unknown>, fields: readonly string[]): string[] {
  return fields.filter((f) => {
    const v = row[f];
    return v === null || v === undefined || String(v).trim() === "";
  });
}
