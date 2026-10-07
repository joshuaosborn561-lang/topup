/** Peterson, EMCOR, and the next physical clients. LinkedIn-native is the default. */
export const NON_LINKEDIN_CLIENTS = ["peterson", "peterson_earthworks", "emcor", "vector_energy", "deep_roots"] as const;

export type IcpKind = "linkedin_native" | "non_linkedin";

const NON_LINKEDIN = new Set<string>(NON_LINKEDIN_CLIENTS);

export function icpKindForClient(clientTag: string, registryKind?: string | null): IcpKind {
  if (registryKind === "linkedin_native" || registryKind === "non_linkedin") return registryKind;
  const tag = clientTag.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (NON_LINKEDIN.has(tag)) return "non_linkedin";
  return "linkedin_native";
}

/** LinkedIn-native counts agree when they are within 10% of the larger. */
export const LINKEDIN_TAM_WITHIN = 0.1;

export interface LinkedinTam {
  tam_total: number | null;
  tam_check: "ok" | "tam_mismatch" | "single_source";
  getleads_count: number;
  ai_ark_count: number | null;
  tam_source: string;
  reason: string | null;
}

function withinTen(a: number, b: number): boolean {
  const hi = Math.max(a, b);
  return hi === 0 ? true : Math.abs(a - b) / hi <= LINKEDIN_TAM_WITHIN;
}

export function linkedinTamDecision(getleads: number, aiArk: number | null): LinkedinTam {
  if (aiArk == null) {
    return {
      tam_total: getleads,
      tam_check: "single_source",
      getleads_count: getleads,
      ai_ark_count: null,
      tam_source: "getleads; AI Ark People Preview count is not available",
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
  return {
    tam_total: null,
    tam_check: "tam_mismatch",
    getleads_count: getleads,
    ai_ark_count: aiArk,
    tam_source: "getleads and AI Ark",
    reason: `tam_mismatch: getleads ${getleads} and AI Ark ${aiArk} are more than 10% apart`,
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
export function originalTamFromBuilds(builds: readonly Record<string, unknown>[], campaignId: number): OriginalTam {
  const matched = builds.filter((row) => Number(row.smartlead_campaign_id ?? row.campaign_id) === campaignId);
  const row = matched[0];
  const method = String(row?.method ?? row?.how_i_did_it ?? "");
  const source = String(row?.company_source ?? "").toLowerCase();
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
