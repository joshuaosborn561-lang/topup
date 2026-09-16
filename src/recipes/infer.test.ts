import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePullReceipt, type PullReceipt } from "./receipt.js";
import {
  displayTitle,
  inferRecipe,
  inferTitles,
  inferWatchRecipes,
  isInferredRecipe,
  resolveOrInfer,
  type LeadIcpSnapshot,
  type RecipeResolveDeps,
} from "./infer.js";
import { parseRecipe } from "./schema.js";

function parlayReceipt(over: Record<string, unknown> = {}): PullReceipt {
  return parsePullReceipt({
    granularity: "lane",
    client_tag: "parlay",
    smartlead_client_id: 418274,
    lane: "it_dm_tickets",
    campaign_ids: [3847839, 3847846],
    icp_kind: "linkedin_native",
    persona: "it_dm",
    company_source: "getleads",
    company_filters: {
      job_titles: ["CIO", "IT Director"],
      company_size: ["11 to 50", "51 to 200", "201 to 500"],
      countries: ["United States"],
      export_caps: { max_per_company: 3 },
    },
    domain_source: "already",
    person_source: "getleads",
    email_source: "getleads",
    how_i_did_it: "getleads count then export on IT DM titles for the ticket lane.",
    notes: null,
    ...over,
  });
}

const snapshot: LeadIcpSnapshot = {
  total: 200,
  titled: 180,
  sized: 0,
  titles: [
    { value: "cio", n: 80 },
    { value: "it director", n: 60 },
    { value: "director of it", n: 40 },
  ],
  sizes: [],
};

describe("D38 infer from the list + receipt tags", () => {
  it("displayTitle keeps acronyms and small words", () => {
    assert.equal(displayTitle("cio"), "CIO");
    assert.equal(displayTitle("director of it"), "Director of IT");
  });

  it("inferTitles covers the common titles and unions the receipt", () => {
    const titles = inferTitles(snapshot.titles);
    assert.ok(titles.includes("CIO"));
    assert.ok(titles.includes("IT Director"));
  });

  it("builds a valid v0 recipe from Parlay-shaped tags when leads have no size", () => {
    const r = inferRecipe({
      clientTag: "parlay",
      lane: "it_dm_tickets",
      smartleadClientId: 418274,
      campaignIds: [3847839, 3847846],
      snapshot,
      receipts: [parlayReceipt()],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const recipe = r.recipe;
    assert.equal(recipe.recipe_id, "parlay.it_dm_tickets.v0");
    assert.ok(isInferredRecipe(recipe));
    assert.ok(recipe.owner_approvals.includes("inferred_from_list"));
    assert.equal(recipe.source.kind, "getleads");
    if (recipe.source.kind === "getleads") {
      assert.deepEqual(recipe.source.params.company_size, ["11 to 50", "51 to 200", "201 to 500"]);
      assert.equal(recipe.source.params.max_per_company, 3);
      assert.ok(recipe.source.params.job_titles.includes("CIO"));
    }
    assert.equal(recipe.email_finding.enabled, false);
    assert.equal(recipe.routing.length, 2);
  });

  it("parks Maps; does not invent a getleads pull", () => {
    const r = inferRecipe({
      clientTag: "peterson",
      lane: "c1_general_contractors",
      smartleadClientId: 1,
      campaignIds: [3798227],
      snapshot: { total: 10, titled: 10, sized: 0, titles: [], sizes: [] },
      receipts: [
        parlayReceipt({
          client_tag: "peterson",
          lane: "c1_general_contractors",
          campaign_ids: [3798227],
          icp_kind: "physical",
          persona: "gc_owner_pm",
          company_source: "maps_and_permits",
          company_filters: { maps_runs: [{ businesses: 10 }] },
          domain_source: "domain_waterfall",
          person_source: "people_waterfall",
          email_source: "email_waterfall",
        }),
      ],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.message, /Maps/);
  });

  it("file recipes win; inferred lanes whose campaigns are already covered are skipped", async () => {
    const file = parseRecipe({
      recipe_id: "parlay.it_dm.v3",
      client_tag: "parlay",
      lane: "it_dm",
      smartlead_client_id: 418274,
      supabase_project: "azpapwtnrbzywlnxxecz",
      source: { kind: "getleads", params: { job_titles: ["CIO"], company_size: ["11 to 50"] } },
      suppression: { response_based: true, same_offer_any_client: true },
      email_finding: { enabled: false },
      verify: { seg_split: true },
      normalize: {},
      routing: [{ when: {}, campaign_id: 3847839, icp: { kind: "linkedin_native", persona: "it_dm" } }],
      runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
      working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
      spend: { auto_cap_usd: 5 },
    });
    const upserted: string[] = [];
    const deps: RecipeResolveDeps = {
      findRecipe: async (c, l) => (c === "parlay" && l === "it_dm" ? { recipe_id: file.recipe_id, body: file } : null),
      listPullReceipts: async () => [parlayReceipt()],
      leadIcpSnapshot: async () => snapshot,
      smartleadClientIdFor: async () => 418274,
      upsertRecipe: async (r) => {
        upserted.push(r.recipe_id);
      },
      listReceiptLanes: async () => [{ client_tag: "parlay", lane: "it_dm_tickets", campaign_ids: [3847839, 3847846] }],
    };
    const saved = await resolveOrInfer(deps, { clientTag: "parlay", lane: "it_dm" });
    assert.equal(saved.ok, true);
    if (saved.ok) {
      assert.equal(saved.inferred, false);
      assert.equal(saved.recipe.recipe_id, "parlay.it_dm.v3");
    }
    const extras = await inferWatchRecipes(deps, [file]);
    assert.deepEqual(extras, []);
    assert.deepEqual(upserted, []);
  });
});
