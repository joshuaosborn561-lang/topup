import type { Role } from "../domain/runs.js";

/**
 * Roles by Slack user id (brief section 10). Josh is owner; Cayden is
 * operator. D47: the service never waits on Josh except for a spend gate
 * whose worst case is above $50. Every other card is Cayden's (Josh may
 * still tap anything).
 */
export class Roles {
  constructor(
    private readonly owners: readonly string[],
    private readonly operators: readonly string[],
  ) {}

  roleOf(userId: string | undefined): Role | null {
    if (!userId) return null;
    if (this.owners.includes(userId)) return "owner";
    if (this.operators.includes(userId)) return "operator";
    return null;
  }

  /** May this role take this action? Owner may do everything an operator may. */
  static allows(role: Role | null, required: Role): boolean {
    if (!role) return false;
    if (required === "operator") return true;
    return role === "owner";
  }
}

/** D47: worst case strictly above this many cents is the only thing that waits on Josh. */
export const OWNER_SPEND_FLOOR_CENTS = 5000;

/** Who a spend card is for: Josh above the floor, Cayden at or under it. */
export function spendAudience(worstCaseCents: number): Role {
  return worstCaseCents > OWNER_SPEND_FLOOR_CENTS ? "owner" : "operator";
}

/** Choices whose required role depends on the card's worst case (approving or re-billing). Declining never spends. */
export const SPEND_CHOICES: readonly string[] = ["approve_spend", "split"];

/**
 * Every card choice and its baseline role. D47: all operator; the two spend
 * choices rise to owner by amount in `requiredRole`.
 */
export const CHOICE_ROLE: Readonly<Record<string, Role>> = {
  // spend_approval
  approve_spend: "operator",
  decline_spend: "operator",
  // not_working
  topup_anyway: "operator",
  leave_it: "operator",
  // stall (resume is free; a split can bill; abort spends nothing)
  resume: "operator",
  split: "operator",
  abort: "operator",
  // qa_hold
  accept: "operator",
  purge: "operator",
  reroute: "operator",
  // segment_proposal (Phase 2)
  approve_segment: "operator",
  decline_segment: "operator",
  // pending_campaign: a new campaign is still a recipe change; whether the routed rows go on is Cayden's
  clone_campaign: "operator",
  continue_without: "operator",
  // leftover client_domain_list card (D34). D37 no longer posts it.
  list_added: "operator",
  no_list: "operator",
  // yield card and pilot gate (Phase 3, D21): the second tap is Cayden's unless the pilot spend is above $50
  approve_yield: "operator",
  decline_yield: "operator",
  scale_pilot: "operator",
  stop_pilot: "operator",
  // resume a parked run
  resume_run: "operator",
};

/**
 * The least role that may tap `choice` on a card with this payload. Unknown
 * choice → undefined. Spend choices read `worst_case_cents` off the card;
 * a spend card with no amount is treated as above the floor (never guess down).
 */
export function requiredRole(choice: string, payload: Record<string, unknown> | undefined): Role | undefined {
  const base = CHOICE_ROLE[choice];
  if (!base) return undefined;
  if (!SPEND_CHOICES.includes(choice)) return base;
  const raw = payload?.worst_case_cents;
  const cents = typeof raw === "number" && Number.isFinite(raw) ? raw : Number(raw);
  if (!Number.isFinite(cents)) return "owner";
  return spendAudience(cents);
}

/**
 * Choices that spend, widen, scale or flip (D18: judgement). Each is a human
 * tap, never code; D47 moves the tap to Cayden except spend above $50. The
 * guard in src/guards/judgement.test.ts holds this list against CHOICE_ROLE
 * and requiredRole.
 */
export const JUDGEMENT_CHOICES: readonly string[] = [
  "approve_spend",
  "decline_spend",
  "topup_anyway",
  "leave_it",
  "split",
  "approve_segment",
  "decline_segment",
  "clone_campaign",
  "continue_without",
  "no_list",
  "approve_yield",
  "decline_yield",
  "scale_pilot",
  "stop_pilot",
];

/** Slash commands and the least role that may run them. D47: Cayden can undo a "leave it" with /working. */
export const COMMAND_ROLE: Readonly<Record<string, Role>> = {
  "/where": "operator",
  "/topup": "operator",
  "/holds": "operator",
  "/runs": "operator",
  "/working": "operator",
  "/suppress": "operator",
};

export const NEEDS_JOSH = "This needs Josh.";
export const NEEDS_JOSH_SPEND = "Spend above $50 needs Josh.";
