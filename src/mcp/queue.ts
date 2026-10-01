import type { Queryable } from "../db/pool.js";
import type { RunStatus } from "../domain/runs.js";
import { isWorking, variantStats } from "../domain/working.js";
import type { ClientRunway } from "../ledger/client_runway.js";
import { assessClientRunway } from "../ledger/client_runway.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots } from "../ledger/health.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";
import type { Recipe } from "../recipes/schema.js";
import type { WatchRepo } from "../watch/assess.js";
import { watchdogLeadFlag, watchDecision, type NeedyCampaign, type WatchdogLeadFlag } from "../watch/decide.js";
import { loadClientMap, readTopupRecipe, recipeSummaryCounts, type RecipeSummaryCounts } from "./recipe.js";

/**
 * D43 / D44 — Cayden's queue. Same lead-refill lines #campaign-watchdog
 * posts (empty / low / nearly-done 90%), ranked, with the recipe count
 * summary and the 1-in-2000 working gate. Counts and ids only. Read only.
 */

export const TOPUP_QUEUE_DESCRIPTION =
  "Campaigns #campaign-watchdog would flag as needing leads (empty, low, nearly-done 90%), ranked empty-first then shortest runway, each with the last-pull recipe count summary and the 1-in-2000 working gate (1 reply under 2,000 sends is acceptable). Includes camps the client-wide watch would skip. Open the queue, pick the top one, read topup_recipe, run start_topup. Counts only, never lead rows.";

const DEFAULT_INTERESTED_PER_2000 = 1;
const DEFAULT_VARIANT_MIN_SENDS = 1000;
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
  decision: "go" | "ask" | "skip";
  why: string;
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

async function clientOpenRun(db: Queryable, clientTag: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from topup.runs where client_tag = $1 and topup.run_is_open(status) limit 1`,
    [clientTag],
  );
  return rows.length > 0;
}

async function clientLastStatus(db: Queryable, clientTag: string): Promise<RunStatus | null> {
  const { rows } = await db.query<{ status: RunStatus }>(
    `select status from topup.runs where client_tag = $1 order by opened_at desc limit 1`,
    [clientTag],
  );
  return rows[0]?.status ?? null;
}

function clientDecision(
  client: ClientRunway,
  flagged: NeedyCampaign[],
  recipe: Recipe | undefined,
  openRun: boolean,
  lastStatus: RunStatus | null,
): { kind: "go" | "ask" | "skip"; why: string } {
  const decision = watchDecision({
    needy: flagged,
    camps: flagged,
    client,
    recipeCampaignIds: recipe ? recipeCampaignIds(recipe) : flagged.map((c) => c.health.smartlead_campaign_id),
    openRun,
    lastStatus,
  });
  return { kind: decision.kind, why: decision.why };
}

/** Read only. Walks every client_map client (and file recipes if the map is empty). Never starts a run. */
export async function buildTopupQueue(
  db: Queryable,
  repo: WatchRepo,
  recipes: readonly Recipe[],
): Promise<{ items: QueueItem[]; count: number }> {
  const mapped = await loadClientMap(db).catch(() => []);
  const clients =
    mapped.length > 0
      ? mapped
      : recipes.map((r) => ({ client_tag: r.client_tag, smartlead_client_id: r.smartlead_client_id }));
  const registryLanes = await lanesForCampaigns(db);
  const raw: UnrankedQueueItem[] = [];

  for (const clientRow of clients) {
    const ids = await campaignIdsForClient(db, clientRow.smartlead_client_id).catch(() => [] as number[]);
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

    const overrides = await repo.workingOverrides(need.map((h) => h.smartlead_campaign_id));
    const flagged: NeedyCampaign[] = [];
    for (const h of need) {
      const rec = recipeForCampaign(recipes, clientRow.client_tag, h.smartlead_campaign_id);
      const stats = await variantStats(db, h.smartlead_campaign_id);
      const working = isWorking({
        sends: stats.sends,
        interested: stats.interested,
        variants: stats.variants,
        interestedPer2000: rec?.working.interested_per_2000_sends ?? DEFAULT_INTERESTED_PER_2000,
        variantMinSends: rec?.working.variant_min_sends ?? DEFAULT_VARIANT_MIN_SENDS,
        override: overrides.get(h.smartlead_campaign_id) ?? null,
      });
      flagged.push({ health: h, working });
    }

    const openRun = await clientOpenRun(db, clientRow.client_tag).catch(() => false);
    const lastStatus = await clientLastStatus(db, clientRow.client_tag).catch(() => null);
    const fileRecipe = recipes.find((r) => r.client_tag === clientRow.client_tag);
    const decision = clientDecision(client, flagged, fileRecipe, openRun, lastStatus);

    for (const camp of flagged) {
      const rec = recipeForCampaign(recipes, clientRow.client_tag, camp.health.smartlead_campaign_id);
      const watchdog = watchdogLeadFlag(camp.health);
      if (!watchdog) continue;
      raw.push({
        client_tag: clientRow.client_tag,
        lane: rec?.lane ?? registryLanes.get(camp.health.smartlead_campaign_id) ?? null,
        campaign_id: camp.health.smartlead_campaign_id,
        campaign_name: camp.health.name,
        flags: [...camp.health.flags],
        watchdog,
        remaining_new: camp.health.untouched,
        runway_days: camp.health.runway_days,
        decision: decision.kind,
        why: decision.why,
        working: camp.working.working,
        working_reason: camp.working.reason,
        client_under_floor: client.under_floor,
        sibling_rem: client.sibling_rem,
        recipe_summary: await summaryFor(db, clientRow.client_tag, camp.health.smartlead_campaign_id),
      });
    }
  }

  const items = rankQueueItems(raw);
  return { items, count: items.length };
}
