import { countGap, countsAgree, LINKEDIN_GAP_MINOR, LINKEDIN_TAM_WITHIN, NON_LINKEDIN_CLIENT_TAGS } from "../../policy/index.js";

/** Peterson, EMCOR, and the next physical clients (policy, D46). LinkedIn-native is the default. */
export const NON_LINKEDIN_CLIENTS = NON_LINKEDIN_CLIENT_TAGS;

export type IcpKind = "linkedin_native" | "non_linkedin";

const NON_LINKEDIN = new Set<string>(NON_LINKEDIN_CLIENTS);

export function icpKindForClient(clientTag: string, registryKind?: string | null): IcpKind {
  if (registryKind === "linkedin_native" || registryKind === "non_linkedin") return registryKind;
  const tag = clientTag.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (NON_LINKEDIN.has(tag)) return "non_linkedin";
  return "linkedin_native";
}

/** LinkedIn-native counts agree when they are within 10% of the larger (policy, D46). */
export { LINKEDIN_TAM_WITHIN };

export interface LinkedinTam {
  tam_total: number | null;
  tam_check: "ok" | "tam_mismatch" | "single_source" | "mismatch_minor" | "ai_ark_wider" | "getleads_only";
  getleads_count: number;
  ai_ark_count: number | null;
  tam_source: string;
  reason: string | null;
}

const withinTen = countsAgree;

/**
 * Both counts are kept. A gap of 10% to 25% uses the lower count. A wider
 * gap uses the AI Ark count only when its pilot passed 80% on title and
 * industry; otherwise the TAM stays the getleads count. Neither case parks.
 */
export function linkedinTamDecision(
  getleads: number,
  aiArk: number | null,
  unavailable?: string | null,
  pilotPasses?: boolean | null,
): LinkedinTam {
  if (aiArk == null) {
    const why = unavailable?.trim() || "AI Ark People Preview count is not available";
    return {
      tam_total: getleads,
      tam_check: "single_source",
      getleads_count: getleads,
      ai_ark_count: null,
      tam_source: `getleads; ${why}`,
      reason: null,
    };
  }
  if (withinTen(getleads, aiArk)) {
    return {
      tam_total: getleads,
      tam_check: "ok",
      getleads_count: getleads,
      ai_ark_count: aiArk,
      tam_source: "getleads",
      reason: null,
    };
  }
  const gap = countGap(getleads, aiArk);
  if (gap <= LINKEDIN_GAP_MINOR) {
    const lower = Math.min(getleads, aiArk);
    return {
      tam_total: lower,
      tam_check: "mismatch_minor",
      getleads_count: getleads,
      ai_ark_count: aiArk,
      tam_source: "lower of getleads and AI Ark (gap 10% to 25%)",
      reason: null,
    };
  }
  if (pilotPasses === true) {
    return {
      tam_total: aiArk,
      tam_check: "ai_ark_wider",
      getleads_count: getleads,
      ai_ark_count: aiArk,
      tam_source: "AI Ark (gap over 25%, title and industry pilot passed)",
      reason: null,
    };
  }
  const why = pilotPasses === false ? "AI Ark pilot was under 80% on title or industry" : "AI Ark pilot was not scored";
  return {
    tam_total: getleads,
    tam_check: "getleads_only",
    getleads_count: getleads,
    ai_ark_count: aiArk,
    tam_source: `getleads (${why}; gap over 25%)`,
    reason: null,
  };
}

export type OriginalTam =
  | { kind: "pool"; pool: number; contacted: number; tam_total: number; tam_source: string }
  | { kind: "missing"; tam_source: string; reason: string };

