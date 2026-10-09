/**
 * The numbers the canon fixes (D46, D53). Every number a top-up depends on
 * lives here and nowhere else. Changing a value here is a new decision:
 * append it to DECISIONS.md and fold it into CANON.md. Ask Josh.
 */

/** Positive replies per 2,000 sends a campaign needs before it is topped up. */
export const REPLY_BAR_PER_2000 = 1;

/** Leads a campaign must still have available before a top-up is worth running. Under this "the TAM for this campaign is exhausted". */
export const MIN_NET_NEW = 1000;

/** A job pulls between one and this many rows. */
export const MAX_ROWS_PER_JOB = 2000;

/** Spend: nothing paid runs before a named approval (D51). The caps are a backstop, not a permission. */
export const OPERATOR_SPEND_CAP_USD = 0;
export const DAILY_VENDOR_CAP_USD = 25;

/** Campaigns that are never topped up. 4085158 is SG Gabe Calls. 3122546 is SG Nurture. SG Cayden Calls is matched by name. */
export const NEVER_TOPUP_CAMPAIGN_IDS: readonly number[] = [4085158, 3122546];
export const NEVER_TOPUP_NAME_PATTERNS: readonly RegExp[] = [/cayden calls/i, /gabe calls/i, /sg nurture/i];

/** Smartlead statuses. Only ACTIVE is a target. */
export const ACTIVE_CAMPAIGN_STATUS = "ACTIVE";
export const NON_TARGET_CAMPAIGN_STATUSES: readonly string[] = ["COMPLETED", "DRAFTED", "DRAFT", "PAUSED", "ARCHIVED"];

/** One place to ask. Every refusal names it. */
export const ASK = "Ask Josh.";

export function isNeverTopUp(id: number, name?: string | null): boolean {
  if (NEVER_TOPUP_CAMPAIGN_IDS.includes(id)) return true;
  const label = name?.trim() ?? "";
  return label.length > 0 && NEVER_TOPUP_NAME_PATTERNS.some((re) => re.test(label));
}

/** ACTIVE, or a blank status the mirror did not classify. */
export function isActiveStatus(status: string | null | undefined): boolean {
  if (status == null) return true;
  const name = status.trim().toUpperCase();
  if (!name) return true;
  return name === ACTIVE_CAMPAIGN_STATUS;
}

export function ratePer2000(sends: number, positives: number): number {
  return sends === 0 ? 0 : (positives / sends) * 2000;
}
