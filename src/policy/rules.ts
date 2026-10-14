/**
 * The numbers the canon fixes (D46, D53). Every number a top-up depends on
 * lives here and nowhere else. Changing a value here is a new decision:
 * append it to DECISIONS.md and fold it into CANON.md. Ask Josh.
 */

/** Positive replies per 2,000 sends a campaign needs before it is topped up. */
export const REPLY_BAR_PER_2000 = 1;

/** Leads a campaign must still have available before a top-up is worth running. Under this "the TAM for this campaign is exhausted". */
export const MIN_NET_NEW = 1000;

/** Spend: nothing paid runs before a named approval (D51). No daily cap: the approved amount is the limit (D104). */
export const OPERATOR_SPEND_CAP_USD = 0;

/** Campaigns that are never topped up. 4085158 is SG Gabe Calls. 3122546 is SG Nurture. SG Cayden Calls is matched by name. */
export const NEVER_TOPUP_CAMPAIGN_IDS: readonly number[] = [4085158, 3122546];
export const NEVER_TOPUP_NAME_PATTERNS: readonly RegExp[] = [/cayden calls/i, /gabe calls/i, /sg nurture/i];

/** Smartlead statuses. ACTIVE and PAUSED may be refilled; STOPPED never is (D105). */
export const ACTIVE_CAMPAIGN_STATUS = "ACTIVE";
export const PAUSED_CAMPAIGN_STATUS = "PAUSED";
export const STOPPED_CAMPAIGN_STATUS = "STOPPED";

/** Campaigns marked as cold call are not email campaigns; the service ignores them everywhere (D54). The mark is in the name. */
export const COLD_CALL_NAME_PATTERNS: readonly RegExp[] = [/cold[ _-]?call/i, /\bcalls?\b/i, /post[ _-]?call/i, /\bcalling\b/i, /\bdialer\b/i];

export function isColdCall(name: string | null | undefined): boolean {
  const label = name?.trim() ?? "";
  return label.length > 0 && COLD_CALL_NAME_PATTERNS.some((re) => re.test(label));
}

/** One place to ask. Every refusal names it. Cayden is a full approver (D92). */
export const ASK = "Ask Josh or Cayden.";

/** Named owners who may approve spend and confirm backfilled filters (D92). */
export const OWNER_APPROVER_NAMES = ["josh", "cayden"] as const;

export function isOwnerApprover(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return (OWNER_APPROVER_NAMES as readonly string[]).includes(n);
}

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

/** A campaign Smartlead has stopped. Never refilled, never counted in lane runway (D105). */
export function isStoppedStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toUpperCase() === STOPPED_CAMPAIGN_STATUS;
}

/** ACTIVE, PAUSED, or a blank status. STOPPED is never refillable (D105). */
export function isRefillableStatus(status: string | null | undefined): boolean {
  return !isStoppedStatus(status);
}

export function ratePer2000(sends: number, positives: number): number {
  return sends === 0 ? 0 : (positives / sends) * 2000;
}
