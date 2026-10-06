/**
 * What a resolved card should do to the run.
 * `resume` on a parked or gate card re-runs that step and gives it its attempts back.
 * `resume` on a stall card is the verifier path: drive only, do not reset size attempts, do not jump to trigger.
 */
export type ResumeEffect = "reset_parked" | "continue" | "topup_anyway";

export function resumeEffect(choice: string, cardKind: string): ResumeEffect | null {
  if (choice === "resume_run") return "reset_parked";
  if (choice === "resume") return cardKind === "stall" ? "continue" : "reset_parked";
  if (choice === "approve_spend" || choice === "approve_small_spend" || choice === "split" || choice === "decline_spend") return "continue";
  if (choice === "topup_anyway") return "topup_anyway";
  return null;
}
