import type { Source } from "../recipes/schema.js";

/**
 * One row of the per-campaign report a run carries on its steps. Counts and
 * words only. Never a lead. The service fills what it measured; Grok reads
 * it through `job`. No verdict is derived here (D53).
 */
export interface CampaignReportEntry {
  campaign_id: number;
  campaign_name: string;
  found: number | null;
  to_add: number;
  source: string;
  titles: string;
  filters: string;
  tam_total: number | null;
  tam_left: number | null;
  reply_rate: string;
  gate: string;
  gate_reason?: string;
  strategy: string;
  [extra: string]: unknown;
}

export const COMPANY_FILTER_REASON = "recipe has no company filter";

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
  if (source.kind === "getleads") {
    if (source.params.industries?.length) parts.push(`industries ${source.params.industries.join(", ")}`);
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

export function replyRateText(sends: number, interested: number, tooEarly = false): string {
  if (tooEarly) return `too early to judge (${interested} interested in ${sends} sends)`;
  const rate = sends === 0 ? 0 : (interested / sends) * 2000;
  return `${rate.toFixed(1)} per 2,000 (${interested} interested in ${sends} sends)`;
}

export function formatCampaignReport(rows: readonly CampaignReportEntry[]): string {
  return rows
    .map(
      (row) =>
        `#${row.campaign_id} ${row.campaign_name}: found ${row.found ?? "not sized"}, to add ${row.to_add}, source ${row.source}, titles ${row.titles}, filters ${row.filters}, TAM ${row.tam_total ?? "not sized"}, left ${row.tam_left ?? "not sized"}, replies ${row.reply_rate}, gate ${row.gate}.` +
        (row.gate !== "ok" && row.gate_reason ? ` ${row.gate_reason}` : "") +
        ` ${row.strategy}`,
    )
    .join("\n");
}

export function campaignReportFromCounts(counts: Record<string, unknown> | null | undefined): CampaignReportEntry[] {
  const raw = counts?.campaign_report;
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is CampaignReportEntry => !!row && typeof row === "object" && typeof (row as CampaignReportEntry).campaign_id === "number");
}
