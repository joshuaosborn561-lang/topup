/**
 * D58 — Josh dropped LeadMagic on 2026-10-08. Old receipts still carry
 * `email_max_tier=leadmagic` and (rarely) a LeadMagic person source. Replay
 * maps those names and warns. It never rewrites the stored row. New recipes
 * and new receipts never write the old names.
 */

export const LIVE_EMAIL_TIERS = ["getleads", "smartlead", "aiark", "prospeo", "fullenrich"] as const;
export type LiveEmailTier = (typeof LIVE_EMAIL_TIERS)[number];

/** Aliases that used to mean "stop before Prospeo". Ceiling maps to `aiark`. */
export const LEGACY_EMAIL_MAX_TIER_ALIASES = ["leadmagic", "lm", "lead_magic"] as const;

export const DEFAULT_EMAIL_MAX_TIER: LiveEmailTier = "aiark";

/**
 * Find Named Person's live default (the people-waterfall service). LeadMagic
 * employee/role tiers are gone; a legacy person source uses this order.
 */
export const PEOPLE_DEFAULT_ORDER = ["site_staff", "cache", "discolike", "prospeo_search", "aiark_people"] as const;

export const LEGACY_PERSON_SOURCES = [
  "leadmagic_employee_finder",
  "leadmagic",
  "leadmagic_employee",
  "leadmagic_role",
  "lm_employee",
  "employee_finder",
] as const;

export const LIVE_PERSON_SOURCE_FOR_LEGACY = "people_waterfall";

export const EMAIL_MAX_TIER_LEGACY_WARNING =
  "D58: email_max_tier=leadmagic is a dropped ceiling; replay as aiark (stop before Prospeo). The stored receipt was not rewritten. Ask Josh.";

export const PERSON_SOURCE_LEGACY_WARNING =
  "D58: a LeadMagic person source is dropped; replay as people_waterfall with Find Named Person default order site_staff → cache → discolike → prospeo_search → aiark_people. The stored receipt was not rewritten. Ask Josh.";

export interface MappedEmailMaxTier {
  tier: LiveEmailTier | null;
  legacy: boolean;
  warning: string | null;
}

export interface MappedPersonSource {
  source: string | null;
  order: readonly string[];
  legacy: boolean;
  warning: string | null;
}

export function isLegacyEmailMaxTier(tier: string | null | undefined): boolean {
  if (!tier) return false;
  return (LEGACY_EMAIL_MAX_TIER_ALIASES as readonly string[]).includes(tier.trim().toLowerCase());
}

export function isLegacyPersonSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return (LEGACY_PERSON_SOURCES as readonly string[]).includes(source.trim().toLowerCase());
}

export function isLiveEmailTier(tier: string | null | undefined): tier is LiveEmailTier {
  if (!tier) return false;
  return (LIVE_EMAIL_TIERS as readonly string[]).includes(tier.trim().toLowerCase());
}

/**
 * Map a receipt or recipe ceiling onto a live Email Waterfall max_tier.
 * `leadmagic` / `lm` / `lead_magic` → `aiark` (the old spend boundary,
 * minus the dead vendor). Unknown names stay unknown so the caller can refuse.
 */
export function mapEmailMaxTier(tier: string | null | undefined): MappedEmailMaxTier {
  if (tier == null || String(tier).trim() === "") return { tier: null, legacy: false, warning: null };
  const t = String(tier).trim().toLowerCase();
  if (isLegacyEmailMaxTier(t)) return { tier: DEFAULT_EMAIL_MAX_TIER, legacy: true, warning: EMAIL_MAX_TIER_LEGACY_WARNING };
  if (isLiveEmailTier(t)) return { tier: t, legacy: false, warning: null };
  return { tier: null, legacy: false, warning: null };
}

/**
 * Map a receipt person source. Legacy LeadMagic names become
 * `people_waterfall` plus the live Find Named Person order. Other names
 * pass through; `people_waterfall` itself also carries the live order.
 */
export function mapPersonSource(source: string | null | undefined): MappedPersonSource {
  if (source == null || String(source).trim() === "") return { source: null, order: [], legacy: false, warning: null };
  const s = String(source).trim().toLowerCase();
  if (isLegacyPersonSource(s)) {
    return { source: LIVE_PERSON_SOURCE_FOR_LEGACY, order: PEOPLE_DEFAULT_ORDER, legacy: true, warning: PERSON_SOURCE_LEGACY_WARNING };
  }
  if (s === LIVE_PERSON_SOURCE_FOR_LEGACY) {
    return { source: s, order: PEOPLE_DEFAULT_ORDER, legacy: false, warning: null };
  }
  return { source: s, order: [], legacy: false, warning: null };
}

/** Unique warnings for a set of stored receipt/build rows. Stored values are not changed. */
export function legacyReplayWarnings(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const email = mapEmailMaxTier(typeof row.email_max_tier === "string" ? row.email_max_tier : null);
    if (email.warning) out.push(email.warning);
    const person = mapPersonSource(typeof row.person_source === "string" ? row.person_source : null);
    if (person.warning) out.push(person.warning);
  }
  return [...new Set(out)];
}

/** Ceiling to store on a new recipe or receipt. Never writes a LeadMagic name. */
export function liveEmailMaxTier(tier: string | null | undefined, fallback: LiveEmailTier = DEFAULT_EMAIL_MAX_TIER): LiveEmailTier {
  return mapEmailMaxTier(tier).tier ?? fallback;
}
