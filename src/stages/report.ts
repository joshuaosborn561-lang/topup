import type { PoolSource } from "../jobs/settings.js";

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

export function sourceWords(source: PoolSource): string {
  if (source.kind === "file_url") return `${source.urls.length} file(s) handed over by Grokbot`;
  return `table ${source.table}`;
}

export function titlesWords(_source: PoolSource, persona: string): string {
  return persona || "as the transcript says";
}

export function filtersWords(source: PoolSource): string {
  if (source.kind === "table") return source.where && source.where !== "true" ? `where ${source.where}` : "the whole table";
  return "as the transcript says";
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
