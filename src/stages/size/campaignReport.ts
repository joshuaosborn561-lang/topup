import type { Source } from "../../recipes/schema.js";
import type { PilotScore } from "./pilot.js";

/** One row of the per-campaign report. Counts and words only. Never a lead. */
export interface CampaignReportEntry {
  campaign_id: number;
  campaign_name: string;
  found: number;
  to_add: number;
  source: string;
  titles: string;
  filters: string;
  tam_total: number;
  tam_left: number;
  reply_rate: string;
  gate: "ok" | "under_reply_bar" | "tam_filled" | "paused" | "suspect_filter";
  strategy: string;
  tam_source?: string;
  tam_check?: "ok" | "tam_mismatch" | "tam_source_missing";
  getleads_count?: number | null;
  ai_ark_count?: number | null;
  pilot?: PilotScore;
}

export const TAM_LEFT_FLOOR = 1000;
export const SUSPECT_BUILD_MULTIPLE = 20;
/** About 40k MSPs in the US. A people count above this is not that market. */
export const MSP_MARKET_CAP = 40_000;
/** Below the low thousands is the 71-row exact-phrase miss, not the MSP market. */
export const MSP_MARKET_FLOOR = 1_000;

export const COMPANY_FILTER_REASON = "recipe has no company filter";

/** Insight OEM Channel Reps and Insight Google SADA stay paused. */
const PAUSED_LABELS = [/oem channel reps/i, /google sada/i];

export function isPausedLabel(text: string | null | undefined): boolean {
  const value = (text ?? "").replace(/_/g, " ").trim();
  if (!value) return false;
  return PAUSED_LABELS.some((re) => re.test(value));
}

export function marketCapFor(lane: string, sourceText: string): number | null {
  const blob = `${lane} ${sourceText}`.toLowerCase();
  if (/\bmsp\b|managed service/.test(blob)) return MSP_MARKET_CAP;
  return null;
}

export function isSuspectFilter(tamTotal: number, rowsFound: number | null, marketCap: number | null): boolean {
  if (rowsFound != null && rowsFound > 0 && tamTotal > rowsFound * SUSPECT_BUILD_MULTIPLE) return true;
  if (marketCap != null && tamTotal > marketCap) return true;
  if (marketCap === MSP_MARKET_CAP && tamTotal > 0 && tamTotal < MSP_MARKET_FLOOR) return true;
  return false;
}

export function sourceWords(source: Source): string {
  if (source.kind === "getleads") {
    const params = source.params as { company_description?: string; industries?: string[] };
    const bits = ["getleads people search"];
    if (params.company_description) bits.push(params.company_description);
    if (params.industries?.length) bits.push(params.industries.join(", "));
    return bits.join(", ");
  }
  if (source.kind === "maps") return "Google Maps";
  if (source.kind === "permits") return "permit counts";
  if (source.kind === "mixed") return source.parts.length ? source.note : COMPANY_FILTER_REASON;
  if (source.kind === "supabase_table") return `table ${source.table}`;
  return source.kind;
}

export function titlesWords(source: Source, persona: string): string {
  if (source.kind === "getleads" && source.params.job_titles?.length) return source.params.job_titles.join(", ");
  if (source.kind === "getleads" && source.params.job_function) {
    const seniority = source.params.seniority?.join(", ");
    return seniority ? `${source.params.job_function} (${seniority})` : source.params.job_function;
  }
  if (source.kind === "ai_ark" && source.params.titles.length) return source.params.titles.join(", ");
  return persona || "persona not set";
}

