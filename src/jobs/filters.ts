import { mapGetleadsIndustry } from "./getleadsIndustries.js";
import { ASK } from "../policy/rules.js";
import { geoFenceRef } from "../recipes/geoFence.js";
import { GETLEADS_BANDS, GETLEADS_EMAIL_STATUSES } from "../recipes/schema.js";

/**
 * getleads filters as a receipt stores them, read back into the vendor's
 * parameters (D74, D84). Every stored key is mapped or the parse fails.
 * `industries_by_campaign`, `max_per_company` and `over_1k_campaign` are
 * honored when the receipt carries them (D84). Pass `campaign_id` when
 * the industries map names more than one campaign.
 */
const BANDS = new Set<string>(GETLEADS_BANDS);
const EMAIL_STATUSES = new Set<string>(GETLEADS_EMAIL_STATUSES);

/** Keys we map onto count_contacts / export_contacts. Anything else fails. */
export const GETLEADS_STORED_KEYS = [
  "job_titles",
  "titles",
  "job_function",
  "job_functions",
  "seniority",
  "company_size",
  "countries",
  "states",
  "cities",
  "geo_fence",
  "industries",
  "companyIndustry",
  "company_description",
  "email_status",
  "max_per_company",
  "export_caps",
  "purged_titles",
  "exclude_job_titles",
  "employee_profiles_on_linkedin",
  "employee_profiles_on_linkedin_min",
  "employee_profiles_on_linkedin_max",
  "title_match",
  "title_match_mode",
  "exact_title",
] as const;

const KNOWN = new Set<string>(GETLEADS_STORED_KEYS);

/** 1001+ LinkedIn bands. `over_1k_campaign` includes or drops these (D84). */
export const OVER_1K_BANDS = ["1001 to 5000", "5001 to 10000", "10001+"] as const;

/** Receipt meta count honors on every source (D84). Not sent to count_contacts. */
export const RECEIPT_COUNT_KEYS = ["max_per_company", "industries_by_campaign", "over_1k_campaign"] as const;

/**
 * Stored on the receipt as notes / gates, never sent to count_contacts.
 * Stripped so a later D74 parse does not fail them as unmapped (D92).
 */
export const RECEIPT_META_KEYS = ["icp_gate"] as const;

export type ReceiptCountHonor =
  | { ok: true; filters: Record<string, unknown>; honored: Record<string, unknown> }
  | { ok: false; error: string };

