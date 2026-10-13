import { campaignPerformance } from "../builds/load.js";
import type { Queryable } from "../db/pool.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots, WINDOW_DAYS } from "../ledger/health.js";
import { loadClientMap } from "./clients.js";
import { isColdCall, isNeverTopUp, isStoppedStatus, ratePer2000, REPLY_BAR_PER_2000 } from "../policy/rules.js";
import { isUnassignedLane } from "./lanes.js";
import { registryRows } from "./registry.js";

/**
 * Every campaign, with the numbers Grok picks on (D52, D105): lifetime sends
 * and positive replies, the rate per 2,000, what is left to send, and whether
 * the reply bar is met. Low campaigns roll up by client and lane; the lane
 * runway is the sum across its refillable campaigns (STOPPED is out). Counts
 * and ids only.
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
  sends_window: number;
  runway_days: number | null;
  last_send_at: string | null;
  never_top_up: boolean;
  /** False when Smartlead status is STOPPED (D105). */
  refillable: boolean;
  /** Lane runway in untouched leads, STOPPED excluded. Null when the campaign has no lane. */
  lane_untouched: number | null;
}

export interface LaneLine {
  client_tag: string;
  lane: string;
  campaign_ids: number[];
  stopped_excluded: number;
  campaigns: number;
  untouched: number;
  sends_last_14d: number;
  runway_days: number | null;
  passing_reply_bar: number;
}

export interface CampaignsRead {
  rule: string;
  clients: string[];
  counts: { campaigns: number; passing_reply_bar: number; passing_and_under_1000_untouched: number; never_top_up: number; ignored_cold_call: number; lanes: number };
  campaigns: CampaignLine[];
  lanes: LaneLine[];
}

export const REPLY_BAR_RULE = `A campaign qualifies for a top-up with at least ${REPLY_BAR_PER_2000} positive reply per 2,000 sends, lifetime. Zero positives never qualifies. Top-ups size the lane, not one segment: the lane runway is the sum across its refillable campaigns (STOPPED never counts). Under 1,000 new leads after the lane dedupe, the quote says the floor is not met.`;

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
  let ignoredColdCall = 0;
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
      // D54: a campaign marked as cold call is not an email campaign; it is left off the list entirely.
      if (isColdCall(snap.name)) {
        ignoredColdCall += 1;
        continue;
      }
      const h = assessCampaign(snap);
      const p = perf.get(snap.smartlead_campaign_id) ?? { sends: 0, positives: 0 };
      const rate = Math.round(ratePer2000(p.sends, p.positives) * 100) / 100;
      const lane = lanes.get(snap.smartlead_campaign_id) ?? null;
      const refillable = !isStoppedStatus(snap.status);
      out.push({
        client_tag: client.client_tag,
        smartlead_client_id: client.smartlead_client_id,
        campaign_id: snap.smartlead_campaign_id,
        name: snap.name,
        status: snap.status,
        lane,
        sends: p.sends,
        positives: p.positives,
        rate_per_2000: rate,
        passes_reply_bar: p.positives >= 1 && rate >= REPLY_BAR_PER_2000,
        leads_total: snap.leads_total,
        untouched: snap.untouched,
        sends_last_14d: snap.sends_last_14d,
        sends_window: snap.sends_window,
        runway_days: h.runway_days,
        last_send_at: snap.last_send_at,
        never_top_up: isNeverTopUp(snap.smartlead_campaign_id, snap.name) || isUnassignedLane(lane),
        refillable,
        lane_untouched: null,
      });
    }
  }
  const lanesOut = rollupLanes(out);
  const laneUntouched = new Map(lanesOut.map((l) => [`${l.client_tag}\0${l.lane}`, l.untouched]));
  for (const row of out) {
    if (!row.lane || isUnassignedLane(row.lane)) continue;
    row.lane_untouched = laneUntouched.get(`${row.client_tag}\0${row.lane}`) ?? 0;
  }
  out.sort((a, b) => Number(b.passes_reply_bar) - Number(a.passes_reply_bar) || a.untouched - b.untouched || a.campaign_id - b.campaign_id);
  return {
    rule: REPLY_BAR_RULE,
    clients: clients.map((c) => c.client_tag),
    counts: {
      campaigns: out.length,
      passing_reply_bar: out.filter((c) => c.passes_reply_bar && !c.never_top_up && c.refillable).length,
      passing_and_under_1000_untouched: out.filter((c) => c.passes_reply_bar && !c.never_top_up && c.refillable && c.untouched < 1000).length,
      never_top_up: out.filter((c) => c.never_top_up).length,
      ignored_cold_call: ignoredColdCall,
      lanes: lanesOut.length,
    },
    campaigns: out,
    lanes: lanesOut,
  };
}

/** Sum runway across a lane's refillable campaigns. STOPPED is left out of the sum (D105). */
export function rollupLanes(rows: readonly CampaignLine[]): LaneLine[] {
  const groups = new Map<string, CampaignLine[]>();
  for (const row of rows) {
    if (!row.lane || isUnassignedLane(row.lane)) continue;
    const key = `${row.client_tag}\0${row.lane}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: LaneLine[] = [];
  for (const group of groups.values()) {
    const refillable = group.filter((c) => c.refillable && !c.never_top_up);
    const stopped = group.filter((c) => !c.refillable).length;
    const untouched = refillable.reduce((a, c) => a + c.untouched, 0);
    const sendsWindow = refillable.reduce((a, c) => a + c.sends_window, 0);
    const perDay = sendsWindow / WINDOW_DAYS;
    out.push({
      client_tag: group[0]!.client_tag,
      lane: group[0]!.lane!,
      campaign_ids: refillable.map((c) => c.campaign_id).sort((a, b) => a - b),
      stopped_excluded: stopped,
      campaigns: refillable.length,
      untouched,
      sends_last_14d: refillable.reduce((a, c) => a + c.sends_last_14d, 0),
      runway_days: perDay > 0 ? Math.round((untouched / perDay) * 10) / 10 : null,
      passing_reply_bar: refillable.filter((c) => c.passes_reply_bar).length,
    });
  }
  out.sort((a, b) => a.client_tag.localeCompare(b.client_tag) || a.untouched - b.untouched || a.lane.localeCompare(b.lane));
  return out;
}
