import type { Queryable } from "../db/pool.js";
import type { RunStatus } from "../domain/runs.js";
import { isWorking, variantStats } from "../domain/working.js";
import { assessClientRunway, type ClientRunway } from "../ledger/client_runway.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots, type CampaignHealth } from "../ledger/health.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";
import { isParlayRefreshCampaign, isRetiredParlayLane, PARLAY_REFRESH_FIRST, PARLAY_REFRESH_LAST } from "../recipes/parlay.js";
import type { Recipe } from "../recipes/schema.js";
import { isNeedy, watchDecision, type NeedyCampaign, type WatchDecision } from "./decide.js";

/**
 * Read-only watch snapshot (D43). The queue and the watch tick share this.
 * It does not write the campaign registry and it does not start a run.
 */
export interface WatchRepo {
  workingOverrides(campaignIds: readonly number[]): Promise<Map<number, boolean | null>>;
  openRunFor(clientTag: string, lane: string): Promise<{ status: string } | null>;
  lastRunForLane(clientTag: string, lane: string): Promise<{ status: RunStatus } | null>;
}

export interface WatchLaneSnapshot {
  ids: number[];
  health: CampaignHealth[];
  needy: NeedyCampaign[];
  camps: NeedyCampaign[];
  client: ClientRunway | null;
  decision: WatchDecision;
  openRun: boolean;
}

export async function snapshotWatchLane(
  d: { db: Queryable; repo: WatchRepo },
  recipe: Recipe,
): Promise<WatchLaneSnapshot> {
  const ids = await watchCampaignIds(d.db, recipe);
  if (ids.length === 0) {
    return {
      ids,
      health: [],
      needy: [],
      camps: [],
      client: null,
      decision: { kind: "skip", why: "recipe names no campaigns" },
      openRun: false,
    };
  }

  const snaps = await campaignSnapshots(d.db, ids);
  const health = snaps.map((s) => assessCampaign(s, recipe.runway.floor_days));

  const clientIds = await campaignIdsForClient(d.db, recipe.smartlead_client_id).catch(() => ids);
  const clientSnaps =
    clientIds.length === ids.length && clientIds.every((id) => ids.includes(id))
      ? snaps
      : await campaignSnapshots(d.db, clientIds.length ? clientIds : ids).catch(() => snaps);
  const clientHealth = clientSnaps.map((s) => assessCampaign(s, recipe.runway.floor_days));
  const client = assessClientRunway({
    clientTag: recipe.client_tag,
    campaigns: clientHealth,
    uniqueInboxes: null,
    messagePerDay: null,
    floorDays: recipe.runway.floor_days,
  });

  const overrides = await d.repo.workingOverrides(ids);
  const camps: NeedyCampaign[] = [];
  for (const h of health.filter((c) => c.status === "ACTIVE")) {
    const stats = await variantStats(d.db, h.smartlead_campaign_id);
    const working = isWorking({
      sends: stats.sends,
      interested: stats.interested,
      variants: stats.variants,
      interestedPer2000: recipe.working.interested_per_2000_sends,
      variantMinSends: recipe.working.variant_min_sends,
      override: overrides.get(h.smartlead_campaign_id) ?? null,
    });
    camps.push({ health: h, working });
  }
  const needy = camps.filter((n) => isNeedy(n.health));

  const open = await d.repo.openRunFor(recipe.client_tag, recipe.lane);
  const last = await d.repo.lastRunForLane(recipe.client_tag, recipe.lane);
  const decision = watchDecision({
    needy,
    camps,
    client,
    recipeCampaignIds: ids,
    openRun: Boolean(open),
    lastStatus: last?.status ?? null,
  });

  return { ids, health, needy, camps, client, decision, openRun: Boolean(open) };
}

/** Parlay watch targets are the Sept 29 campaigns on this lane, including ones the registry added. */
async function watchCampaignIds(db: Queryable, recipe: Recipe): Promise<number[]> {
  const fromRecipe = recipeCampaignIds(recipe).filter((id) => recipe.client_tag !== "parlay" || isParlayRefreshCampaign(id));
  if (recipe.client_tag !== "parlay" || isRetiredParlayLane(recipe.lane)) return recipe.client_tag === "parlay" ? [] : fromRecipe;
  try {
    const { rows } = await db.query<{ campaign_id: string }>(
      `select campaign_id::text from topup.campaign_registry
        where client_tag = $1 and lane = $2
          and campaign_id between $3 and $4
          and coalesce(status, '') <> 'retired'`,
      [recipe.client_tag, recipe.lane, PARLAY_REFRESH_FIRST, PARLAY_REFRESH_LAST],
    );
    const ids = new Set(fromRecipe);
    for (const row of rows) {
      const id = Number(row.campaign_id);
      if (isParlayRefreshCampaign(id)) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  } catch {
    return fromRecipe;
  }
}

/** Campaigns the watch flagged on this lane. Empty when the decision is skip. */
export function flaggedCampaigns(snap: WatchLaneSnapshot): NeedyCampaign[] {
  const { decision, needy, camps } = snap;
  if (decision.kind === "skip") return [];
  if (decision.kind === "ask") {
    const ask = camps.find((c) => c.health.smartlead_campaign_id === decision.campaignId);
    return ask ? [ask] : needy.slice(0, 1);
  }
  return needy.length ? needy : camps.slice(0, 1);
}
