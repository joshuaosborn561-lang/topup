import type { Role } from "../domain/runs.js";

/** Owner may do everything an operator may. Spend is owner-only (D18). */
export function allows(role: Role | null, required: Role): boolean {
  if (!role) return false;
  if (required === "operator") return true;
  return role === "owner";
}

/** Every card choice and the least role that may take it. Spend is owner-only. */
export const CHOICE_ROLE: Readonly<Record<string, Role>> = {
  // spend_approval: a named owner approves before any paid call (D51)
  approve_spend: "owner",
  decline_spend: "owner",
  // qa_hold
  accept: "operator",
  purge: "operator",
  reroute: "operator",
  // stall (resume is free; a split can bill; abort spends nothing)
  resume: "operator",
  split: "owner",
  // parked run
  resume_run: "operator",
  abort: "operator",
};

/** Choices that spend (D18: judgement). Each is owner-only; the guard holds this list against CHOICE_ROLE. */
export const JUDGEMENT_CHOICES: readonly string[] = ["approve_spend", "decline_spend", "split"];

export const NEEDS_JOSH = "This needs Josh.";
