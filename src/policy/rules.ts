/**
 * The rules of the Oct 8 2026 rewrite brief (section 2), in one place (D46).
 *
 * Every number and list a top-up decision depends on lives here and nowhere
 * else. The queue, the watch, the size step and the start path read these
 * through `evaluateCampaign` in ./campaign.ts, so they cannot disagree.
 * Changing a value here is a new decision: append it to DECISIONS.md and
 * fold it into CANON.md (the meta guard enforces that). Ask Josh.
 */

/** Interested replies per 2,000 sends a campaign needs to be topped up (D11, D44, brief §2). */
export const REPLY_BAR_PER_2000 = 1;

/** Leads a campaign must still have available before a top-up is worth running. Under this "the TAM for this campaign is exhausted". */
export const MIN_NET_NEW = 1000;

/** Pilot: a 200–300 row sample scored against the recipe; any scored dimension under 80% stops the size. */
export const PILOT_ROWS = 250;
export const PILOT_MIN_ROWS = 200;
export const PILOT_MAX_ROWS = 300;
export const PILOT_GATE_PERCENT = 80;

/** A pool more than this many times the build it repeats is a suspect filter. */
export const SUSPECT_BUILD_MULTIPLE = 20;

/** About 40,000 MSPs exist in the US. A people count above this is not that market; one in the low hundreds is too narrow. */
export const MSP_MARKET_CAP = 40_000;
export const MSP_MARKET_FLOOR = 1_000;

/** LinkedIn-native TAM: getleads and AI Ark agree when within 10% of the larger count. */
export const LINKEDIN_TAM_WITHIN = 0.1;

/** Spend: the operator's own approval limit, the daily vendor backstop, owner-only approvals (D9, D45). */
export const OPERATOR_SPEND_CAP_USD = 5;
export const DAILY_VENDOR_CAP_USD = 25;

/** Campaigns that are never topped up. 4085158 is SG Gabe Calls. 3122546 is SG Nurture. SG Cayden Calls is matched by name. */
export const NEVER_TOPUP_CAMPAIGN_IDS: readonly number[] = [4085158, 3122546];
export const NEVER_TOPUP_NAME_PATTERNS: readonly RegExp[] = [/cayden calls/i, /gabe calls/i, /sg nurture/i];

/** Clients the service ignores until told otherwise. */
export const IGNORED_CLIENT_TAGS: readonly string[] = ["goliath"];

/** Insight OEM Channel Reps is paused. Insight Google SADA is dropped (no positives). Neither starts, including from the watch. */
export const PAUSED_LABELS: readonly RegExp[] = [/oem channel reps/i];
export const DROPPED_LABELS: readonly RegExp[] = [/google sada/i];

/** Parlay: only the Sept 29 refresh is live. Everything older is retired and invisible to the queue, the watch and the start path. */
export const PARLAY_CLIENT_TAG = "parlay";
export const PARLAY_REFRESH_FIRST = 4049046;
export const PARLAY_REFRESH_LAST = 4049064;
export const PARLAY_RETIRED_CAMPAIGN_IDS: readonly number[] = [
  3479011,
  3628957,
  3705889,
  ...Array.from({ length: 3847850 - 3847837 + 1 }, (_, i) => 3847837 + i),
  3929973,
  3929974,
];

/** Smartlead statuses. Only ACTIVE is a target. */
export const ACTIVE_CAMPAIGN_STATUS = "ACTIVE";
export const NON_TARGET_CAMPAIGN_STATUSES: readonly string[] = ["COMPLETED", "DRAFTED", "DRAFT", "PAUSED", "ARCHIVED"];

/** ICP kinds and which clients are not LinkedIn-native by default (per lane or build when the registry says so). */
export const NON_LINKEDIN_CLIENT_TAGS: readonly string[] = ["peterson", "peterson_earthworks", "emcor", "vector_energy", "deep_roots"];

/** One place to ask. Every refusal names it. */
export const ASK = "Ask Josh.";

export function isNeverTopUp(id: number, name?: string | null): boolean {
  if (NEVER_TOPUP_CAMPAIGN_IDS.includes(id)) return true;
  const label = name?.trim() ?? "";
  return label.length > 0 && NEVER_TOPUP_NAME_PATTERNS.some((re) => re.test(label));
}

export function isIgnoredClient(clientTag: string): boolean {
  return IGNORED_CLIENT_TAGS.includes(clientTag.trim().toLowerCase());
}

function labelText(text: string | null | undefined): string {
  return (text ?? "").replace(/_/g, " ").trim();
}

export function isPausedLabel(text: string | null | undefined): boolean {
  const value = labelText(text);
  return value.length > 0 && PAUSED_LABELS.some((re) => re.test(value));
}

export function isDroppedLabel(text: string | null | undefined): boolean {
  const value = labelText(text);
  return value.length > 0 && DROPPED_LABELS.some((re) => re.test(value));
}

/** Paused or dropped: both stay off the board and never start. */
export function isPausedOrDroppedLabel(text: string | null | undefined): boolean {
  return isPausedLabel(text) || isDroppedLabel(text);
}

export function isParlayRefreshCampaign(id: number): boolean {
  return Number.isInteger(id) && id >= PARLAY_REFRESH_FIRST && id <= PARLAY_REFRESH_LAST;
}

export function isRetiredCampaign(clientTag: string, id: number): boolean {
  if (PARLAY_RETIRED_CAMPAIGN_IDS.includes(id)) return true;
  return clientTag === PARLAY_CLIENT_TAG && !isParlayRefreshCampaign(id);
}

/** ACTIVE, or a blank status the mirror did not classify. */
export function isActiveStatus(status: string | null | undefined): boolean {
  if (status == null) return true;
  const name = status.trim().toUpperCase();
  if (!name) return true;
  return name === ACTIVE_CAMPAIGN_STATUS;
}

export function marketCapFor(lane: string, sourceText: string): number | null {
  const blob = `${lane} ${sourceText}`.toLowerCase();
  if (/\bmsp\b|managed service/.test(blob)) return MSP_MARKET_CAP;
  return null;
}

/** 20× the build it repeats, above a known market cap, or an MSP pool in the low hundreds. */
export function isSuspectFilter(tamTotal: number, rowsFound: number | null, marketCap: number | null): boolean {
  if (rowsFound != null && rowsFound > 0 && tamTotal > rowsFound * SUSPECT_BUILD_MULTIPLE) return true;
  if (marketCap != null && tamTotal > marketCap) return true;
  if (marketCap === MSP_MARKET_CAP && tamTotal > 0 && tamTotal < MSP_MARKET_FLOOR) return true;
  return false;
}

/** Two LinkedIn-native counts agree when they are within LINKEDIN_TAM_WITHIN of the larger. */
export function countsAgree(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  return hi === 0 ? true : Math.abs(a - b) / hi <= LINKEDIN_TAM_WITHIN;
}

export function ratePer2000(sends: number, positives: number): number {
  return sends === 0 ? 0 : (positives / sends) * 2000;
}
