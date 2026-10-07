import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getleadsParamsFromFilters, mergeRecipes, recipeFromReceipts, type ReceiptStamp } from "./infer.js";
import { routingFromRegistry } from "./registry.js";
import {
  PARLAY_REFRESH_FIRST,
  PARLAY_REFRESH_LAST,
  PARLAY_RETIRED_CAMPAIGN_IDS,
  isParlayRefreshCampaign,
  parlayCampaignRetired,
  parlayQueueKeeps,
  parlayCampaignIndustries,
  shapeParlayRecipe,
} from "./parlay.js";
import { parseRecipe, type Recipe } from "./schema.js";

function stamp(over: Partial<ReceiptStamp> = {}): ReceiptStamp {
  return {
    written_by: "claude",
    client_tag: "parlay",
    smartlead_client_id: 418274,
    lane: "it_dm",
    campaign_ids: [4049055],
    icp_kind: "linkedin_native",
    persona: "it_dm",
    company_source: "getleads",
    company_filters: {
      job_function: "Information Technology",
      seniority: ["C-Team", "VP", "Director", "Manager"],
      industries: ["Financial Services"],
      company_size: ["11 to 50", "51 to 200", "201 to 500"],
      countries: ["United States"],
      email_status: ["VALID"],
      max_per_company: 3,
    },
    email_source: "getleads",
    email_max_tier: null,
    how_i_did_it: "Sept 29 IT DM counted by job function and seniority.",
    notes: null,
    segment: null,
    granularity: "lane",
    rows_imported: 10,
    ...over,
  };
}