export function filtersWords(source: Source): string {
  if (source.kind !== "getleads" && source.kind !== "maps" && source.kind !== "permits" && source.kind !== "ai_ark") {
    return source.kind === "mixed" && source.parts.length === 0 ? COMPANY_FILTER_REASON : source.kind;
  }
  const parts: string[] = [];
  if (source.kind === "getleads" || source.kind === "maps") {
    const industries = source.kind === "getleads" ? source.params.industries : undefined;
    if (industries?.length) parts.push(`industries ${industries.join(", ")}`);
  }
  if (source.kind === "getleads") {
    if (source.params.job_function) parts.push(`job function ${source.params.job_function}`);
    if (source.params.seniority?.length) parts.push(`seniority ${source.params.seniority.join(", ")}`);
    if (source.params.company_description) parts.push(`description ${source.params.company_description}`);
    if (source.params.company_size?.length) parts.push(`company size ${source.params.company_size.join(", ")}`);
    if (source.params.email_status?.length) parts.push(`email ${source.params.email_status.join(", ")}`);
    if (source.params.geo_fence) parts.push(`geography ${source.params.geo_fence.schema}.${source.params.geo_fence.table}`);
    else if (source.params.states?.length) parts.push(`geography ${source.params.states.join(", ")}`);
    else if (source.params.cities?.length) parts.push(`geography ${source.params.cities.join(", ")}`);
    else if (source.params.countries?.length) parts.push(`geography ${source.params.countries.join(", ")}`);
  }
  if (source.kind === "maps") {
    if (source.params.states?.length) parts.push(`geography ${source.params.states.join(", ")}`);
    else if (source.params.cities?.length) parts.push(`geography ${source.params.cities.join(", ")}`);
    if (source.params.categories?.length) parts.push(`categories ${source.params.categories.join(", ")}`);
  }
  if (source.kind === "permits") {
    if (source.params.states?.length) parts.push(`geography ${source.params.states.join(", ")}`);
    if (source.params.permit_types?.length) parts.push(`permit types ${source.params.permit_types.join(", ")}`);
  }
  if (source.kind === "ai_ark" && source.params.locations?.length) parts.push(`geography ${source.params.locations.join(", ")}`);
  return parts.join("; ") || "no company filter";
}

export interface CampaignReportInput {
  campaign_id: number;
  campaign_name: string;
  found: number;
  to_add: number;
  source: string;
  titles: string;
  filters: string;
  tam_total: number;
  tam_left: number;
  sends: number;
  interested: number;
  /** Sends are under the volume floor. "Too early to judge" does not clear the bar. */
  too_early: boolean;
  paused: boolean;
  rows_found: number | null;
  market_cap: number | null;
  strategy: string;
  /** Pilot passed and TAM was not counted. The gate stays ok. */
  pilot_only?: boolean;
  tam_source?: string;
  tam_check?: CampaignReportEntry["tam_check"];
  getleads_count?: number | null;
  ai_ark_count?: number | null;
  pilot?: PilotScore;
}

export function replyRateText(sends: number, interested: number, tooEarly: boolean): string {
  if (tooEarly) return `too early to judge (${interested} interested in ${sends} sends)`;
  const rate = sends === 0 ? 0 : (interested / sends) * 2000;
  return `${rate.toFixed(1)} per 2,000 (${interested} interested in ${sends} sends)`;
}

export function campaignGate(input: Pick<CampaignReportInput, "paused" | "tam_total" | "tam_left" | "sends" | "interested" | "too_early" | "rows_found" | "market_cap" | "pilot_only">): CampaignReportEntry["gate"] {
  if (input.paused) return "paused";
  if (input.pilot_only) return "ok";
  if (isSuspectFilter(input.tam_total, input.rows_found, input.market_cap)) return "suspect_filter";
  if (input.tam_left < TAM_LEFT_FLOOR) return "tam_filled";
  const rate = input.sends === 0 ? 0 : (input.interested / input.sends) * 2000;
  if (input.too_early || rate < 1) return "under_reply_bar";
  return "ok";
}