function intIn(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function contactedFrom(row: Record<string, unknown>): number {
  const imported = Number(row.rows_imported);
  if (Number.isFinite(imported) && imported > 0) return imported;
  const leads = Number(row.leads);
  if (Number.isFinite(leads) && leads > 0) return leads;
  return 0;
}

/**
 * Maps or permits pool from the build method. A getleads geo-fence count
 * is not a TAM. 13,438 with a domain plus 4,885 needing one is the Small
 * Ops pool (18,323), not the 34,878 raw scrape.
 */
function poolFromRow(row: Record<string, unknown>, campaignId: number): OriginalTam {
  const method = String(row.method ?? row.how_i_did_it ?? row.notes ?? "");
  const source = String(row.company_source ?? "").toLowerCase();
  const withDomain = intIn(method, /([\d,]+)\s+with a domain/i);
  const needing = intIn(method, /([\d,]+)\s+needing one/i);
  const zips = intIn(method, /(\d+)\s+zips?\s*x\s*(\d+)\s+categories/i);
  const categories = intIn(method, /\d+\s+zips?\s*x\s*(\d+)\s+categories/i);
  if (withDomain != null && needing != null && (source === "maps" || /google maps/i.test(method))) {
    const pool = withDomain + needing;
    const contacted = row ? contactedFrom(row) : 0;
    const zipNote = zips && categories ? `${zips} ZIPs × ${categories} categories, ` : "";
    return {
      kind: "pool",
      pool,
      contacted,
      tam_total: Math.max(0, pool - contacted),
      tam_source: `Google Maps, ${zipNote}${pool.toLocaleString("en-US")} businesses`,
    };
  }
  const businesses = intIn(method, /([\d,]+)\s+businesses/i);
  if (businesses != null && source === "maps" && !/getleads/i.test(method)) {
    const contacted = row ? contactedFrom(row) : 0;
    return {
      kind: "pool",
      pool: businesses,
      contacted,
      tam_total: Math.max(0, businesses - contacted),
      tam_source: `Google Maps, ${businesses.toLocaleString("en-US")} businesses`,
    };
  }
  if (source === "permits" || /permit/i.test(method)) {
    const permits = intIn(method, /([\d,]+)\s+permits/i);
    if (permits != null) {
      const contacted = row ? contactedFrom(row) : 0;
      return {
        kind: "pool",
        pool: permits,
        contacted,
        tam_total: Math.max(0, permits - contacted),
        tam_source: `permits, ${permits.toLocaleString("en-US")}`,
      };
    }
  }
  const named = /geo_fence|getleads/i.test(method) || source === "getleads" ? "getleads geo fence" : source || "the build receipt";
  return {
    kind: "missing",
    tam_source: named,
    reason: `tam_source_missing: #${campaignId} has no stored Maps or permits pool. The receipt source is ${named}. Not sized from a getleads count.`,
  };
}

/**
 * The first build row that names a Maps or permits pool wins. A later row
 * is read when the first one is a different build with no pool in the note.
 */
export function originalTamFromBuilds(builds: readonly Record<string, unknown>[], campaignId: number): OriginalTam {
  const matched = builds.filter((row) => Number(row.smartlead_campaign_id ?? row.campaign_id) === campaignId);
  let missing: OriginalTam | null = null;
  for (const row of matched) {
    const parsed = poolFromRow(row, campaignId);
    if (parsed.kind === "pool") return parsed;
    missing ??= parsed;
  }
  return (
    missing ?? {
      kind: "missing",
      tam_source: "the build receipt",
      reason: `tam_source_missing: #${campaignId} has no stored Maps or permits pool. The receipt source is the build receipt. Not sized from a getleads count.`,
    }
  );
}

export interface StoredYield {
  tam_total: number;
  tam_source: string;
  labels: string[];
}

/**
 * Imported rows on builds that cannot be repeated as a vendor query.
 * One number per build label. Empty when nothing was imported.
 */
export function storedYieldFromBuilds(builds: readonly Record<string, unknown>[], campaignId: number): StoredYield | null {
  const matched = builds.filter((row) => Number(row.smartlead_campaign_id ?? row.campaign_id) === campaignId);
  const byLabel = new Map<string, number>();
  for (const row of matched) {
    const label = String(row.build_label ?? "").trim();
    if (!label) continue;
    const imported = Number(row.rows_imported);
    const leads = Number(row.leads);
    const n = Number.isFinite(imported) && imported > 0 ? imported : Number.isFinite(leads) && leads > 0 ? leads : 0;
    if (n <= 0) continue;
    byLabel.set(label, Math.max(byLabel.get(label) ?? 0, n));
  }
  if (byLabel.size === 0) return null;
  const labels = [...byLabel.keys()];
  const tam_total = [...byLabel.values()].reduce((sum, n) => sum + n, 0);
  return {
    tam_total,
    labels,
    tam_source: `stored yield from ${labels.join(" and ")} (${tam_total.toLocaleString("en-US")} imported); no repeatable vendor query`,
  };
}