describe("Parlay Sept 29 refresh", () => {
  it("retires the sports, tickets, and choice campaigns and keeps 4049046 to 4049064", () => {
    for (const id of [3479011, 3628957, 3705889, 3847837, 3847850, 3929973, 3929974]) {
      assert.equal(parlayCampaignRetired(id), true, String(id));
      assert.equal(parlayQueueKeeps("parlay", id), false);
    }
    assert.equal(PARLAY_RETIRED_CAMPAIGN_IDS.length, 3 + 14 + 2);
    assert.equal(isParlayRefreshCampaign(PARLAY_REFRESH_FIRST), true);
    assert.equal(isParlayRefreshCampaign(PARLAY_REFRESH_LAST), true);
    assert.equal(parlayQueueKeeps("parlay", 4049045), false);
    assert.equal(parlayQueueKeeps("parlay", 4049065), false);
    assert.equal(parlayQueueKeeps("parlay", 4049055), true);
    assert.equal(parlayQueueKeeps("bcp", 3479011), true);
  });

  it("copies job function and seniority instead of inventing titles", () => {
    const params = getleadsParamsFromFilters(stamp().company_filters);
    assert.equal(params?.job_titles, undefined);
    assert.equal(params?.job_function, "Information Technology");
    assert.deepEqual(params?.seniority, ["C-Team", "VP", "Director", "Manager"]);
    assert.deepEqual(params?.company_size, ["11 to 50", "51 to 200", "201 to 500"]);
    assert.deepEqual(params?.email_status, ["VALID"]);
    assert.equal(params?.max_per_company, 3);
    const recipe = recipeFromReceipts({ receipts: [stamp({ campaign_ids: [3847839, 4049055] })], smartleadClientId: 418274 });
    assert.equal(recipe.source.kind, "getleads");
  });

  it("drops a file that only names retired campaigns so the Sept 29 recipe wins", () => {
    const oldFile = recipeFromReceipts({
      receipts: [
        stamp({
          campaign_ids: [3929973, 3847839],
          lane: "it_dm",
          how_i_did_it: "August tickets pull on IT titles.",
          company_filters: { job_titles: ["IT Director"], company_size: ["11 to 50"], countries: ["United States"] },
        }),
      ],
      smartleadClientId: 418274,
    });
    const inferred = recipeFromReceipts({
      receipts: [stamp({ campaign_ids: [4049055, 4049056] })],
      smartleadClientId: 418274,
    });
    const merged = mergeRecipes([{ ...oldFile, recipe_id: "parlay.it_dm.v3" }], [inferred]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.recipe_id, "parlay.it_dm.v0");
    assert.deepEqual(merged[0]?.routing.map((rule) => rule.campaign_id), [4049055, 4049056, 4049061, 4049062]);
    const shaped = shapeParlayRecipe(oldFile);
    assert.deepEqual(shaped.routing, []);
  });

  it("a Parlay size rebuild targets only 4049046 to 4049064 on that lane", () => {
    const recipe = parseRecipe({
      recipe_id: "parlay.it_dm.v0",
      client_tag: "parlay",
      lane: "it_dm",
      smartlead_client_id: 418274,
      supabase_project: "azpapwtnrbzywlnxxecz",
      source: {
        kind: "getleads",
        params: {
          job_function: "Information Technology",
          seniority: ["Director"],
          company_size: ["11 to 50", "51 to 200", "201 to 500"],
          countries: ["United States"],
          email_status: ["VALID"],
        },
      },
      suppression: { response_based: true, same_offer_any_client: true },
      email_finding: { enabled: false },
      verify: { seg_split: true },
      normalize: {},
      segments: { slot: ["3929973", "4049055"] },
      routing: [
        { when: { slot: "3929973" }, campaign_id: 3929973, icp: { kind: "linkedin_native", persona: "it_dm" } },
        { when: { slot: "4049055" }, campaign_id: 4049055, icp: { kind: "linkedin_native", persona: "it_dm" } },
      ],
      runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
      working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
      spend: { auto_cap_usd: 5 },
    }) as Recipe;
    const rebuilt = routingFromRegistry(recipe, [
      { campaign_id: 3929973, client_tag: "parlay", smartlead_client_id: 418274, lane: "it_dm", status: "ACTIVE" },
      { campaign_id: 4049055, client_tag: "parlay", smartlead_client_id: 418274, lane: "it_dm", status: "ACTIVE" },
      { campaign_id: 4049056, client_tag: "parlay", smartlead_client_id: 418274, lane: "it_dm", status: "ACTIVE" },
      { campaign_id: 4049062, client_tag: "parlay", smartlead_client_id: 418274, lane: "it_dm", status: "retired" },
      { campaign_id: 4049046, client_tag: "parlay", smartlead_client_id: 418274, lane: "ops_dm", status: "ACTIVE" },
      { campaign_id: 4049065, client_tag: "parlay", smartlead_client_id: 418274, lane: "it_dm", status: "ACTIVE" },
    ]);
    assert.deepEqual(rebuilt.routing.map((rule) => rule.campaign_id), [4049055, 4049056]);
  });

  it("gives FinServ and Architecture their receipt industries and leaves the unnamed sibling list off", () => {
    assert.deepEqual(parlayCampaignIndustries(4049053), ["Financial Services"]);
    assert.deepEqual(parlayCampaignIndustries(4049046), ["Financial Services"]);
    assert.deepEqual(parlayCampaignIndustries(4049063), ["Architecture and Planning"]);
    assert.equal(parlayCampaignIndustries(4049047), null);
    const ops = parseRecipe({
      recipe_id: "parlay.ops_dm.v0",
      client_tag: "parlay",
      lane: "ops_dm",
      smartlead_client_id: 418274,
      supabase_project: "azpapwtnrbzywlnxxecz",
      source: {
        kind: "getleads",
        params: {
          job_function: "Operations",
          seniority: ["C-Team", "VP", "Director"],
          company_size: ["11 to 50", "51 to 200", "201 to 500"],
          countries: ["United States"],
          email_status: ["VALID"],
          max_per_company: 3,
        },
      },
      suppression: { response_based: true, same_offer_any_client: true },
      email_finding: { enabled: false },
      verify: { seg_split: true },
      normalize: {},
      segments: { slot: ["4049046", "4049063"] },
      routing: [
        { when: { slot: "4049046" }, campaign_id: 4049046, icp: { kind: "linkedin_native", persona: "ops_dm" } },
        { when: { slot: "4049063" }, campaign_id: 4049063, icp: { kind: "linkedin_native", persona: "ops_dm" } },
      ],
      runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
      working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
      spend: { auto_cap_usd: 5 },
    }) as Recipe;
    const shaped = shapeParlayRecipe(ops);
    const finserv = shaped.routing.find((rule) => rule.campaign_id === 4049046)?.source;
    const arch = shaped.routing.find((rule) => rule.campaign_id === 4049063)?.source;
    assert.equal(finserv?.kind, "getleads");
    assert.equal(arch?.kind, "getleads");
    if (finserv?.kind === "getleads" && arch?.kind === "getleads") {
      assert.deepEqual(finserv.params.industries, ["Financial Services"]);
      assert.deepEqual(arch.params.industries, ["Architecture and Planning"]);
      assert.equal(finserv.params.job_function, "Operations");
      assert.equal(arch.params.job_function, "Operations");
      assert.notDeepEqual(finserv.params.industries, arch.params.industries);
    }
    const owner = shapeParlayRecipe({
      ...ops,
      recipe_id: "parlay.owner.v0",
      lane: "owner",
      routing: [{ when: { slot: "4049053" }, campaign_id: 4049053, icp: { kind: "linkedin_native", persona: "owner" } }],
    });
    const ownerSource = owner.routing[0]?.source;
    assert.equal(ownerSource?.kind, "getleads");
    if (ownerSource?.kind === "getleads") assert.deepEqual(ownerSource.params.industries, ["Financial Services"]);
  });
});
