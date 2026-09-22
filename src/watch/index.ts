import type { Queryable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import { isWorking, variantStats } from "../domain/working.js";
import { assessCampaign, campaignSnapshots } from "../ledger/health.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import { inferWatchRecipes, recipeResolveDeps } from "../recipes/infer.js";
import type { Recipe } from "../recipes/schema.js";
import { notWorkingCard } from "../slack/cards.js";
import type { SlackConsole } from "../slack/console.js";
import { campaignGroups, pullIdentity, recipeCampaignIds } from "../recipes/campaigns.js";
import { clientWatchDecision, pullGroups, type ScoredCampaign } from "./clientWide.js";
import { isNeedy } from "./decide.js";

const log = logger("watch");

/**
 * Step 1 after the recipe is signed off: every WATCH_CRON the service looks
 * at the client, then at campaigns that are still working (D27, D40). One
 * pull per shared ICP; leads segment into those campaigns. File recipes
 * first; inferred getleads lanes from receipts are added when a file does
 * not already cover them (D38). Josh is asked only when the rate has died.
 */
export class RunwayWatch {
  constructor(
    private readonly d: {
      db: Queryable;
      repo: Repo;
      orchestrator: Orchestrator;
      console: SlackConsole;
      recipes: Recipe[];
      getleadsCount?: (filters: Record<string, unknown>) => Promise<{ total_matching: number }>;
      dryRun: boolean;
      ledger?: LaneLedger;
    },
  ) {}

  async tick(): Promise<{ looked: number; went: number; asked: number; skipped: number }> {
    const extras = await inferWatchRecipes(recipeResolveDeps(this.d.repo, this.d.getleadsCount), this.d.recipes);
    const recipes = [...this.d.recipes, ...extras];
    const clients = [...new Set(recipes.map((r) => r.client_tag))].sort();
    const tally = { looked: 0, went: 0, asked: 0, skipped: 0 };
    for (const clientTag of clients) {
      tally.looked += 1;
      try {
        const action = await this.client(clientTag, recipes.filter((r) => r.client_tag === clientTag));
        if (action === "go") tally.went += 1;
        else if (action === "ask") tally.asked += 1;
        else tally.skipped += 1;
      } catch (err) {
        tally.skipped += 1;
        log.error("client tick failed", { client_tag: clientTag, error: (err as Error).message });
      }
    }
    log.info("tick", tally);
    return tally;
  }

  private async client(clientTag: string, recipes: Recipe[]): Promise<"go" | "ask" | "skip"> {
    const scored: ScoredCampaign[] = [];
    const byId = new Map<number, { recipe: Recipe; lane: string }>();
    const allIds: number[] = [];
    for (const recipe of recipes) {
      const ids = recipeCampaignIds(recipe);
      if (ids.length === 0) continue;
      for (const group of campaignGroups(recipe)) {
        const key = pullIdentity(recipe, group);
        for (const id of group.campaignIds) {
          if (!byId.has(id)) byId.set(id, { recipe, lane: recipe.lane });
          if (!allIds.includes(id)) allIds.push(id);
          const existing = scored.find((s) => s.campaign_id === id);
          if (!existing) {
            scored.push({
              client_tag: clientTag,
              lane: recipe.lane,
              campaign_id: id,
              pull_key: key,
              working: false,
              needy: false,
            });
          }
        }
      }
    }
    if (allIds.length === 0) {
      log.info("skip", { client_tag: clientTag, why: "client names no campaigns" });
      return "skip";
    }

    const snaps = await campaignSnapshots(this.d.db, allIds);
    const floor = recipes[0]?.runway.floor_days ?? 7;
    const health = snaps.map((s) => assessCampaign(s, floor));
    await this.d.repo.upsertCampaignRegistry(
      health.map((h) => {
        const meta = byId.get(h.smartlead_campaign_id);
        return {
          campaign_id: h.smartlead_campaign_id,
          campaign_name: h.name,
          client_tag: clientTag,
          smartlead_client_id: meta?.recipe.smartlead_client_id ?? recipes[0]!.smartlead_client_id,
          lane: meta?.lane ?? recipes[0]!.lane,
          recipe_id: meta?.recipe.recipe_id ?? recipes[0]!.recipe_id,
          status: h.status,
        };
      }),
    );

    const overrides = await this.d.repo.workingOverrides(allIds);
    const healthById = new Map(health.map((h) => [h.smartlead_campaign_id, h]));
    const workingById = new Map<number, ReturnType<typeof isWorking>>();
    for (const row of scored) {
      const h = healthById.get(row.campaign_id);
      if (!h) continue;
      row.needy = isNeedy(h);
      const recipe = byId.get(row.campaign_id)?.recipe ?? recipes[0]!;
      const stats = await variantStats(this.d.db, row.campaign_id);
      const working = isWorking({
        sends: stats.sends,
        interested: stats.interested,
        variants: stats.variants,
        interestedPer2000: recipe.working.interested_per_2000_sends,
        variantMinSends: recipe.working.variant_min_sends,
        override: overrides.get(row.campaign_id) ?? null,
      });
      workingById.set(row.campaign_id, working);
      row.working = working.working;
    }

    const groups = pullGroups(scored);
    let did: "go" | "ask" | "skip" = "skip";
    for (const group of groups) {
      const open = await Promise.all(group.lanes.map((lane) => this.d.repo.openRunFor(clientTag, lane)));
      const last = await this.d.repo.lastRunForLane(clientTag, group.primaryLane);
      const decision = clientWatchDecision({ group, openRun: open.some(Boolean), lastStatus: last?.status ?? null });
      const action = await this.applyDecision(decision, clientTag, byId, healthById, workingById);
      if (action === "go") did = "go";
      else if (action === "ask" && did !== "go") did = "ask";
    }
    return did;
  }

  private async applyDecision(
    decision: ReturnType<typeof clientWatchDecision>,
    clientTag: string,
    byId: Map<number, { recipe: Recipe; lane: string }>,
    healthById: Map<number, ReturnType<typeof assessCampaign>>,
    workingById: Map<number, ReturnType<typeof isWorking>>,
  ): Promise<"go" | "ask" | "skip"> {
    if (decision.kind === "skip") {
      log.info("skip", { client_tag: clientTag, why: decision.why });
      return "skip";
    }
    if (this.d.dryRun) {
      log.info("dry_run", { client_tag: clientTag, decision: decision.kind, why: decision.why });
      return "skip";
    }
    if (decision.kind === "go") {
      const started = await this.d.orchestrator.startTopup({
        clientTag,
        lane: decision.lane,
        by: "watch",
        trigger: "runway",
        campaignIds: decision.campaigns,
      });
      if (!started.ok) {
        log.info("go refused", { client_tag: clientTag, lane: decision.lane, message: started.message });
        return "skip";
      }
      return "go";
    }
    return this.askNotWorking(clientTag, decision.lane, decision.campaignId, byId, healthById, workingById);
  }

  private async askNotWorking(
    clientTag: string,
    lane: string,
    campaignId: number,
    byId: Map<number, { recipe: Recipe; lane: string }>,
    healthById: Map<number, ReturnType<typeof assessCampaign>>,
    workingById: Map<number, ReturnType<typeof isWorking>>,
  ): Promise<"go" | "ask" | "skip"> {
    const meta = byId.get(campaignId);
    const poster = healthById.get(campaignId);
    const working = workingById.get(campaignId);
    const started = await this.d.orchestrator.startTopup({
      clientTag,
      lane: meta?.lane ?? lane,
      by: "watch",
      trigger: "runway",
      drive: false,
      hold: "not_working",
      campaignIds: [campaignId],
    });
    if (!started.ok) {
      log.info("ask refused", { client_tag: clientTag, lane, message: started.message });
      return "skip";
    }
    const run = started.run;
    await this.d.repo.setRunStatus(run.run_id, "awaiting_josh", "trigger", `low and not working: #${campaignId}`);
    const stats = await variantStats(this.d.db, campaignId);
    await this.d.console.ask({
      run,
      kind: "not_working",
      audience: "owner",
      payload: { step: "trigger", campaign_id: campaignId, reason: working?.reason ?? "not working" },
      text: `Step 1: #${campaignId} is low and not working`,
      blocks: (cardId) =>
        notWorkingCard({
          cardId,
          runId: run.run_id,
          clientTag,
          campaignId,
          campaignName: poster?.name ?? `campaign ${campaignId}`,
          runwayDays: poster?.runway_days ?? 0,
          sends: stats.sends,
          interested: stats.interested,
          variants: stats.variants.map((v) => ({ label: v.label, sends: v.sends, interested: v.interested })),
        }),
    });
    await this.d.ledger?.block(clientTag, meta?.lane ?? lane, "owner", `runway is low and #${campaignId} is not working: ${working?.reason ?? "not working"}`, run.run_id);
    return "ask";
  }
}
