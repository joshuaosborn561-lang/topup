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
    assert.deepEqual(missingTags(undefined, false), ["campaign_method row or campaign_builds row"]);
  });

  it("reads campaign_method as booleans and names, and counts provenance without selecting a lead column", async () => {
    const sql: string[] = [];
    const db = {
      query: async (text: string) => {
        sql.push(text);
        if (text.includes("topup.campaign_method")) {
          return { rows: [{ campaign_id: "7", lane: "owner", company_source: "maps", domain_source: null, person_source: "", email_source: "serp", email_tier: null, company_detail: true, evidence: false }] };
        }
        if (text.includes("topup.campaign_builds")) {
          return { rows: [{ campaign_id: "8", lane: "it_dm", company_source: "getleads", domain_source: "already", person_source: "getleads", email_source: "getleads", email_tier: "getleads", company_detail: true }] };
        }
        return { rows: [{ build_label: "maps_x", confidence: "traced", leads: "41" }] };
      },
    };
    const tags = await campaignMethodTags(db as never, [7, 8]);
    assert.deepEqual(tags.get(7), { campaign_id: 7, lane: "owner", company_source: "maps", domain_source: null, person_source: null, email_source: "serp", email_tier: null, company_detail: true, evidence: false });
    assert.deepEqual(tags.get(8), { campaign_id: 8, lane: "it_dm", company_source: "getleads", domain_source: "already", person_source: "getleads", email_source: "getleads", email_tier: "getleads", company_detail: true, evidence: false }, "D49: a campaign with no campaign_method row reads its latest build's legs");
    const counts = await provenanceCounts(db as never, "vasco", ["maps_x", "", "maps_x"]);
    assert.deepEqual(counts, [{ build_label: "maps_x", confidence: "traced", leads: 41 }]);
    for (const text of sql) {
      assert.doesNotMatch(text, /\bemail\b(?!_)/, "D2/D49: the tag reads never select the email column");
      assert.doesNotMatch(text, /first_name|last_name|phone|linkedin_url/);
    }
    assert.deepEqual(await provenanceCounts(db as never, "vasco", []), []);
  });

  it("D74 — a campaign id scopes the stamp count to that campaign", async () => {
    const sql: string[] = [];
    const db = {
      query: async (text: string) => {
        sql.push(text);
        if (text.includes("to_regclass")) return { rows: [{ leads: true, campaigns: true }] };
        return { rows: [{ build_label: "itdm_501_1000", confidence: "traced", leads: "200" }] };
      },
    };
    const counts = await provenanceCounts(db as never, "bcp", ["itdm_501_1000"], 3763801);
    assert.deepEqual(counts, [{ build_label: "itdm_501_1000", confidence: "traced", leads: 200 }]);
    assert.ok(sql.some((q) => q.includes("smartlead_campaign_id") && q.includes("exists")), "D74: twins sharing a build are not one count");
    for (const text of sql) {
      assert.doesNotMatch(text, /select\s+p\.email\b/i, "D2/D74: the campaign scope is an EXISTS, never a selected email");
    }
  });
});
