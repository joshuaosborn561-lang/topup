import type { Queryable } from "../db/pool.js";
import type { RunStatus } from "../domain/runs.js";
import type { ClientRunway } from "../ledger/client_runway.js";
import { assessClientRunway } from "../ledger/client_runway.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots } from "../ledger/health.js";
import type { CampaignGate } from "../policy/index.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";
import { parlayQueueKeeps } from "../recipes/parlay.js";
import type { Recipe } from "../recipes/schema.js";
import { judgeCampaigns, type WatchRepo } from "../watch/assess.js";
import { watchdogLeadFlag, watchDecision, type NeedyCampaign, type WatchdogLeadFlag } from "../watch/decide.js";
import { loadClientMap, readTopupRecipe, recipeSummaryCounts, trimRecipeSummary, type RecipeSummaryCounts } from "./recipe.js";

/**
 * D43 / D44 / D46 — Cayden's queue. Same lead-refill lines #campaign-watchdog
 * posts (empty / low / nearly-done 90%), ranked, with the recipe count
 * summary and the policy layer's gate and reason for each campaign. The
 * queue, the watch and the size step judge a campaign the same way.
 * Counts and ids only. Read only.
 */

export const TOPUP_QUEUE_DESCRIPTION =
  "Campaigns #campaign-watchdog would flag as needing leads (empty, low, nearly-done 90%), ranked empty-first then shortest runway, each with the last-pull recipe count summary and the policy gate already applied: excluded, ignored client, retired, paused, dropped, not active, foreign client, under the 1-in-2000 reply bar (1 reply under 2,000 sends is acceptable; zero positives never qualifies), or ok. Page with limit/offset/client_tag. Includes camps the client-wide watch would skip. Open the queue, pick the top one, read campaign_history, run size_client or start_topup(client_tag, campaign_id, count). Counts only, never lead rows.";

const DEFAULT_FLOOR_DAYS = 7;

export interface QueueItem {
  rank: number;
  client_tag: string;
  lane: string | null;
  campaign_id: number;
  campaign_name: string | null;
  flags: string[];
  watchdog: WatchdogLeadFlag;
  remaining_new: number;
  runway_days: number | null;
  sends_last_14d: number;
  client_email_days: number | null;
  decision: "go" | "skip";
  why: string;
  /** The policy layer's verdict (D46): the gate and its one-line reason. */
  gate: CampaignGate;
  gate_reason: string;
  qualifies: boolean;
  /** Kept for readers of the older shape: working is "passes the reply bar". */
  working: boolean;
  working_reason: string;
  client_under_floor: boolean;
  sibling_rem: boolean;
  recipe_summary: RecipeSummaryCounts;
}

export interface UnrankedQueueItem extends Omit<QueueItem, "rank"> {}

/** Empty first, then nearly-done by remaining new, then low by shortest runway. */
export function queueRankKey(it: Pick<UnrankedQueueItem, "watchdog" | "flags" | "remaining_new" | "runway_days">): number {
  if (it.watchdog === "empty" || it.flags.includes("empty")) return it.remaining_new;
  if (it.watchdog === "nearly_done") return 1_000 + it.remaining_new;
  return 10_000 + (it.runway_days ?? Number.POSITIVE_INFINITY);
}

export function rankQueueItems(items: UnrankedQueueItem[]): QueueItem[] {
  return [...items]
    .sort((a, b) => {
      const ka = queueRankKey(a);
      const kb = queueRankKey(b);
      if (ka !== kb) return ka - kb;
      return a.campaign_id - b.campaign_id;
    })
    .map((it, i) => ({ ...it, rank: i + 1 }));
}

