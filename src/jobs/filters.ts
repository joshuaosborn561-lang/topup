import { mapGetleadsIndustry } from "./getleadsIndustries.js";
import { geoFenceRef } from "../recipes/geoFence.js";
import { GETLEADS_BANDS, GETLEADS_EMAIL_STATUSES } from "../recipes/schema.js";

/**
 * getleads filters as a receipt stores them, read back into the vendor's
 * parameters (D74). Every stored key is mapped or the parse fails. BCP-style
 * receipts keep industries per campaign under industries_by_campaign; pass
 * that campaign's list as industries — do not hand the parent object through.
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
] as const;

const KNOWN = new Set<string>(GETLEADS_STORED_KEYS);

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

function mapIndustries(v: unknown): { ok: true; values: string[] } | { ok: false; error: string } {
  const raw = asStringArray(v);
  if (raw.length === 0) return { ok: true, values: [] };
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of raw) {
    if (/sibling industries|adjacent set/i.test(name)) {
      return { ok: false, error: `industry ${JSON.stringify(name)} is a note, not a getleads industry. Ask Josh.` };
    }
    const mapped = mapGetleadsIndustry(name);
    if (!mapped.ok) return mapped;
    if (seen.has(mapped.value)) continue;
    seen.add(mapped.value);
    out.push(mapped.value);
  }
  return { ok: true, values: out };
}

export function getleadsParamsFromFilters(filters: Record<string, unknown>): GetleadsFilterParse {
  const extra = unknownKeys(filters);
  if (extra.length) {
    const hint = extra.includes("industries_by_campaign")
      ? " Pass that campaign's list as industries."
      : "";
    return {
      ok: false,
      error: `unmapped getleads filter keys: ${extra.join(", ")}. Every stored key must map to the getleads API (D74).${hint} Ask Josh.`,
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
    },
  };
}
