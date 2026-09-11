/**
 * The service's own unit price table. Worst case for any paid step is
 * computed from THIS table and the batch size, never from a vendor tool's
 * cost field (one of them reports $0.00 on every tier; brief section 8).
 *
 * Prices are cents per credit, deliberately rounded UP. Over-estimating asks
 * for a tap a little early; under-estimating is how credits disappear. When
 * Josh confirms a plan price, lower the number here and note it in
 * DECISIONS.md.
 */

export const VENDORS = [
  "millionverifier",
  "no2bounce",
  "aiark",
  "leadmagic",
  "prospeo",
  "fullenrich",
  "apify",
  "getleads",
  "smartlead",
] as const;
export type Vendor = (typeof VENDORS)[number];

export interface VendorPrice {
  /** "paid" bills per credit; "included" is covered by a flat plan and costs 0 per call. */
  kind: "paid" | "included";
  /** Cents per credit, rounded up. Must be > 0 for every paid vendor (guard). */
  unitCents: number;
  /** Worst-case credits one row can consume on this vendor. */
  creditsPerRow: number;
  /** Where the number came from, so it can be corrected. */
  source: string;
}

export const PRICES: Readonly<Record<Vendor, VendorPrice>> = {
  millionverifier: {
    kind: "paid",
    unitCents: 0.2,
    creditsPerRow: 1,
    source: "conservative; MV bulk credits run $0.0005–0.002 depending on tier — confirm plan price",
  },
  no2bounce: {
    kind: "paid",
    unitCents: 0.3,
    creditsPerRow: 1,
    source: "conservative; only catch_all + unknown rows reach N2B — confirm plan price",
  },
  aiark: {
    kind: "paid",
    unitCents: 3,
    creditsPerRow: 1.5,
    source: "email_waterfall CREDIT_PER_ATTEMPT aiark=1.5 (email+phone); price conservative",
  },
  leadmagic: {
    kind: "paid",
    unitCents: 5,
    creditsPerRow: 1,
    source: "conservative; 1,183 credits vanished in minutes on 2026-09-10 — confirm plan price",
  },
  prospeo: {
    kind: "paid",
    unitCents: 3,
    creditsPerRow: 1,
    source: "conservative — confirm plan price",
  },
  fullenrich: {
    kind: "paid",
    unitCents: 25,
    creditsPerRow: 1,
    source: "conservative; OFF in every recipe until owner_approved_at is stamped",
  },
  apify: {
    kind: "paid",
    unitCents: 1,
    creditsPerRow: 1,
    source: "per-result placeholder; Phase 3 hard-ICP lanes only",
  },
  getleads: { kind: "included", unitCents: 0, creditsPerRow: 1, source: "unlimited plan" },
  smartlead: { kind: "included", unitCents: 0, creditsPerRow: 1, source: "plan email finder allotment" },
};

/** Vendors that must never be wired, including through wrappers (brief section 8). */
export const BANNED_VENDORS: readonly string[] = ["pdl", "peopledatalabs", "people_data_labs", "billionverifier", "clay"];

/** Vendor actions that bill on every call and are banned outright. */
export const BANNED_ACTIONS: readonly string[] = ["detect_job_change", "job_change", "job_change_detector"];

/** Actions that are free by construction (a resume reloads an existing file). */
export const FREE_ACTIONS: readonly string[] = ["resume", "status", "results", "mx_classify", "count"];

export function isBannedVendor(vendor: string): boolean {
  return BANNED_VENDORS.includes(vendor.toLowerCase().replace(/[-\s]/g, "_"));
}

export function isBannedAction(action: string): boolean {
  return BANNED_ACTIONS.includes(action.toLowerCase());
}

export function isFreeAction(action: string): boolean {
  return FREE_ACTIONS.includes(action.toLowerCase());
}

/**
 * Worst-case cents for `rows` rows on `vendor`. Integer cents, rounded up.
 * Throws on a banned vendor or action — those never get a number, they get
 * refused.
 */
export function worstCaseCents(vendor: string, action: string, rows: number): number {
  if (isBannedVendor(vendor)) throw new Error(`vendor ${vendor} is banned from this stack`);
  if (isBannedAction(action)) throw new Error(`action ${action} is banned (bills on every call)`);
  if (!(vendor in PRICES)) throw new Error(`no price on file for vendor ${vendor}; refusing to estimate`);
  if (isFreeAction(action)) return 0;
  const p = PRICES[vendor as Vendor];
  if (p.kind === "included") return 0;
  if (!Number.isFinite(rows) || rows < 0) throw new Error(`rows must be a non-negative number`);
  return Math.ceil(rows * p.creditsPerRow * p.unitCents);
}

/** Cents for credits a vendor reports it actually used. */
export function actualCents(vendor: string, credits: number): number {
  if (!(vendor in PRICES)) throw new Error(`no price on file for vendor ${vendor}`);
  const p = PRICES[vendor as Vendor];
  if (p.kind === "included") return 0;
  return Math.ceil(Math.max(0, credits) * p.unitCents);
}

export function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
