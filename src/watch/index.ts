import type { Queryable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import { isWorking, variantStats } from "../domain/working.js";
import { assessClientRunway } from "../ledger/client_runway.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots } from "../ledger/health.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";
import type { Recipe } from "../recipes/schema.js";
import { notWorkingCard } from "../slack/cards.js";
import type { SlackConsole } from "../slack/console.js";
import { isNeedy, watchDecision, type NeedyCampaign } from "./decide.js";

const log = logger("watch");

/**
 * Step 1 after the recipe is signed off: every WATCH_CRON the service looks
 * at the Smartlead mirror. The start signal is client-wide rem / capacity
 * (D38), not one campaign going dry. Josh is asked only when the rate has
 * died. Unique inboxes × MESSAGE_PER_DAY are not in this service yet — days
 * are null until Josh names the source; sibling rem still blocks a one-camp
 * SEG refill.
 */
export class RunwayWatch {
  constructor(
    private readonly d: {
      db: Queryable;
      repo: Repo;
      orchestrator: Orchestrator;
      console: SlackConsole;
      recipes: Recipe[];
      dryRun: boolean;
      ledger?: LaneLedger;
    },
  ) {}

  async tick(): Promise<{ looked: number; went: number; asked: number; skipped: number }> {
    const tally = { looked: 0, went: 0, asked: 0, skipped: 0 };
    for (const recipe of this.d.recipes) {
      tally.looked += 1;
      try {
        const action = await this.lane(recipe);
        if (action === "go") tally.went += 1;
        else if (action === "ask") tally.asked += 1;
        else tally.skipped += 1;
      } catch (err) {
        tally.skipped += 1;
        log.error("lane tick failed", { client_tag: recipe.client_tag, lane: recipe.lane, error: (err as Error).message });
      }
    }
    log.info("tick", tally);
    return tally;
  }

  private async lane(recipe: Recipe): Promise<"go" | "ask" | "skip"> {
    const ids = recipeCampaignIds(recipe);
    if (ids.length === 0) {
      log.info("skip", { client_tag: recipe.client_tag, lane: recipe.lane, why: "recipe names no campaigns" });
      return "skip";
    }

    const snaps = await campaignSnapshots(this.d.db, ids);
    const health = snaps.map((s) => assessCampaign(s, recipe.runway.floor_days));
    await this.d.repo.upsertCampaignRegistry(
      health.map((h) => ({
        campaign_id: h.smartlead_campaign_id,
        campaign_name: h.name,
        client_tag: recipe.client_tag,
        smartlead_client_id: recipe.smartlead_client_id,
        lane: recipe.lane,
        recipe_id: recipe.recipe_id,
        status: h.status,
      })),
    );

    // D38: client rem across every ACTIVE campaign, not just this recipe.
    // uniqueInboxes / messagePerDay stay null until Josh names the source.
    const clientIds = await campaignIdsForClient(this.d.db, recipe.smartlead_client_id).catch(() => ids);
    const clientSnaps = clientIds.length === ids.length && clientIds.every((id) => ids.includes(id))
      ? snaps
      : await campaignSnapshots(this.d.db, clientIds.length ? clientIds : ids).catch(() => snaps);
    const clientHealth = clientSnaps.map((s) => assessCampaign(s, recipe.runway.floor_days));
    const client = assessClientRunway({
      clientTag: recipe.client_tag,
      campaigns: clientHealth,
      uniqueInboxes: null,
      messagePerDay: null,
      floorDays: recipe.runway.floor_days,
    });

    const overrides = await this.d.repo.workingOverrides(ids);
    const camps: NeedyCampaign[] = [];
    for (const h of health.filter((c) => c.status === "ACTIVE")) {
      const stats = await variantStats(this.d.db, h.smartlead_campaign_id);
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

    const open = await this.d.repo.openRunFor(recipe.client_tag, recipe.lane);
    const last = await this.d.repo.lastRunForLane(recipe.client_tag, recipe.lane);
    const decision = watchDecision({
      needy,
      camps,
      client,
      recipeCampaignIds: ids,
      openRun: Boolean(open),
      lastStatus: last?.status ?? null,
    });

    if (decision.kind === "skip") {
      log.info("skip", { client_tag: recipe.client_tag, lane: recipe.lane, why: decision.why });
      return "skip";
    }

    if (this.d.dryRun) {
      log.info("dry_run", { client_tag: recipe.client_tag, lane: recipe.lane, decision: decision.kind, why: decision.why });
      return "skip";
    }

    if (decision.kind === "go") {
      if (decision.proposeMock) {
        log.info("propose_holistic_mock", {
          client_tag: recipe.client_tag,
          lane: recipe.lane,
          email_days: client.email_days,
          email_rem: client.email_rem,
          note: "D38 under-2 mock: filters / net-new / $ are a size step, not invented here. Paid spend still needs Josh.",
        });
      }
      const started = await this.d.orchestrator.startTopup({
        clientTag: recipe.client_tag,
        lane: recipe.lane,
        by: "watch",
        trigger: "runway",
        campaignIds: decision.campaigns,
      });
      if (!started.ok) {
        log.info("go refused", { client_tag: recipe.client_tag, lane: recipe.lane, message: started.message });
        return "skip";
      }
      return "go";
    }

    const poster = camps.find((n) => n.health.smartlead_campaign_id === decision.campaignId) ?? camps[0] ?? needy[0];
    if (!poster) {
      log.info("ask refused", { client_tag: recipe.client_tag, lane: recipe.lane, message: "no ACTIVE campaign to ask about" });
      return "skip";
    }
    const started = await this.d.orchestrator.startTopup({
      clientTag: recipe.client_tag,
      lane: recipe.lane,
      by: "watch",
      trigger: "runway",
      drive: false,
      hold: "not_working",
      campaignIds: [decision.campaignId],
    });
    if (!started.ok) {
      log.info("ask refused", { client_tag: recipe.client_tag, lane: recipe.lane, message: started.message });
      return "skip";
    }
    const run = started.run;
    await this.d.repo.setRunStatus(run.run_id, "awaiting_josh", "trigger", decision.why);
    const stats = await variantStats(this.d.db, poster.health.smartlead_campaign_id);
    await this.d.console.ask({
      run,
      kind: "not_working",
      audience: "owner",
      payload: { step: "trigger", campaign_id: poster.health.smartlead_campaign_id, reason: poster.working.reason },
      text: `Step 1: #${poster.health.smartlead_campaign_id} is low and not working`,
      blocks: (cardId) =>
        notWorkingCard({
          cardId,
          runId: run.run_id,
          clientTag: recipe.client_tag,
          campaignId: poster.health.smartlead_campaign_id,
          campaignName: poster.health.name ?? `campaign ${poster.health.smartlead_campaign_id}`,
          runwayDays: poster.health.runway_days ?? 0,
          sends: stats.sends,
          interested: stats.interested,
          variants: stats.variants.map((v) => ({ label: v.label, sends: v.sends, interested: v.interested })),
        }),
    });
    await this.d.ledger?.block(recipe.client_tag, recipe.lane, "owner", `runway is low and #${poster.health.smartlead_campaign_id} is not working: ${poster.working.reason}`, run.run_id);
    return "ask";
  }
}
