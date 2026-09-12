import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import { recipeCampaignIds } from "../../watch/decide.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";
import { cellLabel, uncoveredCells } from "./cells.js";

/**
 * Step 1 — Nail the ICP for the lane.
 *
 * Josh signs off once; the recipe is that sign-off. A later run (the watch
 * or `/topup`) does not ask again: it checks the saved recipe still covers
 * every cell, then walks on. Missing cells or campaigns that are not this
 * client's in the mirror are the gate — those need Josh, not a guess.
 */
export class TriggerStage {
  constructor(private readonly d: StageDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "trigger", "open", async () => {
      const missing = uncoveredCells(recipe.segments, recipe.routing);
      const campaignIds = recipeCampaignIds(recipe);
      if (campaignIds.length === 0) {
        return gateUnmet("trigger", "the saved recipe has no campaigns in its routing; Josh signs off on the segment before anything is pulled", { cells: 0, campaigns: 0 });
      }
      if (missing.length) {
        return gateUnmet(
          "trigger",
          `saved ICP is missing a campaign for ${missing.length} cell(s): ${missing.slice(0, 6).map(cellLabel).join("; ")}${missing.length > 6 ? "…" : ""}. Josh knows one must be built.`,
          { cells: segmentCount(recipe), uncovered: missing.length, campaigns: campaignIds.length },
        );
      }
      const wrong = await this.foreignCampaigns(campaignIds, recipe.smartlead_client_id);
      if (wrong.length) {
        return gateUnmet(
          "trigger",
          `saved ICP names campaign(s) ${wrong.map((w) => `#${w.id} (${w.reason})`).join(", ")} — every cell needs a campaign of this client before a pull`,
          { cells: segmentCount(recipe), campaigns: campaignIds.length, foreign: wrong.length },
        );
      }
      const cells = segmentCount(recipe);
      return finish(
        this.d,
        run,
        "trigger",
        campaignIds.length,
        { icp_saved: 1, cells, campaigns: campaignIds.length },
        `Step 1: using the saved ICP for ${recipe.client_tag}/${recipe.lane} (\`${recipe.recipe_id}\`) · ${cells} cells → ${campaignIds.length} campaign(s). Not asking Josh again.`,
      );
    });
  }

  private async foreignCampaigns(ids: number[], clientId: number): Promise<Array<{ id: number; reason: string }>> {
    if (ids.length === 0) return [];
    const { rows: t } = await this.d.repo.raw().query<{ ok: boolean }>(`select to_regclass('public.campaigns') is not null as ok`);
    if (!t[0]?.ok) return ids.map((id) => ({ id, reason: "public.campaigns is not here" }));
    const { rows } = await this.d.repo.raw().query<{ id: string; client: string | null }>(
      `select smartlead_campaign_id::text as id, smartlead_client_id::text as client from public.campaigns where smartlead_campaign_id = any($1::bigint[])`,
      [ids],
    );
    const out: Array<{ id: number; reason: string }> = [];
    for (const id of ids) {
      const row = rows.find((r) => Number(r.id) === id);
      if (!row) out.push({ id, reason: "not in the mirror" });
      else if (row.client !== null && Number(row.client) !== clientId) out.push({ id, reason: `belongs to client ${row.client}` });
    }
    return out;
  }
}

function segmentCount(recipe: Recipe): number {
  const dims = Object.values(recipe.segments).filter((v) => v.length > 0);
  if (dims.length === 0) return 0;
  return dims.reduce((n, values) => n * values.length, 1);
}