export function buildCampaignReport(rows: readonly CampaignReportInput[]): CampaignReportEntry[] {
  return rows.map((row) => ({
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name || `campaign ${row.campaign_id}`,
    found: row.found,
    to_add: row.to_add,
    source: row.source || "source not set",
    titles: row.titles || "persona not set",
    filters: row.filters || "no company filter",
    tam_total: row.tam_total,
    tam_left: row.tam_left,
    reply_rate: replyRateText(row.sends, row.interested, row.too_early),
    gate: campaignGate(row),
    strategy: row.strategy || "Repeats the saved recipe.",
    ...(row.tam_source ? { tam_source: row.tam_source } : {}),
    ...(row.tam_check ? { tam_check: row.tam_check } : {}),
    ...(row.getleads_count !== undefined ? { getleads_count: row.getleads_count } : {}),
    ...(row.ai_ark_count !== undefined ? { ai_ark_count: row.ai_ark_count } : {}),
    ...(row.pilot ? { pilot: row.pilot } : {}),
  }));
}

export function suspectReason(rows: readonly CampaignReportEntry[]): string | null {
  const bad = rows.filter((row) => row.gate === "suspect_filter");
  if (bad.length === 0) return null;
  return bad
    .map((row) => `suspect_filter: #${row.campaign_id} TAM ${row.tam_total} is more than ${SUSPECT_BUILD_MULTIPLE}× the source build or above the known market cap`)
    .join("; ");
}

export function formatCampaignReport(rows: readonly CampaignReportEntry[]): string {
  return rows
    .map(
      (row) =>
        [
          `#${row.campaign_id} ${row.campaign_name}: found ${row.found}, to add ${row.to_add}, source ${row.source}, titles ${row.titles}, filters ${row.filters}, TAM ${row.tam_total}, left ${row.tam_left}, replies ${row.reply_rate}, gate ${row.gate}.`,
          row.tam_source ? ` TAM source ${row.tam_source}.` : "",
          row.tam_check ? ` tam_check ${row.tam_check}.` : "",
          row.getleads_count != null ? ` getleads ${row.getleads_count}.` : "",
          row.ai_ark_count != null ? ` AI Ark ${row.ai_ark_count}.` : row.tam_check === "tam_mismatch" && row.ai_ark_count === null ? " AI Ark not wired." : "",
          row.pilot
            ? ` Pilot ${row.pilot.rows_scored} scored, title ${row.pilot.title_match ?? "n/a"}%, industry ${row.pilot.industry_match ?? "n/a"}%, description ${row.pilot.description_match ?? "n/a"}%, headcount ${row.pilot.headcount_match ?? "n/a"}%, geography ${row.pilot.geography_match ?? "n/a"}%, gate ${row.pilot.gate}.`
            : "",
          ` ${row.strategy}`,
        ].join(""),
    )
    .join("\n");
}

export function campaignReportFromCounts(counts: Record<string, unknown> | null | undefined): CampaignReportEntry[] {
  const raw = counts?.campaign_report;
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is CampaignReportEntry => !!row && typeof row === "object" && typeof (row as CampaignReportEntry).campaign_id === "number");
}

export function rowsFoundFromBuilds(rows: readonly Record<string, unknown>[], campaignId: number): { rows_found: number | null; build_label: string | null } {
  const matched = rows.filter((row) => Number(row.smartlead_campaign_id ?? row.campaign_id) === campaignId);
  const withFound = matched.filter((row) => row.rows_found != null && Number(row.rows_found) > 0);
  const pool = withFound.length ? withFound : matched;
  pool.sort((a, b) => String(b.written_at ?? b.pulled_at ?? "").localeCompare(String(a.written_at ?? a.pulled_at ?? "")));
  const top = pool[0];
  if (!top) return { rows_found: null, build_label: null };
  const found = top.rows_found == null ? null : Number(top.rows_found);
  return {
    rows_found: found != null && Number.isFinite(found) && found > 0 ? found : null,
    build_label: top.build_label == null ? null : String(top.build_label),
  };
}

const REPORT_FIELDS = ["campaign_id", "campaign_name", "found", "to_add", "source", "titles", "filters", "tam_total", "tam_left", "reply_rate", "gate", "strategy"] as const;

export function reportFieldsFilled(row: CampaignReportEntry): boolean {
  return REPORT_FIELDS.every((key) => {
    const value = row[key];
    if (typeof value === "number") return Number.isFinite(value);
    return typeof value === "string" && value.trim().length > 0;
  });
}
