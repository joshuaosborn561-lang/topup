import type { Queryable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import type { Recipe } from "../recipes/schema.js";
import { recipeSummariesForWatch } from "../mcp/recipe.js";
import { isParlayRefreshCampaign, isRetiredParlayLane, parlayCampaignRetired } from "../recipes/parlay.js";
import { section } from "../slack/cards.js";
import type { SlackConsole } from "../slack/console.js";
import { Overlap, WATCH_ACROSS_CLIENTS, WATCH_WITHIN_CLIENT } from "../lib/concurrency.js";
import { snapshotWatchLane } from "./assess.js";

const log = logger("watch");

/**
 * Step 1 after the recipe is signed off: every WATCH_CRON the service looks
 * at each campaign on the lane. A campaign under its own floor that the
 * policy passes is filled, even when a sibling still has leads, so that
 * campaign's sends do not stop. Client-wide days stay on the board (D38,
 * D45). A campaign the policy refuses never starts from here and gets no
 * card: its gate and reason go to the log and the queue (D46). Days are
 * rem ÷ inbox capacity when named, else rem ÷ 7-day send rate. n/a does
 * not pass the floor.
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

  async tick(): Promise<{ looked: number; went: number; refused: number; skipped: number }> {
    await this.d.repo.repairCampaignRegistry().catch((err) => log.warn("registry repair before tick failed", { error: (err as Error).message }));
    const tally = { looked: this.d.recipes.length, went: 0, refused: 0, skipped: 0 };
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
      else if (action === "refused") tally.refused += 1;
      else tally.skipped += 1;
    }
    await this.d.repo.repairCampaignRegistry().catch((err) => log.warn("registry repair after tick failed", { error: (err as Error).message }));
    log.info("tick", tally);
    return tally;
  }

  private async lane(recipe: Recipe): Promise<"go" | "refused" | "skip"> {
    if (recipe.client_tag === "parlay" && isRetiredParlayLane(recipe.lane)) {
      log.info("skip", { client_tag: recipe.client_tag, lane: recipe.lane, why: "parlay lane is retired" });
      return "skip";
    }
    const snap = await snapshotWatchLane({ db: this.d.db, repo: this.d.repo }, recipe);
    const { decision, health } = snap;
    const registryHealth = health.filter((h) => {
      if (recipe.client_tag !== "parlay") return true;
      if (parlayCampaignRetired(h.smartlead_campaign_id)) return false;
      return isParlayRefreshCampaign(h.smartlead_campaign_id);
    });
    if (registryHealth.length > 0) {
      await this.d.repo.upsertCampaignRegistry(
        registryHealth.map((h) => ({
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
      const refused = decision.refused ?? [];
      log.info(refused.length ? "refused" : "skip", { client_tag: recipe.client_tag, lane: recipe.lane, why: decision.why, refused: refused.map((r) => `#${r.campaign_id} ${r.gate}`) });
      if (refused.length) {
        await this.d.ledger
          ?.event({ client_tag: recipe.client_tag, lane: recipe.lane, event: "note", line: `Watch: ${decision.why}`.slice(0, 500), next_intent: "Nothing starts on its own. Josh's /working on is the override for the bar.", actor: "watch" })
          .catch(() => undefined);
        return "refused";
      }
      return "skip";
    }

    if (this.d.dryRun) {
      log.info("dry_run", { client_tag: recipe.client_tag, lane: recipe.lane, decision: decision.kind, why: decision.why });
      return "skip";
    }

    if (decision.proposeMock) {
      log.info("propose_holistic_mock", {
        client_tag: recipe.client_tag,
        lane: recipe.lane,
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
      log.info("go refused", { client_tag: recipe.client_tag, lane: recipe.lane, why: started.message });
      return "skip";
    }
    const recipeSummary = await recipeSummariesForWatch(this.d.db, recipe.client_tag, decision.campaigns);
    await this.d.console.postInThread(started.run, "Last pull recipe (counts)", [section(recipeSummary)]).catch((err) => log.warn("recipe summary failed", { error: (err as Error).message }));
    return "go";
  }
}
