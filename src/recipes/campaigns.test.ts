import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  campaignGroups,
  jobTitlesFor,
  resolveTargetCampaignIds,
  ruleSource,
  segmentToBand,
  targetCampaignIds,
  targetCountPatch,
} from "./campaigns.js";
import { parseRecipe } from "./schema.js";

/** D30 — ICP, band, and persona live on the campaign, not the lane. */

function recipe() {
  return parseRecipe({
    recipe_id: "parlay.it_dm.v3",
    client_tag: "parlay",
    lane: "it_dm",
    smartlead_client_id: 418274,
    supabase_project: "azpapwtnrbzywlnxxecz",
    source: {
      kind: "getleads",
      params: { job_titles: ["CIO", "IT Director"], company_size: ["11 to 50", "51 to 200"], email_status: ["VALID"] },
    },
    suppression: { response_based: true, same_offer_any_client: true },
    email_finding: { enabled: false },
    verify: { seg_split: true },
    normalize: {},
    segments: { band: ["11_50", "51_200"] },
    routing: [
      { when: { band: "11_50" }, campaign_id: 1, icp: { kind: "linkedin_native", persona: "it_dm" } },
      { when: { band: "51_200" }, campaign_id: 2, icp: { kind: "linkedin_native", persona: "it_dm" } },
      {
        when: { band: "11_50" },
        campaign_id: 3,
        icp: { kind: "physical", persona: "owner" },
        source: { kind: "maps", params: { categories: ["roofing contractor"] } },
      },
    ],
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 300 },
    spend: { auto_cap_usd: 5 },
  });
}

describe("D30 campaign ICP", () => {
  it("segment keys invert to getleads band labels", () => {
    assert.equal(segmentToBand("11_50"), "11 to 50");
    assert.equal(segmentToBand("10001_plus"), "10001+");
    assert.equal(segmentToBand("nope"), null);
  });

  it("a campaign inherits the recipe source sliced to its band, or names its own", () => {
    const r = recipe();
    const inherited = ruleSource(r, r.routing[0]!);
    assert.equal(inherited.kind, "getleads");
    if (inherited.kind === "getleads") assert.deepEqual(inherited.params.company_size, ["11 to 50"]);
    assert.equal(ruleSource(r, r.routing[2]!).kind, "maps");
  });

  it("groups by kind + persona + source; same persona unions bands", () => {
    const r = recipe();
    const desk = campaignGroups(r, [1, 2]);
    assert.equal(desk.length, 1);
    assert.equal(desk[0]!.key, "linkedin_native|it_dm|getleads");
    assert.deepEqual(desk[0]!.campaignIds, [1, 2]);
    if (desk[0]!.source.kind === "getleads") {
      assert.deepEqual(desk[0]!.source.params.company_size, ["11 to 50", "51 to 200"]);
    }
    assert.equal(campaignGroups(r).length, 2, "owner / maps is a second group");
  });

  it("title audit is the union of the target campaigns' titles", () => {
    const r = recipe();
    assert.deepEqual(jobTitlesFor(r, [1, 2]).sort(), ["CIO", "IT Director"]);
    assert.deepEqual(jobTitlesFor(r, [3]), []);
  });

  it("run targets come from trigger counts, then the run, then the recipe", () => {
    const r = recipe();
    assert.deepEqual(targetCampaignIds(r), [1, 2, 3]);
    assert.deepEqual(targetCampaignIds(r, { campaign_id: 2, counts_by_status: {} }), [2]);
    assert.deepEqual(targetCampaignIds(r, { campaign_id: null, counts_by_status: targetCountPatch([1]) }), [1]);
    assert.equal(resolveTargetCampaignIds(r, [9]).ok, false);
    const one = resolveTargetCampaignIds(r, [1, 1]);
    assert.equal(one.ok, true);
    if (one.ok) assert.deepEqual(one.ids, [1]);
  });
});