async function summaryFor(
  db: Queryable,
  clientTag: string,
  campaignId: number,
): Promise<RecipeSummaryCounts> {
  try {
    const recipe = await readTopupRecipe(db, clientTag, campaignId);
    return recipeSummaryCounts(recipe, campaignId);
  } catch (err) {
    return {
      campaign_id: campaignId,
      builds: [],
      any_reconstructed: null,
      leads_without_method: null,
      campaign_not_found: false,
      unavailable: (err as Error).message.slice(0, 120),
    };
  }
}

function recipeForCampaign(recipes: readonly Recipe[], clientTag: string, campaignId: number): Recipe | undefined {
  const mine = recipes.filter((r) => r.client_tag === clientTag);
  return mine.find((r) => recipeCampaignIds(r).includes(campaignId)) ?? mine[0];
}

async function receiptLanesForCampaigns(db: Queryable): Promise<Map<number, string>> {
  try {
    const { rows } = await db.query<{ campaign_id: string; lane: string }>(
      `select distinct on (cid) cid::text as campaign_id, lane
         from topup.pull_receipts, unnest(campaign_ids) as cid
        where lane is not null
        order by cid, (granularity = 'lane') desc, written_at desc`,
    );
    const out = new Map<number, string>();
    for (const r of rows) if (r.lane) out.set(Number(r.campaign_id), r.lane);
    return out;
  } catch {
    return new Map();
  }
}

async function lanesForCampaigns(db: Queryable): Promise<Map<number, string>> {
  try {
    const { rows } = await db.query<{ campaign_id: string; lane: string }>(
      `select campaign_id::text, lane from topup.campaign_registry where lane is not null`,
    );
    const out = new Map<number, string>();
    for (const r of rows) if (r.lane) out.set(Number(r.campaign_id), r.lane);
    return out;
  } catch {
    return new Map();
  }
}

/** An open run blocks a lane only when it is the same client and the same lane. A sibling lane, or another client's run that lists this campaign, does not. */
export function openRunBlocksLane(
  openRuns: readonly { client_tag: string; lane: string }[],
  clientTag: string,
  lane: string | null,
): boolean {
  if (!lane) return false;
  return openRuns.some((run) => run.client_tag === clientTag && run.lane === lane);
}

export function lastStatusForLane(
  runs: readonly { client_tag: string; lane: string; status: RunStatus }[],
  clientTag: string,
  lane: string | null,
): RunStatus | null {
  if (!lane) return null;
  return runs.find((run) => run.client_tag === clientTag && run.lane === lane)?.status ?? null;
}

async function openRuns(db: Queryable): Promise<Array<{ client_tag: string; lane: string }>> {
  const { rows } = await db.query<{ client_tag: string; lane: string }>(
    `select client_tag, lane from topup.runs where topup.run_is_open(status)`,
  );
  return rows;
}

async function latestStatusByLane(db: Queryable): Promise<Array<{ client_tag: string; lane: string; status: RunStatus }>> {
  const { rows } = await db.query<{ client_tag: string; lane: string; status: RunStatus }>(
    `select distinct on (client_tag, lane) client_tag, lane, status
       from topup.runs
      order by client_tag, lane, opened_at desc`,
  );
  return rows;
}

export interface QueueQuery {
  client_tag?: string;
  limit?: number;
  offset?: number;
}

const DEFAULT_QUEUE_LIMIT = 20;
const MAX_QUEUE_LIMIT = 50;