function campaignIdKey(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.floor(value));
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/** campaign_id from the count argument or the filters blob (D84). */
export function campaignIdFrom(filters: Record<string, unknown>, campaignId?: number | string | null): string | null {
  return campaignIdKey(campaignId) ?? campaignIdKey(filters.campaign_id);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * D84 stored this as a map of campaign id → industries. Non-numeric keys
 * are buckets taken from the map itself. Resolve by id first, then by a
 * word-boundary match of a stored key against the campaign name. No key
 * list is hardcoded (D93).
 */
function pickIndustriesByCampaign(
  byCampaign: unknown,
  campaignId: string | null,
  campaignName?: string | null,
): { ok: true; campaign_id: string; values: unknown; key: string } | { ok: false; error: string } {
  if (byCampaign == null) return { ok: false, error: `industries_by_campaign is missing. ${ASK}` };
  if (typeof byCampaign !== "object" || Array.isArray(byCampaign)) {
    return { ok: false, error: `industries_by_campaign must be a map of campaign id to industries. ${ASK}` };
  }
  const map = byCampaign as Record<string, unknown>;
  const keys = Object.keys(map);
  if (keys.length === 0) return { ok: false, error: `industries_by_campaign is empty. ${ASK}` };
  let id = campaignId;
  if (!id && keys.length === 1) id = keys[0]!;
  if (id) {
    const raw = map[id] ?? map[String(Number(id))];
    if (raw !== undefined) {
      const values = asStringArray(raw);
      if (values.length === 0) {
        return { ok: false, error: `industries_by_campaign for campaign ${id} is empty. ${ASK}` };
      }
      return { ok: true, campaign_id: id, values, key: id };
    }
  }
  const name = (campaignName ?? "").trim();
  if (name) {
    const buckets = keys.filter((k) => !/^\d+$/.test(k));
    const hits = buckets.filter((k) => {
      const token = k.toLowerCase().replace(/[_-]+/g, " ").trim();
      if (!token) return false;
      return new RegExp(`\\b${escapeRe(token)}\\b`, "i").test(name);
    });
    if (hits.length === 1) {
      const key = hits[0]!;
      const values = asStringArray(map[key]);
      if (values.length === 0) {
        return { ok: false, error: `industries_by_campaign bucket ${JSON.stringify(key)} is empty. ${ASK}` };
      }
      return { ok: true, campaign_id: id ?? key, values, key };
    }
    if (hits.length > 1) {
      return {
        ok: false,
        error: `industries_by_campaign matched more than one bucket (${hits.join(", ")}) on this campaign name. ${ASK}`,
      };
    }
  }
  if (!id) {
    return { ok: false, error: `industries_by_campaign has more than one campaign; pass campaign_id. ${ASK}` };
  }
  return {
    ok: false,
    error: `industries_by_campaign has no list for campaign ${id}. Stored keys: ${keys.join(", ")}. ${ASK}`,
  };
}

/**
 * Honor the receipt keys D84 names, on every count source. Strips the meta
 * keys (and campaign_id) so a later D74 parse does not fail them as unmapped.
 * Does not invent a filter the receipt did not carry.
 */
export function honorReceiptCountKeys(
  filters: Record<string, unknown>,
  campaignId?: number | string | null,
  campaignName?: string | null,
): ReceiptCountHonor {
  const next: Record<string, unknown> = { ...filters };
  const honored: Record<string, unknown> = {};
  const id = campaignIdFrom(filters, campaignId);

  if ("industries_by_campaign" in next) {
    const picked = pickIndustriesByCampaign(next.industries_by_campaign, id, campaignName);
    if (!picked.ok) return picked;
    const mapped = mapIndustries(picked.values);
    if (!mapped.ok) return mapped;
    next.industries = mapped.values;
    honored.industries = mapped.values;
    honored.industries_by_campaign = { [picked.key]: mapped.values };
    delete next.industries_by_campaign;
  }

  if ("over_1k_campaign" in next) {
    const flag = next.over_1k_campaign;
    if (typeof flag !== "boolean") {
      return { ok: false, error: `over_1k_campaign must be true or false. ${ASK}` };
    }
    const existing = asStringArray(next.company_size);
    const over = new Set<string>(OVER_1K_BANDS);
    if (flag) {
      const kept = existing.filter((band) => over.has(band));
      next.company_size = kept.length > 0 ? kept : [...OVER_1K_BANDS];
    } else if (existing.length > 0) {
      const under = existing.filter((band) => !over.has(band));
      if (under.length === 0) {
        return { ok: false, error: `over_1k_campaign is false and company_size has only 1001+ bands. ${ASK}` };
      }
      next.company_size = under;
    }
    honored.over_1k_campaign = flag;
    if (Array.isArray(next.company_size)) honored.company_size = next.company_size;
    delete next.over_1k_campaign;
  }

  const exportCaps = next.export_caps && typeof next.export_caps === "object" && !Array.isArray(next.export_caps)
    ? (next.export_caps as Record<string, unknown>)
    : {};
  const maxPer = Number(next.max_per_company ?? exportCaps.max_per_company);
  if (Number.isFinite(maxPer) && maxPer >= 1) {
    honored.max_per_company = Math.floor(maxPer);
    next.max_per_company = honored.max_per_company;
  }

  delete next.campaign_id;
  for (const k of RECEIPT_META_KEYS) delete next[k];
  return { ok: true, filters: next, honored };
}

export interface GetleadsCountParams {
  job_titles?: string[];
  job_function?: string;
  seniority?: string[];
  company_size?: Array<(typeof GETLEADS_BANDS)[number]>;
  countries?: string[];
  states?: string[];
  cities?: string[];
  industries?: string[];
  company_description?: string;
  email_status?: Array<(typeof GETLEADS_EMAIL_STATUSES)[number]>;
  exclude_job_titles?: string[];
  geo_fence?: { schema: string; table: string };
  max_per_company?: number;
  employee_profiles_on_linkedin?: { min?: number; max?: number };
  employee_profiles_on_linkedin_min?: number;
  employee_profiles_on_linkedin_max?: number;
  /** Exact (default) or substring title match (D82). */
  title_match?: "exact" | "substring";
}

export type GetleadsFilterParse =
  | { ok: true; params: GetleadsCountParams }
  | { ok: false; error: string };

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function validBands(v: unknown): Array<(typeof GETLEADS_BANDS)[number]> {
  return asStringArray(v).filter((b): b is (typeof GETLEADS_BANDS)[number] => BANDS.has(b));
}

function jobFunctionName(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  const list = asStringArray(v);
  return list.length === 1 ? list[0]! : null;
}

function unknownKeys(filters: Record<string, unknown>): string[] {
  return Object.keys(filters).filter((k) => !KNOWN.has(k)).sort();
}

function parseTitleMatch(filters: Record<string, unknown>): { ok: true; value: "exact" | "substring" } | { ok: false; error: string } {
  const raw = filters.title_match ?? filters.title_match_mode;
  if (raw !== undefined && raw !== null && raw !== "") {
    if (typeof raw !== "string") {
      return { ok: false, error: `title_match ${JSON.stringify(raw)} is not exact or substring (D82). ${ASK}` };
    }
    const s = raw.trim().toLowerCase();
    if (s === "exact") return { ok: true, value: "exact" };
    if (s === "substring") return { ok: true, value: "substring" };
    return { ok: false, error: `title_match ${JSON.stringify(raw)} is not exact or substring (D82). ${ASK}` };
  }
  if (filters.exact_title === false) return { ok: true, value: "substring" };
  if (filters.exact_title === true || filters.exact_title === undefined) return { ok: true, value: "exact" };
  return { ok: false, error: `exact_title ${JSON.stringify(filters.exact_title)} is not a boolean (D82). ${ASK}` };
}

function mapIndustries(v: unknown): { ok: true; values: string[] } | { ok: false; error: string } {
  const raw = asStringArray(v);
  if (raw.length === 0) return { ok: true, values: [] };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of raw) {
    if (/sibling industries|adjacent set/i.test(name)) {
      return { ok: false, error: `industry ${JSON.stringify(name)} is a note, not a getleads industry. ${ASK}` };
    }
    const mapped = mapGetleadsIndustry(name);
    if (!mapped.ok) return mapped;
    if (seen.has(mapped.value)) continue;
    seen.add(mapped.value);
    out.push(mapped.value);
  }
  return { ok: true, values: out };
}

