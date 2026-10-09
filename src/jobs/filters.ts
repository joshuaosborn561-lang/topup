import { geoFenceRef } from "../recipes/geoFence.js";
import { GETLEADS_BANDS, GETLEADS_EMAIL_STATUSES } from "../recipes/schema.js";

/**
 * getleads filters as a receipt stores them, read back into the vendor's
 * parameters. Nothing is invented: a missing person filter or a headcount
 * that is not a real band label makes the answer null, and the caller says
 * what is missing. BCP-style receipts keep industries per campaign under
 * industries_by_campaign; pass that campaign's list as industries.
 */
const BANDS = new Set<string>(GETLEADS_BANDS);
const EMAIL_STATUSES = new Set<string>(GETLEADS_EMAIL_STATUSES);

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


function industryNames(v: unknown): string[] {
  return asStringArray(v).filter((s) => !s.includes(",") && !/sibling industries|adjacent set/i.test(s));
}


export function getleadsParamsFromFilters(filters: Record<string, unknown>): {
  job_titles?: string[];
  job_function?: string;
  seniority?: string[];
  company_size?: Array<(typeof GETLEADS_BANDS)[number]>;
  countries?: string[];
  states?: string[];
  cities?: string[];
  industries?: string[];
  email_status?: Array<(typeof GETLEADS_EMAIL_STATUSES)[number]>;
  geo_fence?: { schema: string; table: string };
  max_per_company?: number;
} | null {
  const titles = asStringArray(filters.job_titles ?? filters.titles);
  const jobFunction = jobFunctionName(filters.job_function);
  const seniority = asStringArray(filters.seniority);
  if (titles.length === 0 && !(jobFunction && seniority.length)) return null;
  const namedBands = filters.company_size;
  const hasBandField = namedBands !== undefined && namedBands !== null && !(Array.isArray(namedBands) && namedBands.length === 0);
  const bands = validBands(namedBands);
  // A receipt that names a headcount and none of it is a real band is incomplete.
  // A receipt that names no headcount is counted with no band filter.
  if (hasBandField && bands.length === 0) return null;
  const industries = industryNames(filters.industries ?? filters.companyIndustry);
  const exportCaps = filters.export_caps && typeof filters.export_caps === "object" ? (filters.export_caps as Record<string, unknown>) : {};
  const maxPer = Number(filters.max_per_company ?? exportCaps.max_per_company);
  const cityList = asStringArray(filters.cities);
  const fence = cityList.length ? null : geoFenceRef(filters.cities);
  const emailStatus = asStringArray(filters.email_status)
    .map((status) => status.toUpperCase())
    .filter((status): status is (typeof GETLEADS_EMAIL_STATUSES)[number] => EMAIL_STATUSES.has(status));
  return {
    ...(titles.length ? { job_titles: titles } : {}),
    ...(jobFunction && seniority.length ? { job_function: jobFunction, seniority } : {}),
    ...(bands.length > 0 ? { company_size: bands } : {}),
    ...(asStringArray(filters.countries).length ? { countries: asStringArray(filters.countries) } : {}),
    ...(asStringArray(filters.states).length ? { states: asStringArray(filters.states) } : {}),
    ...(cityList.length ? { cities: cityList } : {}),
    ...(fence ? { geo_fence: fence } : {}),
    ...(industries.length ? { industries } : {}),
    ...(emailStatus.length ? { email_status: emailStatus } : {}),
    ...(Number.isFinite(maxPer) && maxPer >= 1 ? { max_per_company: Math.floor(maxPer) } : {}),
  };
}

