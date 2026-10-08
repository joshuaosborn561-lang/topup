import { DAILY_VENDOR_CAP_USD, OPERATOR_SPEND_CAP_USD } from "./rules.js";

/**
 * Who approves a paid call (D9, D45, D46). Free is nobody. Under the operator
 * cap is Cayden. The cap or above is Josh, always. The daily backstop blocks.
 * The spend ledger and price table stay in src/spend; this is the rule.
 */
export const OPERATOR_SPEND_CAP_CENTS = OPERATOR_SPEND_CAP_USD * 100;
export const DAILY_VENDOR_CAP_CENTS = DAILY_VENDOR_CAP_USD * 100;

export type SpendAudience = "proceed" | "operator" | "owner";

/** Over the daily cap is not a refusal: it is Josh's call (brief §2). Banned vendors are refused by the rails, not here. */
export function spendAudience(worstCaseCents: number, spentTodayCents = 0, dailyCapCents = DAILY_VENDOR_CAP_CENTS, operatorCapCents = OPERATOR_SPEND_CAP_CENTS): SpendAudience {
  const worst = Math.max(0, Math.ceil(worstCaseCents));
  if (worst === 0) return "proceed";
  if (spentTodayCents + worst > dailyCapCents) return "owner";
  if (worst < operatorCapCents) return "operator";
  return "owner";
}

/** A load reaches Smartlead only when loads are not paused and Josh approved the briefing. */
export function loadAllowed(input: { loadsPaused: boolean; ownerApproved: boolean }): { ok: boolean; why: string } {
  if (input.loadsPaused) return { ok: false, why: "loads are paused; nothing reaches Smartlead until Cayden lifts loads_paused" };
  if (!input.ownerApproved) return { ok: false, why: "Josh has not approved this load; the approval briefing is the gate" };
  return { ok: true, why: "loads are open and the load is approved" };
}
