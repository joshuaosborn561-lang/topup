import type { Queryable } from "../db/pool.js";
import type { Recipe } from "../recipes/schema.js";
import { readTopupRecipe, recipeSummaryCounts, type RecipeSummaryCounts } from "./recipe.js";
import { flaggedCampaigns, snapshotWatchLane, type WatchRepo } from "../watch/assess.js";
import { runwayKey } from "../watch/decide.js";

/**
 * D43 — Cayden's queue. Campaigns the watch flagged, ranked, with the
 * recipe count summary. Counts and ids only. Never lead rows. Read only.
 */

export const TOPUP_QUEUE_DESCRIPTION =
  "Campaigns the watchdog has flagged, ranked empty-first then shortest runway, each with the last-pull recipe count summary. Open the queue, pick the top one, read topup_recipe, run start_topup. Counts only, never lead rows.";

export interface QueueItem {
  rank: number;
  client_tag: string;
  lane: string;
  campaign_id: number;
  campaign_name: string | null;
  flags: string[];
  runway_days: number | null;
  decision: "go" | "ask";
  why: string;
  working: boolean;
  recipe_summary: RecipeSummaryCounts;
}

export interface UnrankedQueueItem extends Omit<QueueItem, "rank"> {}

export function rankQueueItems(items: UnrankedQueueItem[]): QueueItem[] {
  return [...items]
    .sort((a, b) => {
      const ka = runwayKey({ flags: a.flags, runway_days: a.runway_days });
      const kb = runwayKey({ flags: b.flags, runway_days: b.runway_days });
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

/** Read only. Walks every file recipe the watch walks. Never starts a run. */
export async function buildTopupQueue(
  db: Queryable,
  repo: WatchRepo,
  recipes: readonly Recipe[],
): Promise<{ items: QueueItem[]; count: number }> {
  const raw: UnrankedQueueItem[] = [];
  for (const recipe of recipes) {
    const snap = await snapshotWatchLane({ db, repo }, recipe);
    if (snap.decision.kind === "skip") continue;
    for (const camp of flaggedCampaigns(snap)) {
      raw.push({
        client_tag: recipe.client_tag,
        lane: recipe.lane,
        campaign_id: camp.health.smartlead_campaign_id,
        campaign_name: camp.health.name,
        flags: [...camp.health.flags],
        runway_days: camp.health.runway_days,
        decision: snap.decision.kind,
        why: snap.decision.why,
        working: camp.working.working,
        recipe_summary: await summaryFor(db, recipe.client_tag, camp.health.smartlead_campaign_id),
      });
    }
  }
  const items = rankQueueItems(raw);
  return { items, count: items.length };
}
