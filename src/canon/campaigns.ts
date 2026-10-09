import { campaignPerformance } from "../builds/load.js";
import type { Queryable } from "../db/pool.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots } from "../ledger/health.js";
import { loadClientMap } from "./clients.js";
import { isNeverTopUp, ratePer2000, REPLY_BAR_PER_2000 } from "../policy/rules.js";
import { registryRows } from "./registry.js";

/**
 * Every campaign, with the numbers Grok picks on (D52): lifetime sends and
 * positive replies, the rate per 2,000, what is left to send, and whether the
 * reply bar is met. No other judgement. Counts and ids only.
 */
export interface CampaignLine {
  client_tag: string;
  smartlead_client_id: number;
  campaign_id: number;
  name: string | null;
  status: string | null;
  lane: string | null;
  sends: number;
  positives: number;
  rate_per_2000: number;
  passes_reply_bar: boolean;
  leads_total: number;
  untouched: number;
  sends_last_14d: number;
  runway_days: number | null;
  last_send_at: string | null;
  never_top_up: boolean;
}

export interface CampaignsRead {
  rule: string;
  clients: string[];
  counts: { campaigns: number; passing_reply_bar: number; passing_and_under_1000_untouched: number; never_top_up: number };
  campaigns: CampaignLine[];
}

export const REPLY_BAR_RULE = `A campaign qualifies for a top-up with at least ${REPLY_BAR_PER_2000} positive reply per 2,000 sends, lifetime. Zero positives never qualifies. Under 1,000 leads available on its query, the TAM for this campaign is exhausted.`;

export async function listCampaigns(
  db: Queryable,
  repo: { campaignRegistry(clientTag?: string): Promise<Record<string, unknown>[]> },
  clientTag?: string | null,
  opts: { include_inactive?: boolean } = {},
): Promise<CampaignsRead | { error: string }> {
  const mapped = await loadClientMap(db).catch(() => []);
  const clients = clientTag ? mapped.filter((c) => c.client_tag === clientTag) : mapped;
  if (clientTag && clients.length === 0) return { error: `${clientTag} is not in topup.client_map. Adding a client is a row in that table. Ask Josh.` };

  const out: CampaignLine[] = [];
  for (const client of clients) {
    const ids = await campaignIdsForClient(db, client.smartlead_client_id, !opts.include_inactive).catch(() => [] as number[]);
    if (ids.length === 0) continue;
    const [snaps, perf, registry] = await Promise.all([
      campaignSnapshots(db, ids),
      campaignPerformance(db, ids).catch(() => new Map()),
      repo.campaignRegistry(client.client_tag).catch(() => [] as Record<string, unknown>[]),
    ]);
    const lanes = new Map(registryRows(registry).map((r) => [r.campaign_id, r.lane] as const));
    for (const snap of snaps) {
      const h = assessCampaign(snap);
      const p = perf.get(snap.smartlead_campaign_id) ?? { sends: 0, positives: 0 };
      const rate = Math.round(ratePer2000(p.sends, p.positives) * 100) / 100;
      out.push({
        client_tag: client.client_tag,
        smartlead_client_id: client.smartlead_client_id,
        campaign_id: snap.smartlead_campaign_id,
        name: snap.name,
        status: snap.status,
        lane: lanes.get(snap.smartlead_campaign_id) ?? null,
        sends: p.sends,
        positives: p.positives,
        rate_per_2000: rate,
        passes_reply_bar: p.positives >= 1 && rate >= REPLY_BAR_PER_2000,
        leads_total: snap.leads_total,
        untouched: snap.untouched,
        sends_last_14d: snap.sends_last_14d,
        runway_days: h.runway_days,
        last_send_at: snap.last_send_at,
        never_top_up: isNeverTopUp(snap.smartlead_campaign_id, snap.name),
      });
    }
  }
  out.sort((a, b) => Number(b.passes_reply_bar) - Number(a.passes_reply_bar) || a.untouched - b.untouched || a.campaign_id - b.campaign_id);
  return {
    rule: REPLY_BAR_RULE,
    clients: clients.map((c) => c.client_tag),
    counts: {
      campaigns: out.length,
      passing_reply_bar: out.filter((c) => c.passes_reply_bar && !c.never_top_up).length,
      passing_and_under_1000_untouched: out.filter((c) => c.passes_reply_bar && !c.never_top_up && c.untouched < 1000).length,
      never_top_up: out.filter((c) => c.never_top_up).length,
    },
    campaigns: out,
  };
}
