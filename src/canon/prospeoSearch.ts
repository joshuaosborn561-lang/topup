import type { GetleadsFilters } from "../clients/getleads.js";
import { GETLEADS_BANDS } from "../recipes/schema.js";
import { mapProspeoIndustries, type ProspeoIndustryMapping } from "../jobs/prospeoIndustries.js";

/**
 * Prospeo search-person count (D83). Page 1 is 1 credit and returns
 * `pagination.total_count`. No-result and 30-day repeat searches are
 * free. The page of people is dropped and never returned.
 */
export const PROSPEO_SEARCH_URL = "https://api.prospeo.io/search-person";

export const PROSPEO_API_KEY_MISSING =
  "PROSPEO_API_KEY is not set. No request was sent. Endpoint POST https://api.prospeo.io/search-person. Header X-KEY.";

/** getleads closed bands → Prospeo `company_headcount_range` labels (filters-documentation). */
const HEADCOUNT: Readonly<Record<(typeof GETLEADS_BANDS)[number], readonly string[]>> = {
  "1 to 10": ["1-10"],
  "11 to 50": ["11-20", "21-50"],
  "51 to 200": ["51-100", "101-200"],
  "201 to 500": ["201-500"],
  "501 to 1000": ["501-1000"],
  "1001 to 5000": ["1001-2000", "2001-5000"],
  "5001 to 10000": ["5001-10000"],
  "10001+": ["10000+"],
};

const SENIORITY: Readonly<Record<string, string>> = {
  "c-team": "C-Suite",
  "c team": "C-Suite",
  "c-suite": "C-Suite",
  c_suite: "C-Suite",
  vp: "Vice President",
  "vice president": "Vice President",
  director: "Director",
  head: "Head",
  manager: "Manager",
  founder: "Founder/Owner",
  owner: "Founder/Owner",
  "founder/owner": "Founder/Owner",
  partner: "Partner",
  senior: "Senior",
  entry: "Entry",
  "entry-level": "Entry",
  intern: "Intern",
};

export type SearchPersonFilters = Record<string, unknown>;

export type SearchPersonBuild =
  | { ok: true; filters: SearchPersonFilters; industry_mappings: ProspeoIndustryMapping[]; filters_used: Record<string, unknown> }
  | { ok: false; reason: string; industry_mappings: ProspeoIndustryMapping[] };

export interface ProspeoCountResult {
  total_matching: number;
  /** True when Prospeo charged nothing (no results, or a 30-day repeat). */
  free: boolean;
}

