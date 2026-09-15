import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 13 — Flip active and watch day one.
 *
 * The service walks this step so the ledger and `/where` name it. It never
 * sets a campaign ACTIVE (D6). It posts the reminder and finishes; Josh
 * flips by hand and watches day one.
 */
export class FlipStage {
  constructor(private readonly d: StageDeps) {}

  async run(run: RunRow, _recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "flip", "checking", async () => {
      return finish(
        this.d,
        run,
        "flip",
        0,
        { handed_to_josh: 1 },
        "Step 13: Josh sets the campaign ACTIVE by hand and watches day one. Nothing here starts, pauses, or stops a campaign. Interested and Meeting Request only — never raw reply rate. Bounce over 5% on day one means stop.",
      );
    });
  }
}
