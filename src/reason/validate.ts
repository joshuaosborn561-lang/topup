import { BANNED_ACTIONS, BANNED_VENDORS, isBannedAction, isBannedVendor, worstCaseCents } from "../spend/prices.js";
import { collidingExclusion, laneBlocked, personaBlocked, type Exclusion } from "./exclusions.js";
import { parseProposal, type Proposal } from "./proposal.js";

export type CountCall = { id: string; kind: string; filters: Record<string, unknown>; total: number };

export type ValidationOk = { ok: true; proposal: Proposal; worst_case_usd: number; split: boolean };
export type ValidationFail = { ok: false; message: string; exclusion_id?: string };
export type Validation = ValidationOk | ValidationFail;

const AUTO_CAP_USD = 5;

function bannedIn(value: unknown): string | null {
  const blob = JSON.stringify(value).toLowerCase();
  for (const v of BANNED_VENDORS) {
    if (blob.includes(v)) return v;
  }
  for (const a of BANNED_ACTIONS) {
    if (blob.includes(a)) return a;
  }
  if (isBannedVendor(blob) || isBannedAction(blob)) return "banned";
  return null;
}

function recomputeWorstUsd(p: Proposal): number {
  const by = p.cost.by_step;
  let cents = 0;
  for (const [step, usd] of Object.entries(by)) {
    const n = Number(usd);
    if (!Number.isFinite(n) || n < 0) continue;
    const vendor = step.includes(":") ? step.split(":")[0]! : step;
    try {
      cents += worstCaseCents(vendor, "export", Math.max(1, p.counts.pool));
    } catch {
      cents += Math.round(n * 100);
    }
  }
  if (cents === 0) cents = Math.round(p.cost.worst_case_usd * 100);
  return cents / 100;
}

/**
 * Code validates the reasoner's JSON before a card renders (D39).
 * Rejects integer bands, exclusion collisions, unknown enums (via parse),
 * banned vendors, invented pool numbers, and a missing pilot flag.
 */
export function validateProposal(
  input: unknown,
  opts: {
    clientTag: string;
    lane: string;
    exclusions: readonly Exclusion[];
    countCalls: readonly CountCall[];
    persona?: string;
  },
): Validation {
  const parsed = parseProposal(input);
  if (!parsed.ok) return { ok: false, message: parsed.message };

  const p = parsed.proposal;
  const expectedLane = `${opts.clientTag}/${opts.lane}`;
  if (p.lane !== expectedLane) {
    return { ok: false, message: `proposal.lane is ${p.lane}; expected ${expectedLane}` };
  }

  const dead = laneBlocked(opts.clientTag, opts.lane, opts.exclusions);
  if (dead) return { ok: false, message: `lane exclusion ${dead.id}: ${dead.reason}`, exclusion_id: dead.id };

  const personaHit = personaBlocked(opts.persona, opts.clientTag, opts.lane, opts.exclusions);
  if (personaHit) return { ok: false, message: `exclusion ${personaHit.id} (${personaHit.kind}=${personaHit.value}): ${personaHit.reason}`, exclusion_id: personaHit.id };

  const hit = collidingExclusion(p.segment, opts.clientTag, opts.lane, opts.exclusions);
  if (hit) return { ok: false, message: `exclusion ${hit.id} (${hit.kind}=${hit.value}): ${hit.reason}`, exclusion_id: hit.id };

  const banned = bannedIn(p);
  if (banned) return { ok: false, message: `banned vendor or action in the plan: ${banned}` };

  if (p.action !== "hold" && p.counts.pool > 0) {
    const recorded = opts.countCalls.find((c) => c.id === p.count_call_id) ?? opts.countCalls.find((c) => c.total === p.counts.pool);
    if (!recorded) {
      return { ok: false, message: "counts.pool has no recorded free count call behind it" };
    }
  }

  const worst = recomputeWorstUsd(p);
  const split = worst > AUTO_CAP_USD;
  const forcedPilot = p.segment.icp_kind === "physical" || p.action === "new_segment";
  const proposal = forcedPilot && !p.pilot_required ? { ...p, pilot_required: true } : p;

  return { ok: true, proposal, worst_case_usd: worst, split };
}
