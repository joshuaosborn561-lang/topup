import type { Role } from "../domain/runs.js";

/**
 * Roles by Slack user id (brief section 10). Josh is owner; Cayden is
 * operator. Operator taps never spend money and never change a recipe.
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

/** Every card choice and the least role that may tap it. Spend and recipe changes are owner-only. */
export const CHOICE_ROLE: Readonly<Record<string, Role>> = {
  // spend_approval
  approve_spend: "owner",
  decline_spend: "owner",
  // not_working
  topup_anyway: "owner",
  leave_it: "owner",
  // stall (resume is free; a split can bill; abort spends nothing)
  resume: "operator",
  split: "owner",
  abort: "operator",
  // qa_hold
  accept: "operator",
  purge: "operator",
  reroute: "operator",
  // segment_proposal (Phase 2)
  approve_segment: "owner",
  decline_segment: "owner",
  // pending_campaign: a new campaign is Josh's; continuing without the pending rows is his call too
  clone_campaign: "owner",
  continue_without: "owner",
  // leftover client_domain_list card (D34). D37 no longer posts it.
  list_added: "operator",
  no_list: "owner",
  // yield card and pilot gate (Phase 3, D21): nothing scales without Josh's second tap
  approve_yield: "owner",
  decline_yield: "owner",
  scale_pilot: "owner",
  stop_pilot: "owner",
  // resume a parked run
  resume_run: "operator",
};

/**
 * Choices that spend, widen, scale or flip (D18: judgement). Each must be
 * owner-only; the guard in src/guards/judgement.test.ts holds this list
 * against CHOICE_ROLE.
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

/** Slash commands and the least role that may run them. */
export const COMMAND_ROLE: Readonly<Record<string, Role>> = {
  "/where": "operator",
  "/topup": "operator",
  "/holds": "operator",
  "/runs": "operator",
  "/working": "owner",
  "/suppress": "operator",
};

export const NEEDS_JOSH = "This needs Josh.";
