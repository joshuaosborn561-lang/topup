import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import { attempt, finish, park, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 3, the cascade half (skill lead-list-build step 3; skill
 * leadgen-mcp-routing). The skill runs email finding inside the pull, before
 * ingest, so this stage sits between pull and ingest. A getleads lane pulls
 * with email_status VALID and every row arrives with an address; the recipe
 * says so with `email_finding.enabled: false` and this stage records that and
 * moves on.
 *
 * The cascade itself (getleads → Smartlead → AI Ark → LeadMagic → Prospeo →
 * FullEnrich, docs/servers.md §1 email-waterfall) is the company-first
 * adapter's, Peterson first, and lands in its own PR. A recipe that enables
 * it before then parks the run and says so; nothing is invented.
 */
export class FindEmailsStage {
  constructor(private readonly d: StageDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "find_emails", "resolving", async (attempts) => {
      if (!recipe.email_finding.enabled) {
        return finish(this.d, run, "find_emails", 0, { email_finding_skipped: 1 }, `Find emails skipped: the recipe has email finding off (a getleads pull with email_status VALID arrives with an address on every row).`);
      }
      const reason = `email finding is enabled on ${recipe.recipe_id} but the cascade is not in this build (it lands with the company-first adapter, Peterson first). Turn it off in the recipe or wait for that PR.`;
      await this.d.repo.failStep(run.run_id, "find_emails", reason, true);
      return park(this.d, run, "find_emails", reason, attempts);
    });
  }
}
