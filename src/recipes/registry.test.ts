import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addRegisteredLaneCampaigns, registryRows, type RegistryCampaign } from "./registry.js";
import type { Recipe } from "./schema.js";

/** D49 — the registry names a lane's campaigns; the inferred routing follows it. Ask Josh. */

function recipe(ids: number[], overrides: Partial<Recipe> = {}): Recipe {
  return {
    recipe_id: "bcp.it_dm_airpods.v0",
    client_tag: "bcp",
    lane: "it_dm_airpods",
    smartlead_client_id: 542838,
    routing: ids.map((id) => ({ when: { slot: String(id) }, campaign_id: id, icp: { kind: "linkedin_native", persona: "it_dm" } })),
    segments: { slot: ids.map(String) },
    ...overrides,
  } as unknown as Recipe;
}

function row(partial: Partial<RegistryCampaign> & { campaign_id: number }): RegistryCampaign {
  return { client_tag: "bcp", smartlead_client_id: 542838, lane: "it_dm_airpods", status: "ACTIVE", campaign_name: `c${partial.campaign_id}`, ...partial };
}

describe("D49 — registry campaigns join the inferred lane", () => {
  it("adds the registry's ACTIVE campaigns on this client and lane, keeps the existing cells, and sorts the slots", () => {
    const out = addRegisteredLaneCampaigns(recipe([3763799, 3763800]), [row({ campaign_id: 3921850 }), row({ campaign_id: 3921852 }), row({ campaign_id: 3763799 })]);
    assert.deepEqual(out.routing.map((r) => r.campaign_id), [3763799, 3763800, 3921850, 3921852]);
    assert.deepEqual(out.segments.slot, ["3763799", "3763800", "3921850", "3921852"]);
    assert.equal(out.routing[2]?.icp.persona, "it_dm", "D49: a registered campaign inherits the lane's icp; its query comes from its build record (D47)");
  });

  it("leaves out another lane, another client, a retired row, a paused status and a never-top-up campaign", () => {
    const out = addRegisteredLaneCampaigns(recipe([1]), [
      row({ campaign_id: 2, lane: "healthcare_exec" }),
      row({ campaign_id: 3, client_tag: "goliath" }),
      row({ campaign_id: 4, smartlead_client_id: 999 }),
      row({ campaign_id: 5, status: "retired" }),
      row({ campaign_id: 6, status: "PAUSED" }),
      row({ campaign_id: 4085158 }),
      row({ campaign_id: 7, campaign_name: "SG Gabe Calls" }),
      row({ campaign_id: 8, smartlead_client_id: null }),
    ]);
    assert.deepEqual(out.routing.map((r) => r.campaign_id), [1, 8], "D49: only this client's ACTIVE rows on this lane join; a row with no client id is trusted on its tag");
  });

  it("is a no-op with nothing to add, and never touches Parlay (D45 keeps the Sept 29 rule)", () => {
    const r = recipe([1]);
    assert.equal(addRegisteredLaneCampaigns(r, [row({ campaign_id: 1 })]), r);
    const parlay = recipe([4049046], { client_tag: "parlay", lane: "ops_dm", smartlead_client_id: 418274 });
    assert.equal(addRegisteredLaneCampaigns(parlay, [row({ campaign_id: 4049063, client_tag: "parlay", lane: "ops_dm", smartlead_client_id: 418274 })]), parlay);
  });

  it("maps raw registry rows and drops a row with no campaign id", () => {
    const rows = registryRows([
      { campaign_id: "3921850", client_tag: "bcp", smartlead_client_id: "542838", lane: "it_dm_airpods", status: null, campaign_name: null },
      { campaign_id: null, client_tag: "bcp" },
    ]);
    assert.deepEqual(rows, [{ campaign_id: 3921850, campaign_name: null, client_tag: "bcp", smartlead_client_id: 542838, lane: "it_dm_airpods", status: null }]);
  });
});