export interface ProspeoSearch {
  count(filters: GetleadsFilters, rawIndustries?: readonly string[]): Promise<ProspeoCountResult>;
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

/**
 * The search-person filter body for these getleads-shaped filters.
 * Titles default to EXACT (D82). Industries are mapped to Prospeo's
 * official names; inexact and unmatched names are flagged, not invented.
 */
export function searchPersonBody(filters: GetleadsFilters, rawIndustries?: readonly string[]): SearchPersonBuild {
  if (filters.geo_fence) {
    return { ok: false, reason: "Prospeo search-person is not called for a geo fence; the city list is not on this filter", industry_mappings: [] };
  }
  const titles = asStrings(filters.job_titles);
  const seniority = asStrings(filters.seniority);
  if (titles.length === 0 && seniority.length === 0) {
    return { ok: false, reason: "prospeo count needs job_titles, or job_function plus seniority.", industry_mappings: [] };
  }

  const industryInputs = (rawIndustries && rawIndustries.length ? [...rawIndustries] : asStrings(filters.industries)).map((s) => s.trim()).filter(Boolean);
  const industry_mappings = mapProspeoIndustries(industryInputs);
  const mappedIndustries = [...new Set(industry_mappings.map((m) => m.prospeo).filter((v): v is string => Boolean(v)))];
  if (industryInputs.length > 0 && mappedIndustries.length === 0) {
    return {
      ok: false,
      reason: "none of the industries map to a Prospeo official name; sending the search would drop the industry filter. Ask Josh.",
      industry_mappings,
    };
  }

  const body: SearchPersonFilters = {};
  const used: Record<string, unknown> = {};

  if (titles.length) {
    const matchMode = filters.title_match === "substring" ? "CONTAINS" : "EXACT";
    const titleFilter: Record<string, unknown> = { include: [...titles], match_mode: matchMode };
    const purged = asStrings(filters.exclude_job_titles);
    if (purged.length) titleFilter.exclude = purged;
    body.person_job_title = titleFilter;
    used.job_titles = titles;
    used.title_match = filters.title_match === "substring" ? "substring" : "exact";
    if (purged.length) used.exclude_job_titles = purged;
  }

  if (seniority.length) {
    const include: string[] = [];
    for (const label of seniority) {
      const mapped = SENIORITY[label.trim().toLowerCase()];
      if (!mapped) {
        return { ok: false, reason: `seniority ${label} is not a Prospeo seniority value`, industry_mappings };
      }
      include.push(mapped);
    }
    body.person_seniority = { include };
    used.seniority = include;
  }

  if (mappedIndustries.length) {
    body.company_industry = { include: mappedIndustries };
    used.industries = mappedIndustries;
  }

  const ranges: string[] = [];
  for (const band of filters.company_size ?? []) {
    const mapped = HEADCOUNT[band];
    if (!mapped) return { ok: false, reason: `headcount band ${band} has no Prospeo company_headcount_range`, industry_mappings };
    ranges.push(...mapped);
  }
  if (ranges.length) {
    body.company_headcount_range = [...new Set(ranges)];
    used.company_headcount_range = body.company_headcount_range;
  }

  const locations = [...asStrings(filters.cities), ...asStrings(filters.states), ...asStrings(filters.countries)];
  if (locations.length) {
    body.person_location_search = { include: locations };
    used.locations = locations;
  }

  return { ok: true, filters: body, industry_mappings, filters_used: used };
}

function errorDetail(text: string): string {
  const clipped = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]").slice(0, 400);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const bits = ["error_code", "filter_error", "error", "message"].flatMap((key) =>
      parsed[key] == null || parsed[key] === true || parsed[key] === false ? [] : [`${key}: ${String(parsed[key]).slice(0, 160)}`],
    );
    return bits.join("; ") || clipped;
  } catch {
    return clipped;
  }
}

export class ProspeoSearchClient implements ProspeoSearch {
  constructor(
    private readonly key: string,
    private readonly url = PROSPEO_SEARCH_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async count(filters: GetleadsFilters, rawIndustries?: readonly string[]): Promise<ProspeoCountResult> {
    if (!this.key) throw new Error(PROSPEO_API_KEY_MISSING);
    const built = searchPersonBody(filters, rawIndustries);
    if (!built.ok) throw new Error(built.reason);
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-KEY": this.key },
      body: JSON.stringify({ page: 1, filters: built.filters }),
    });
    const text = await res.text();
    let json: { error?: unknown; error_code?: unknown; free?: unknown; pagination?: { total_count?: unknown } };
    try {
      json = JSON.parse(text) as typeof json;
    } catch {
      throw new Error(`HTTP ${res.status} from ${this.url}: response was not JSON`);
    }
    if (json.error_code === "NO_RESULTS") return { total_matching: 0, free: true };
    if (json.error === true || !res.ok) throw new Error(`HTTP ${res.status} from ${this.url}: ${errorDetail(text)}`);
    const total = Number(json.pagination?.total_count);
    if (!Number.isFinite(total)) {
      const keys = Object.keys(json).slice(0, 12).join(", ") || "none";
      throw new Error(`HTTP ${res.status} from ${this.url}: no pagination.total_count. Keys: ${keys}`);
    }
    return { total_matching: total, free: json.free === true };
  }
}
