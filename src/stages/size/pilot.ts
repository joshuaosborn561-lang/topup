import type { GetleadsSource, Recipe } from "../../recipes/schema.js";
import { MSP_LINKEDIN_HEADCOUNT, MSP_REAL_PHRASES } from "../../recipes/powergryd.js";
import { parseCsv } from "../../lib/csv.js";
import { PILOT_GATE_PERCENT, PILOT_MAX_ROWS, PILOT_MIN_ROWS, PILOT_ROWS } from "../../policy/index.js";

/** Vendor sample size and gate from the policy layer (D46): 200 to 300 rows, nothing loaded, 80% on every scored dimension. */
export { PILOT_ROWS, PILOT_MIN_ROWS, PILOT_MAX_ROWS };
export const PILOT_GATE = PILOT_GATE_PERCENT;

export interface PilotRow {
  title: string;
  industry: string;
  description: string;
  company_size: string;
  employees: number | null;
  country: string;
  state: string;
  city: string;
}

export interface PilotExpect {
  titles?: string[];
  industries?: string[];
  description_phrases?: string[];
  bands?: string[];
  /** When set, a present LinkedIn count outside the window fails headcount. A missing count does not. */
  linkedin?: { min: number; max: number } | null;
  countries?: string[];
  states?: string[];
  cities?: string[];
}

export interface PilotCount {
  name: string;
  count: number;
}

/** Counts and percentages only. Never a lead row. */
export interface PilotScore {
  rows_scored: number;
  title_match: number | null;
  industry_match: number | null;
  description_match: number | null;
  headcount_match: number | null;
  geography_match: number | null;
  top_titles: PilotCount[];
  top_industries: PilotCount[];
  gate: "ok" | "pilot_mismatch";
  failed: string[];
}

const US = new Set(["united states", "united states of america", "usa", "us"]);

