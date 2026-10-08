import type { CampaignReportEntry } from "../stages/size/campaignReport.js";

/**
 * Josh's approval briefing: one line per campaign, in plain words (brief §2
 * and §5). It is generated from the report so it cannot say something the
 * report does not. Counts, ids, dollars and the build it repeats. Never a
 * lead.
 */
export interface BriefingInput {
  clientTag: string;
  lane: string;
  runId: string;
  rows: readonly CampaignReportEntry[];
  loadsPaused: boolean;
  worstCaseUsd: number | null;
}

export function approvalBriefing(input: BriefingInput): string {
  const ok = input.rows.filter((r) => r.gate === "ok");
  const toLoad = ok.reduce((n, r) => n + r.to_add, 0);
  const head = [
    `Top-up approval, ${input.clientTag}/${input.lane}, run ${input.runId.slice(0, 8)}.`,
    `${ok.length} of ${input.rows.length} campaign(s) qualify; ${toLoad} leads to load.`,
    input.worstCaseUsd == null ? "Spend: counts only, $0.00." : `Spend worst case $${input.worstCaseUsd.toFixed(2)}.`,
    input.loadsPaused ? "Loads are paused: nothing reaches Smartlead until Cayden lifts the pause, even after approval." : "Loads are open: approval loads these campaigns.",
  ].join(" ");
  const lines = input.rows.map((r) => {
    if (r.gate === "ok") {
      const counts = r.getleads_count != null || r.ai_ark_count != null ? ` (getleads ${r.getleads_count ?? "n/a"}, AI Ark ${r.ai_ark_count ?? "n/a"}, ${r.tam_check ?? "single_source"})` : "";
      return `• #${r.campaign_id} ${r.campaign_name}: add ${r.to_add}. TAM ${r.tam_total ?? "n/a"}, left ${r.tam_left ?? "n/a"}${counts}. Replies ${r.reply_rate}. ${r.strategy}`;
    }
    return `• #${r.campaign_id} ${r.campaign_name}: not loading, ${r.gate}. ${r.gate_reason ?? ""}`.trim();
  });
  return [head, ...lines].join("\n");
}
