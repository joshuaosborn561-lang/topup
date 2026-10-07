import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { outboundFilters } from "../clients/getleads.js";
import { isSuspectFilter } from "../stages/size/campaignReport.js";
import type { Recipe } from "./schema.js";
import { linkedinHeadcountKeeps, sameOfferExcludedClients, shapeMspOwnersRecipe } from "./powergryd.js";

describe("PowerGRYD MSP owners filter", () => {
  it("replaces the empty mixed source with the Sept 22 getleads filter", () => {
    const recipe = {
      recipe_id: "powergryd.msp_owners.v0",
      client_tag: "powergryd",
      lane: "msp_owners",
      email_finding: { enabled: false, max_tier: "aiark", fullenrich: false, batch_rows: 200, steps: [] },
      routing: [{ when: { slot: "4005218" }, campaign_id: 4005218, icp: { kind: "linkedin_native", persona: "owner" } }],
      source: { kind: "mixed", note: "receipt did not name its lists", parts: [] },
    } as Recipe;
    const shaped = shapeMspOwnersRecipe(recipe);
    assert.equal(shaped.source.kind, "getleads");
    if (shaped.source.kind !== "getleads") return;
    const sent = outboundFilters(shaped.source.params);
    assert.deepEqual(sent.job_titles, ["Owner", "Co-Owner", "Founder", "Co-Founder", "President", "CEO"]);
    assert.deepEqual(sent.company_size, ["11 to 50", "51 to 200"]);
    assert.deepEqual(sent.countries, ["United States"]);
    assert.deepEqual(sent.industries, ["IT Services and IT Consulting"]);
    assert.equal(sent.company_description, "managed service provider");
    assert.deepEqual(sent.email_status, ["VALID"]);
    assert.equal(sent.max_per_company, undefined);
    assert.equal(shaped.source.params.max_per_company, 2);
    assert.equal(sent.employee_profiles_on_linkedin_min, undefined);
    assert.equal(shaped.email_finding.enabled, true);
    assert.equal(shaped.email_finding.max_tier, "prospeo");
    assert.deepEqual(sameOfferExcludedClients(shaped), ["culture_fits"]);
  });

  it("keeps a low-thousands TAM and parks the million-row filter", () => {
    const buildRows = 1362;
    assert.equal(isSuspectFilter(2400, buildRows, 40_000), false);
    assert.equal(isSuspectFilter(1_077_824, buildRows, 40_000), true);
  });

  it("drops LinkedIn profile counts outside 20 to 100 and keeps a missing count", () => {
    assert.equal(linkedinHeadcountKeeps(19), false);
    assert.equal(linkedinHeadcountKeeps(20), true);
    assert.equal(linkedinHeadcountKeeps(100), true);
    assert.equal(linkedinHeadcountKeeps(101), false);
    assert.equal(linkedinHeadcountKeeps(null), true);
  });
});