const BAND_RANGES: Array<{ label: string; min: number; max: number }> = [
  { label: "1 to 10", min: 1, max: 10 },
  { label: "11 to 50", min: 11, max: 50 },
  { label: "51 to 200", min: 51, max: 200 },
  { label: "201 to 500", min: 201, max: 500 },
  { label: "501 to 1000", min: 501, max: 1000 },
  { label: "1001 to 5000", min: 1001, max: 5000 },
  { label: "5001 to 10000", min: 5001, max: 10000 },
  { label: "10001+", min: 10001, max: Number.POSITIVE_INFINITY },
];

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function listed(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function percent(hits: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((hits / total) * 1000) / 10;
}

function phraseHit(text: string, phrase: string): boolean {
  const needle = phrase.trim();
  if (!needle || !text.trim()) return false;
  if (needle.length <= 4) return new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  return text.toLowerCase().includes(needle.toLowerCase());
}

/** getleads expands these to each other. A listed CEO matches Chief Executive Officer. */
const TITLE_TWINS: Readonly<Record<string, string>> = {
  ceo: "chief executive officer",
  cio: "chief information officer",
  cto: "chief technology officer",
  coo: "chief operating officer",
  cfo: "chief financial officer",
  ciso: "chief information security officer",
  vp: "vice president",
};

function titleVariants(title: string): string[] {
  const value = norm(title);
  if (!value) return [];
  const out = [value];
  const twin = TITLE_TWINS[value];
  if (twin) out.push(twin);
  for (const [short, long] of Object.entries(TITLE_TWINS)) {
    if (value === long) out.push(short);
  }
  return out;
}

function titleHit(title: string, allowed: string[]): boolean {
  const value = norm(title);
  if (!value) return false;
  return allowed.some((item) =>
    titleVariants(item).some((need) => {
      if (value === need) return true;
      return new RegExp(`(?:^| )${need.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(value);
    }),
  );
}

function industryHit(industry: string, allowed: string[]): boolean {
  const value = norm(industry);
  if (!value) return false;
  return allowed.some((item) => norm(item) === value);
}

/** "51 to 200", "51-200" and "51 – 200" are the same band. */
function bandKey(value: string): string {
  return norm(value).replace(/\bto\b/g, " ").replace(/\s+/g, " ").trim();
}

function bandHit(row: PilotRow, bands: string[]): boolean {
  const wanted = new Set(bands.map(bandKey));
  if (row.company_size.trim() && wanted.has(bandKey(row.company_size))) return true;
  if (row.employees == null) return false;
  return BAND_RANGES.some((band) => wanted.has(bandKey(band.label)) && row.employees! >= band.min && row.employees! <= band.max);
}

function headcountHit(row: PilotRow, expect: PilotExpect): boolean {
  const bands = listed(expect.bands);
  const inBand = bands.length === 0 ? true : bandHit(row, bands);
  if (!inBand) return false;
  if (!expect.linkedin || row.employees == null) return true;
  return row.employees >= expect.linkedin.min && row.employees <= expect.linkedin.max;
}

function countryHit(value: string, wanted: string): boolean {
  const got = norm(value);
  const need = norm(wanted);
  if (!got || !need) return false;
  if (US.has(need)) return US.has(got);
  return got === need;
}

function geoHit(row: PilotRow, expect: PilotExpect): boolean {
  const countries = listed(expect.countries);
  const states = listed(expect.states);
  const cities = listed(expect.cities);
  if (countries.length && !countries.some((country) => countryHit(row.country, country))) return false;
  if (states.length && !states.some((state) => norm(state) === norm(row.state))) return false;
  if (cities.length && !cities.some((city) => norm(city) === norm(row.city))) return false;
  return true;
}

function topCounts(values: string[]): PilotCount[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const name = value.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
}

function dimension(asked: boolean, hits: number, total: number): number | null {
  if (!asked) return null;
  return percent(hits, total);
}

/**
 * Score a vendor sample against the recipe. A dimension the recipe does not
 * name stays null and does not fail the gate. Under 80% on any scored
 * dimension is pilot_mismatch. The return value has no rows.
 */
/**
 * Which export columns were actually in the file. A missing column is not
 * scored (null) and does not fail the gate. Omit this when the rows were
 * built by hand and every asked field is present.
 */
export interface PilotFields {
  title: boolean;
  industry: boolean;
  description: boolean;
  headcount: boolean;
  country: boolean;
  state: boolean;
  city: boolean;
}

export function scorePilot(rows: readonly PilotRow[], expect: PilotExpect, fields?: PilotFields): PilotScore {
  const titles = listed(expect.titles);
  const industries = listed(expect.industries);
  const phrases = listed(expect.description_phrases);
  const bands = listed(expect.bands);
  const countries = listed(expect.countries);
  const states = listed(expect.states);
  const cities = listed(expect.cities);
  const askTitle = titles.length > 0;
  const askIndustry = industries.length > 0;
  const askDescription = phrases.length > 0;
  const askHeadcount = bands.length > 0 || Boolean(expect.linkedin);
  const askGeo = countries.length > 0 || states.length > 0 || cities.length > 0;
  let titleHits = 0;
  let industryHits = 0;
  let descriptionHits = 0;
  let headcountHits = 0;
  let geoHits = 0;
  for (const row of rows) {
    if (askTitle && titleHit(row.title, titles)) titleHits += 1;
    if (askIndustry && industryHit(row.industry, industries)) industryHits += 1;
    if (askDescription && phrases.some((phrase) => phraseHit(row.description, phrase))) descriptionHits += 1;
    if (askHeadcount && headcountHit(row, expect)) headcountHits += 1;
    if (askGeo && geoHit(row, expect)) geoHits += 1;
  }
  const total = rows.length;
  const present = fields ?? { title: true, industry: true, description: true, headcount: true, country: true, state: true, city: true };
  const geoReadable =
    (countries.length === 0 || present.country) && (states.length === 0 || present.state) && (cities.length === 0 || present.city);
  const score: PilotScore = {
    rows_scored: total,
    title_match: askTitle && !present.title ? null : dimension(askTitle, titleHits, total),
    industry_match: askIndustry && !present.industry ? null : dimension(askIndustry, industryHits, total),
    description_match: askDescription && !present.description ? null : dimension(askDescription, descriptionHits, total),
    headcount_match: askHeadcount && !present.headcount ? null : dimension(askHeadcount, headcountHits, total),
    geography_match: askGeo && !geoReadable ? null : dimension(askGeo, geoHits, total),
    top_titles: topCounts(rows.map((row) => row.title)),
    top_industries: topCounts(rows.map((row) => row.industry)),
    gate: "ok",
    failed: [],
  };
  const checks: Array<[string, number | null]> = [
    ["title", score.title_match],
    ["industry", score.industry_match],
    ["description", score.description_match],
    ["headcount", score.headcount_match],
    ["geography", score.geography_match],
  ];
  for (const [name, value] of checks) {
    if (value != null && value < PILOT_GATE) score.failed.push(name);
  }
  score.gate = score.failed.length ? "pilot_mismatch" : "ok";
  return score;
}

export function pilotAllowsSize(score: PilotScore): boolean {
  return score.gate === "ok";
}

export function pilotMismatchReason(campaignId: number, score: PilotScore): string | null {
  if (score.gate === "ok") return null;
  const bits = score.failed.map((name) => {
    const value = score[`${name}_match` as "title_match"];
    return `${name} ${value}%`;
  });
  return `pilot_mismatch: #${campaignId} ${bits.join(", ")} under ${PILOT_GATE}% (${score.rows_scored} scored)`;
}

export function splitDescriptionPhrases(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

/** What the pilot scores. PowerGRYD MSP owners use the tighter MSP phrases, not every query phrase. */
export function pilotExpectFor(clientTag: string, lane: string, params: GetleadsSource["params"]): PilotExpect {
  const msp = clientTag === "powergryd" && lane === "msp_owners";
  return {
    titles: params.job_titles ? [...params.job_titles] : [],
    industries: params.industries ? [...params.industries] : [],
    description_phrases: msp ? [...MSP_REAL_PHRASES] : splitDescriptionPhrases(params.company_description),
    bands: params.company_size ? [...params.company_size] : [],
    linkedin: msp ? { ...MSP_LINKEDIN_HEADCOUNT } : null,
    countries: params.countries ? [...params.countries] : [],
    states: params.states ? [...params.states] : [],
    cities: params.cities ? [...params.cities] : [],
  };
}

/** Canonical names from the rebuilt contact file, then the previous names. */
const TITLE_COLS = ["current_title", "job_title", "title", "headline"];
const INDUSTRY_COLS = ["company_industry", "industry", "companyindustry", "current_company_industry"];
const DESCRIPTION_COLS = ["company_description", "description", "about", "company_about", "co_description"];
const SIZE_COLS = ["employee_count_range", "company_size", "employee_range", "company_headcount"];
const EMPLOYEE_COLS = ["employee_profiles_on_linkedin", "linkedin_employees", "employees_on_linkedin", "employees"];
const COUNTRY_COLS = ["contact_country", "company_hq_country", "country", "company_country", "person_country_name"];
const STATE_COLS = ["contact_state", "state", "company_state", "state_name"];
const CITY_COLS = ["contact_city", "city", "company_city", "company_hq_city", "person_city"];

/** Columns a pilot export asks for so title, headcount and country are in the file. No email. */
export const PILOT_EXPORT_COLUMNS = [
  "current_title",
  "employee_count_range",
  "contact_country",
  "company_hq_country",
  "company_industry",
  "company_description",
  "contact_state",
  "contact_city",
];

function headerKey(name: string): string {
  return name.toLowerCase().replace(/[\s-]+/g, "_");
}

function cell(row: Record<string, string>, names: string[]): string {
  const keys = Object.keys(row);
  for (const name of names) {
    const key = keys.find((item) => headerKey(item) === name);
    if (key !== undefined) return (row[key] ?? "").trim();
  }
  return "";
}

function headersOf(records: readonly Record<string, string>[]): Set<string> {
  const names = new Set<string>();
  for (const row of records) {
    for (const key of Object.keys(row)) names.add(headerKey(key));
  }
  return names;
}

function hasHeader(names: Set<string>, aliases: readonly string[]): boolean {
  return aliases.some((alias) => names.has(alias));
}

/** A dimension is present only when its export column is in the file. */
export function pilotFieldsFromRecords(records: readonly Record<string, string>[]): PilotFields {
  const names = headersOf(records);
  return {
    title: hasHeader(names, TITLE_COLS),
    industry: hasHeader(names, INDUSTRY_COLS),
    description: hasHeader(names, DESCRIPTION_COLS),
    headcount: hasHeader(names, SIZE_COLS) || hasHeader(names, EMPLOYEE_COLS),
    country: hasHeader(names, COUNTRY_COLS),
    state: hasHeader(names, STATE_COLS),
    city: hasHeader(names, CITY_COLS),
  };
}

function employeesOf(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Keep the columns the scorer needs. Drop email and every other column. */
export function pilotRowsFromRecords(records: readonly Record<string, string>[]): PilotRow[] {
  return records.map((row) => ({
    title: cell(row, TITLE_COLS),
    industry: cell(row, INDUSTRY_COLS),
    description: cell(row, DESCRIPTION_COLS),
    company_size: cell(row, SIZE_COLS),
    employees: employeesOf(cell(row, EMPLOYEE_COLS)),
    country: cell(row, COUNTRY_COLS),
    state: cell(row, STATE_COLS),
    city: cell(row, CITY_COLS),
  }));
}

export function pilotRowsFromCsv(text: string): PilotRow[] {
  return pilotRowsFromRecords(parseCsv(text));
}

export function pilotSampleFromCsv(text: string): { rows: PilotRow[]; fields: PilotFields } {
  const records = parseCsv(text);
  return { rows: pilotRowsFromRecords(records), fields: pilotFieldsFromRecords(records) };
}

/** Stable filter identity. A change since the last good size run is what starts a pilot. */
export function recipeFingerprint(recipe: Recipe): string {
  return recipe.routing
    .map((rule) => {
      const src = rule.source ?? recipe.source;
      if (src.kind !== "getleads") return `${rule.campaign_id}:${src.kind}`;
      const params = src.params;
      return JSON.stringify({
        id: rule.campaign_id,
        titles: params.job_titles ?? [],
        job_function: params.job_function ?? "",
        seniority: params.seniority ?? [],
        industries: params.industries ?? [],
        description: params.company_description ?? "",
        bands: params.company_size ?? [],
        countries: params.countries ?? [],
        states: params.states ?? [],
        cities: params.cities ?? [],
      });
    })
    .join("|");
}