/** Read only. Walks every client_map client (and file recipes if the map is empty). Never starts a run. */
export async function buildTopupQueue(
  db: Queryable,
  repo: WatchRepo,
  recipes: readonly Recipe[],
  query: QueueQuery = {},
): Promise<{ items: QueueItem[]; count: number; total: number; limit: number; offset: number }> {
  const limit = Math.min(MAX_QUEUE_LIMIT, Math.max(1, query.limit ?? DEFAULT_QUEUE_LIMIT));
  const offset = Math.max(0, query.offset ?? 0);
  const mapped = await loadClientMap(db).catch(() => []);
  const clients =
    mapped.length > 0
      ? mapped
      : recipes.map((r) => ({ client_tag: r.client_tag, smartlead_client_id: r.smartlead_client_id }));
  const registryLanes = await lanesForCampaigns(db);
  const receiptLanes = await receiptLanesForCampaigns(db);
  const open = await openRuns(db).catch(() => [] as Array<{ client_tag: string; lane: string }>);
  const latest = await latestStatusByLane(db).catch(() => [] as Array<{ client_tag: string; lane: string; status: RunStatus }>);
  const raw: UnrankedQueueItem[] = [];

  const wantClient = query.client_tag ?? null;
  for (const clientRow of clients) {
    if (wantClient && clientRow.client_tag !== wantClient) continue;
    const ids = (await campaignIdsForClient(db, clientRow.smartlead_client_id).catch(() => [] as number[])).filter((id) =>
      parlayQueueKeeps(clientRow.client_tag, id),
    );
    if (ids.length === 0) continue;
    const snaps = await campaignSnapshots(db, ids);
    const health = snaps.map((s) => assessCampaign(s, DEFAULT_FLOOR_DAYS));
    const client = assessClientRunway({
      clientTag: clientRow.client_tag,
      campaigns: health,
      uniqueInboxes: null,
      messagePerDay: null,
      floorDays: DEFAULT_FLOOR_DAYS,
    });
    const need = health.filter((h) => watchdogLeadFlag(h));
    if (need.length === 0) continue;

    const judged = await judgeCampaigns(db, repo, { client_tag: clientRow.client_tag, lane: "", smartlead_client_id: clientRow.smartlead_client_id }, need);
    const flagged: NeedyCampaign[] = judged;

    for (const camp of flagged) {
      const rec = recipeForCampaign(recipes, clientRow.client_tag, camp.health.smartlead_campaign_id);
      const watchdog = watchdogLeadFlag(camp.health);
      if (!watchdog) continue;
      const lane =
        registryLanes.get(camp.health.smartlead_campaign_id) ??
        receiptLanes.get(camp.health.smartlead_campaign_id) ??
        rec?.lane ??
        null;
      const laneCamps = flagged.filter((other) => {
        const otherLane =
          registryLanes.get(other.health.smartlead_campaign_id) ??
          receiptLanes.get(other.health.smartlead_campaign_id) ??
          recipeForCampaign(recipes, clientRow.client_tag, other.health.smartlead_campaign_id)?.lane ??
          null;
        return otherLane === lane;
      });
      const decision = watchDecision({
        needy: laneCamps,
        camps: laneCamps,
        client,
        recipeCampaignIds: laneCamps.map((other) => other.health.smartlead_campaign_id),
        openRun: openRunBlocksLane(open, clientRow.client_tag, lane),
        lastStatus: lastStatusForLane(latest, clientRow.client_tag, lane),
      });
      raw.push({
        client_tag: clientRow.client_tag,
        lane,
        campaign_id: camp.health.smartlead_campaign_id,
        campaign_name: camp.health.name,
        flags: [...camp.health.flags],
        watchdog,
        remaining_new: camp.health.untouched,
        runway_days: camp.health.runway_days,
        sends_last_14d: camp.health.sends_last_14d ?? 0,
        client_email_days: client.email_days,
        decision: decision.kind,
        why: decision.why,
        gate: camp.verdict.gate,
        gate_reason: camp.verdict.reason,
        qualifies: camp.verdict.qualifies,
        working: camp.verdict.gate !== "under_reply_bar",
        working_reason: camp.verdict.reason,
        client_under_floor: client.under_floor,
        sibling_rem: client.sibling_rem,
        recipe_summary: trimRecipeSummary(await summaryFor(db, clientRow.client_tag, camp.health.smartlead_campaign_id)),
      });
    }
  }

  const ranked = rankQueueItems(raw);
  const items = ranked.slice(offset, offset + limit);
  return { items, count: items.length, total: ranked.length, limit, offset };
}