export function getleadsParamsFromFilters(
  filters: Record<string, unknown>,
  campaignId?: number | string | null,
  campaignName?: string | null,
): GetleadsFilterParse {
  const honored = honorReceiptCountKeys(filters, campaignId, campaignName);
  if (!honored.ok) return honored;
  filters = honored.filters;
  const extra = unknownKeys(filters);
  if (extra.length) {
    return {
      ok: false,
      error: `unmapped getleads filter keys: ${extra.join(", ")}. Every stored key must map to the getleads API (D74). ${ASK}`,
    };
  }
  const titles = asStringArray(filters.job_titles ?? filters.titles);
  const jobFunction = jobFunctionName(filters.job_function ?? filters.job_functions);
  const seniority = asStringArray(filters.seniority);
  if (titles.length === 0 && !(jobFunction && seniority.length)) {
    return { ok: false, error: "getleads needs job_titles, or job_function plus seniority; company_size as band labels when given." };
  }
  const namedBands = filters.company_size;
  const hasBandField = namedBands !== undefined && namedBands !== null && !(Array.isArray(namedBands) && namedBands.length === 0);
  const bands = validBands(namedBands);
  if (hasBandField && bands.length === 0) {
    return { ok: false, error: "getleads company_size must be exact band labels when given." };
  }
  const industries = mapIndustries(filters.industries ?? filters.companyIndustry);
  if (!industries.ok) return industries;
  const description = typeof filters.company_description === "string" && filters.company_description.trim()
    ? filters.company_description.trim()
    : null;
  const purged = asStringArray(filters.exclude_job_titles ?? filters.purged_titles);
  const exportCaps = filters.export_caps && typeof filters.export_caps === "object" ? (filters.export_caps as Record<string, unknown>) : {};
  const maxPer = Number(filters.max_per_company ?? exportCaps.max_per_company);
  const cityList = asStringArray(filters.cities);
  const fence = cityList.length ? null : geoFenceRef(filters.cities);
  const emailStatus = asStringArray(filters.email_status)
    .map((status) => status.toUpperCase())
    .filter((status): status is (typeof GETLEADS_EMAIL_STATUSES)[number] => EMAIL_STATUSES.has(status));
  const epl = filters.employee_profiles_on_linkedin;
  const eplObj = epl && typeof epl === "object" && !Array.isArray(epl) ? (epl as { min?: number; max?: number }) : null;
  const titleMatch = parseTitleMatch(filters);
  if (!titleMatch.ok) return titleMatch;
  return {
    ok: true,
    params: {
      ...(titles.length ? { job_titles: titles } : {}),
      ...(jobFunction && seniority.length ? { job_function: jobFunction, seniority } : {}),
      ...(bands.length > 0 ? { company_size: bands } : {}),
      ...(asStringArray(filters.countries).length ? { countries: asStringArray(filters.countries) } : {}),
      ...(asStringArray(filters.states).length ? { states: asStringArray(filters.states) } : {}),
      ...(cityList.length ? { cities: cityList } : {}),
      ...(fence ? { geo_fence: fence } : {}),
      ...(industries.values.length ? { industries: industries.values } : {}),
      ...(description ? { company_description: description } : {}),
      ...(purged.length ? { exclude_job_titles: purged } : {}),
      ...(emailStatus.length ? { email_status: emailStatus } : {}),
      ...(Number.isFinite(maxPer) && maxPer >= 1 ? { max_per_company: Math.floor(maxPer) } : {}),
      ...(eplObj && (eplObj.min != null || eplObj.max != null) ? { employee_profiles_on_linkedin: eplObj } : {}),
      ...(typeof filters.employee_profiles_on_linkedin_min === "number" ? { employee_profiles_on_linkedin_min: filters.employee_profiles_on_linkedin_min } : {}),
      ...(typeof filters.employee_profiles_on_linkedin_max === "number" ? { employee_profiles_on_linkedin_max: filters.employee_profiles_on_linkedin_max } : {}),
      title_match: titleMatch.value,
    },
  };
}

/**
 * Every filter that actually ran, including keys rewritten for the vendor
 * (titles → where_sql, industries_by_campaign → industries). Callers read
 * this instead of guessing from stamps or key formats (D95).
 */
export function filtersApplied(
  params: GetleadsCountParams,
  outbound: Record<string, unknown>,
  honored: Record<string, unknown> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...outbound, ...honored };
  if (params.job_titles?.length) out.job_titles = params.job_titles;
  if (params.exclude_job_titles?.length) out.exclude_job_titles = params.exclude_job_titles;
  if (params.title_match) out.title_match = params.title_match;
  if (params.company_description) out.company_description = params.company_description;
  if (params.industries?.length) out.industries = params.industries;
  if (params.company_size?.length) out.company_size = params.company_size;
  if (params.countries?.length) out.countries = params.countries;
  if (params.email_status?.length) {
    out.email_status_on_receipt = params.email_status;
    out.email_status_omitted = true;
  }
  return out;
}
