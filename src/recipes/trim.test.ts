import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trimForeignCampaigns } from "./trim.js";

describe("trimForeignCampaigns", () => {
  const recipe = {
    smartlead_client_id: 548610,
    segments: { slot: ["3798227", "3138854", "3798228"] },
    routing: [
      { when: { slot: "3798227" }, campaign_id: 3798227, icp: { kind: "physical" as const, persona: "gc" } },
      { when: { slot: "3138854" }, campaign_id: 3138854, icp: { kind: "physical" as const, persona: "gc" } },
      { when: { slot: "3798228" }, campaign_id: 3798228, icp: { kind: "physical" as const, persona: "gc" } },
    ],
  };

  it("drops campaigns the mirror assigns to another client and their slots", () => {
    const owners = new Map<number, number | null>([
      [3798227, 548610],
      [3138854, 345263],
      [3798228, 548610],
    ]);
    const out = trimForeignCampaigns(recipe, owners);
    assert.deepEqual(out.dropped, [3138854]);
    assert.deepEqual(
      out.recipe.routing.map((rule) => rule.campaign_id),
      [3798227, 3798228],
    );
    assert.deepEqual(out.recipe.segments.slot, ["3798227", "3798228"]);
  });

  it("keeps a campaign the mirror has not seen", () => {
    const owners = new Map<number, number | null>([[3138854, 345263]]);
    const out = trimForeignCampaigns(recipe, owners);
    assert.deepEqual(
      out.recipe.routing.map((rule) => rule.campaign_id),
      [3798227, 3798228],
    );
  });

  it("does not wipe a recipe when every known campaign is foreign", () => {
    const owners = new Map<number, number | null>([
      [3798227, 345263],
      [3138854, 345263],
      [3798228, 418274],
    ]);
    const out = trimForeignCampaigns(recipe, owners);
    assert.deepEqual(out.dropped, []);
    assert.equal(out.recipe, recipe);
  });
});
