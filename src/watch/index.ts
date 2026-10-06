import type { Queryable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import { variantStats } from "../domain/working.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import type { Recipe } from "../recipes/schema.js";
import { recipeSummariesForWatch } from "../mcp/recipe.js";
import { notWorkingCard, section } from "../slack/cards.js";
import type { SlackConsole } from "../slack/console.js";
import { Overlap, WATCH_ACROSS_CLIENTS, WATCH_WITHIN_CLIENT } from "../lib/concurrency.js";
import { snapshotWatchLane } from "./assess.js";

const log = logger("watch");

/**
 * Step 1 after the recipe is signed off: every WATCH_CRON the service looks
 * at each campaign on the lane. A campaign under its own floor that is
 * still working is filled, even when a sibling still has leads, so that
 * campaign's sends do not stop. Client-wide days stay on the board (D38,
 * D45). Josh is asked only when the campaigns that need leads are not
 * working. Days are rem ÷ inbox capacity when named, else rem ÷ 7-day send
 * rate. n/a does not pass the floor.
 */
export class RunwayWatch {
  /** Lanes of one client overlap. Lanes of other clients overlap those. */
  private readonly overlap = new Overlap(WATCH_WITHIN_CLIENT, WATCH_ACROSS_CLIENTS);

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
    const tally = { looked: this.d.recipes.length, went: 0, asked: 0, skipped: 0 };
    const actions = await Promise.all(
      this.d.recipes.map((recipe) =>
        this.overlap.run(recipe.client_tag, async () => {
          try {
            return await this.lane(recipe);
          } catch (err) {
            log.error("lane tick failed", { client_tag: recipe.client_tag, lane: recipe.lane, error: (err as Error).message });
            return "skip" as const;
          }
        }),
      ),
    );
    for (const action of actions) {
      if (action === "go") tally.went += 1;
      else if (action === "ask") tally.asked += 1;
      else tally.skipped += 1;
    }
    log.info("tick", tally);
    return tally;
  }

  private async lane(recipe: Recipe): Promise<"go" | "ask" | "skip"> {
    const snap = await snapshotWatchLane({ db: this.d.db, repo: this.d.repo }, recipe);
    const { decision, camps, client, health, needy } = snap;
    if (health.length > 0) {
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
    }

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
          email_days: client?.email_days,
          email_rem: client?.email_rem,
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
      const recipeSummary = await recipeSummariesForWatch(this.d.db, recipe.client_tag, decision.campaigns);
      await this.d.console
        .postInThread(started.run, "Last pull recipe (counts)", [section(recipeSummary)])
        .catch((err) => log.warn("recipe summary failed", { error: (err as Error).message }));
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
    const recipeSummary = await recipeSummariesForWatch(this.d.db, recipe.client_tag, [poster.health.smartlead_campaign_id]);
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
          recipeSummary,
        }),
    });
    await this.d.ledger?.block(recipe.client_tag, recipe.lane, "owner", `runway is low and #${poster.health.smartlead_campaign_id} is not working: ${poster.working.reason}`, run.run_id);
    return "ask";
  }
}
