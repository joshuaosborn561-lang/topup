import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { campaignMethodTags, missingTags, provenanceCounts, SOURCE_LEGS, type CampaignMethodTags } from "./tags.js";

/** D49 — the tags are read as counts and method names; never a lead row. Ask Josh. */

const full: CampaignMethodTags = {
  campaign_id: 1,
  lane: "it_dm",
  company_source: "getleads",
  domain_source: "already",
  person_source: "getleads",
  email_source: "getleads",
  email_tier: "getleads",
  company_detail: true,
  evidence: false,
};

describe("D49 — campaignintelligence tags as counts", () => {
  it("names the missing legs, and on a physical list the detail and evidence notes too", () => {
    assert.deepEqual(SOURCE_LEGS, ["company_source", "domain_source", "person_source", "email_source"]);
    assert.deepEqual(missingTags(full, false), []);
    assert.deepEqual(missingTags(full, true), ["evidence"]);
    assert.deepEqual(missingTags({ ...full, person_source: null, email_source: null }, false), ["person_source", "email_source"]);
    assert.deepEqual(missingTags(undefined, false), ["campaign_method row"]);
  });

  it("reads campaign_method as booleans and names, and counts provenance without selecting a lead column", async () => {
    const sql: string[] = [];
    const db = {
      query: async (text: string) => {
        sql.push(text);
        if (text.includes("topup.campaign_method")) {
          return { rows: [{ campaign_id: "7", lane: "owner", company_source: "maps", domain_source: null, person_source: "", email_source: "serp", email_tier: null, company_detail: true, evidence: false }] };
        }
        return { rows: [{ build_label: "maps_x", confidence: "traced", leads: "41" }] };
      },
    };
    const tags = await campaignMethodTags(db as never, [7]);
    assert.deepEqual(tags.get(7), { campaign_id: 7, lane: "owner", company_source: "maps", domain_source: null, person_source: null, email_source: "serp", email_tier: null, company_detail: true, evidence: false });
    const counts = await provenanceCounts(db as never, "vasco", ["maps_x", "", "maps_x"]);
    assert.deepEqual(counts, [{ build_label: "maps_x", confidence: "traced", leads: 41 }]);
    for (const text of sql) {
      assert.doesNotMatch(text, /\bemail\b(?!_)/, "D2/D49: the tag reads never select the email column");
      assert.doesNotMatch(text, /first_name|last_name|phone|linkedin_url/);
    }
    assert.deepEqual(await provenanceCounts(db as never, "vasco", []), []);
  });
});
