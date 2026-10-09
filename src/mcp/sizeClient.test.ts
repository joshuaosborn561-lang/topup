import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Recipe } from "../recipes/schema.js";
import { lanesForCampaigns } from "./sizeClient.js";

function recipe(lane: string, ids: number[]): Recipe {
  return { client_tag: "powergryd", lane, routing: ids.map((id) => ({ campaign_id: id })) } as Recipe;
}

describe("D50 — size_client routes by campaign_registry", () => {
  it("opens the registry lane, not the first recipe that mentions the campaign", () => {
    const recipes = [recipe("msp_sec_leads", [4005226, 4005223]), recipe("name_bank", [4005228]), recipe("vciso", [4005234])];
    const registry = new Map<number, string>([
      [4005226, "vciso"],
      [4005228, "vciso"],
    ]);
    const { targets, missing } = lanesForCampaigns(recipes, registry, { clientTag: "powergryd", campaignIds: [4005226, 4005228], by: "test" });
    assert.deepEqual(missing, []);
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.lane, "vciso");
    assert.deepEqual(targets[0]?.campaignIds, [4005226, 4005228]);
  });

  it("an id on no lane is reported and does not open another lane", () => {
    const { targets, missing } = lanesForCampaigns([], new Map(), { clientTag: "bcp", campaignIds: [111], by: "test" });
    assert.deepEqual(targets, []);
    assert.equal(missing.length, 1);
    assert.match(missing[0]?.message ?? "", /not on a lane/);
    assert.match(missing[0]?.message ?? "", /111/);
  });

  it("Peterson C2 and C3 stay on their own lanes", () => {
    const registry = new Map<number, string>([
      [3798230, "c2_property_managers"],
      [3798231, "c3_churches"],
      [3798232, "c3_churches"],
    ]);
    const { targets, missing } = lanesForCampaigns([], registry, {
      clientTag: "peterson",
      campaignIds: [3798230, 3798231, 3798232],
      by: "test",
    });
    assert.deepEqual(missing, []);
    const lanes = targets.map((t) => t.lane).sort();
    assert.deepEqual(lanes, ["c2_property_managers", "c3_churches"]);
    const churches = targets.find((t) => t.lane === "c3_churches");
    assert.deepEqual(churches?.campaignIds, [3798231, 3798232]);
  });
});
