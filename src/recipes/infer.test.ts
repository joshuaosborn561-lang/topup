import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getleadsParamsFromFilters, recipeFromReceipts, sourceFromStamp, type ReceiptStamp } from "./infer.js";

function stamp(over: Partial<ReceiptStamp> = {}): ReceiptStamp {
  return {
    written_by: "claude",
    client_tag: "parlay",
    smartlead_client_id: 418274,
    lane: "it_dm",
    campaign_ids: [3847839, 3847846],
    icp_kind: "linkedin_native",
    persona: "it_dm",
    company_source: "getleads",
    company_filters: {
      job_titles: ["CIO", "IT Director"],
      company_size: ["11 to 50", "51 to 200"],
      countries: ["United States"],
    },
    email_source: "getleads",
    email_max_tier: null,
    how_i_did_it: "getleads count then export on IT DM titles from the receipt.",
    notes: null,
    segment: null,
    granularity: "lane",
    rows_imported: 380,
    ...over,
  };
}

describe("D45 infer recipe from pull receipts", () => {
  it("copies getleads titles and bands from the receipt and omits invented ones", () => {
    const params = getleadsParamsFromFilters({
      job_titles: ["Owner"],
      company_size: ["11 to 50", "any (individuals)"],
      email_status: ["VALID"],
    });
    assert.deepEqual(params?.job_titles, ["Owner"]);
    assert.deepEqual(params?.company_size, ["11 to 50"]);
    assert.equal(getleadsParamsFromFilters({ job_titles: ["Owner"], company_size: ["any"] }), null);
    assert.equal(getleadsParamsFromFilters({ company_size: ["11 to 50"] }), null);
  });

  it("builds a walkable recipe from a getleads lane receipt", () => {
    const recipe = recipeFromReceipts({ receipts: [stamp()], smartleadClientId: 418274 });
    assert.equal(recipe.recipe_id, "parlay.it_dm.v0");
    assert.equal(recipe.source.kind, "getleads");
    if (recipe.source.kind === "getleads") {
      assert.deepEqual(recipe.source.params.job_titles, ["CIO", "IT Director"]);
      assert.ok(!("email_status" in recipe.source.params));
    }
    assert.deepEqual(recipe.routing.map((r) => r.campaign_id), [3847839, 3847846]);
  });

  it("does not invent getleads bands when the receipt used a non-band size", () => {
    const src = sourceFromStamp(
      stamp({
        client_tag: "powergryd",
        lane: "vciso",
        company_filters: { company_size: "any (individuals and one person shops)", countries: ["United States"] },
        how_i_did_it: "vCISO persona terms plus email waterfall. company_size was the string any.",
        notes: "do not invent a band",
      }),
    );
    assert.equal(src.kind, "mixed");
    if (src.kind === "mixed") assert.match(src.note, /Do not invent/);
  });

  it("file-shaped merge prefers the file recipe on the same lane", async () => {
    const { mergeRecipes } = await import("./infer.js");
    const file = recipeFromReceipts({ receipts: [stamp()], smartleadClientId: 418274 });
    const inferred = recipeFromReceipts({
      receipts: [stamp({ lane: "it_dm", campaign_ids: [1] })],
      smartleadClientId: 418274,
    });
    const merged = mergeRecipes([{ ...file, recipe_id: "parlay.it_dm.v3" }], [inferred]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.recipe_id, "parlay.it_dm.v3");
  });

  it("infers any client's receipt, not a PowerGRYD-only file pack", () => {
    const peterson = recipeFromReceipts({
      receipts: [
        stamp({
          client_tag: "peterson",
          lane: "roof_owners",
          campaign_ids: [3798227],
          persona: "owner",
          company_filters: {
            job_titles: ["Owner", "President"],
            company_size: ["11 to 50"],
            countries: ["United States"],
          },
        }),
      ],
      smartleadClientId: 1,
    });
    assert.equal(peterson.recipe_id, "peterson.roof_owners.v0");
    assert.equal(peterson.source.kind, "getleads");

    const emcor = recipeFromReceipts({
      receipts: [
        stamp({
          client_tag: "emcor",
          lane: "service_dm",
          campaign_ids: [2],
          persona: "service_dm",
          company_filters: {
            job_titles: ["Service Manager"],
            company_size: ["51 to 200"],
          },
        }),
      ],
      smartleadClientId: 2,
    });
    assert.equal(emcor.recipe_id, "emcor.service_dm.v0");

    const powergryd = recipeFromReceipts({
      receipts: [
        stamp({
          client_tag: "powergryd",
          lane: "msp_owner",
          campaign_ids: [4005226],
          persona: "owner",
          company_filters: {
            job_titles: ["Owner"],
            company_size: ["11 to 50"],
            countries: ["United States"],
          },
          notes: "repeat the last getleads owner pull",
        }),
      ],
      smartleadClientId: 592842,
    });
    assert.equal(powergryd.recipe_id, "powergryd.msp_owner.v0");
    assert.equal(powergryd.source.kind, "getleads");
  });
});
