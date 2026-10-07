import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { icpKindForClient, linkedinTamDecision, originalTamFromBuilds } from "./tamSource.js";

const SMALL_OPS = `Lane E. Company: Google Maps Scraper plan custom-1789679826, 404 ZIPs x 25 categories, 34,878 raw in client_emcor.maps_raw, SQL ICP filter to 13,438 with a domain plus 4,885 needing one; scope by plan_id.`;

const PROPERTY = `Lane A. Company and person: getleads count_contacts then export_contacts, run in 3 city chunks from client_emcor.geo_fence. TAM Sept 17 was 1,612 getleads vs 921 to 1,673 AI Ark.`;

const COLLEGES = `Lane D. Company and person: getleads count_contacts then export_contacts in 3 city chunks from client_emcor.geo_fence. TAM Sept 17 was 179 getleads vs 107 to 296 AI Ark.`;

describe("TAM source", () => {
  it("EMCOR Small Ops sizes from its Maps pool, not 0 and not the raw scrape", () => {
    const result = originalTamFromBuilds(
      [{ smartlead_campaign_id: 4036515, company_source: "maps", method: SMALL_OPS, leads: "230" }],
      4036515,
    );
    assert.equal(result.kind, "pool");
    if (result.kind !== "pool") return;
    assert.equal(result.pool, 18323);
    assert.notEqual(result.pool, 34878);
    assert.notEqual(result.tam_total, 0);
    assert.equal(result.tam_total, 18323 - 230);
    assert.match(result.tam_source, /Google Maps/);
    assert.match(result.tam_source, /404/);
  });

  it("EMCOR Property and Colleges do not size from the getleads geo fence count", () => {
    const property = originalTamFromBuilds(
      [{ smartlead_campaign_id: 4036499, company_source: "getleads", method: PROPERTY, tam_count: 1612, rows_found: 1612 }],
      4036499,
    );
    const colleges = originalTamFromBuilds(
      [{ smartlead_campaign_id: 4036513, company_source: "getleads", method: COLLEGES, tam_count: 179 }],
      4036513,
    );
    assert.equal(property.kind, "missing");
    assert.equal(colleges.kind, "missing");
    if (property.kind !== "missing" || colleges.kind !== "missing") return;
    assert.match(property.reason, /tam_source_missing/);
    assert.match(property.tam_source, /getleads geo fence/);
    assert.match(colleges.reason, /tam_source_missing/);
    assert.equal(JSON.stringify(property).includes("1612"), false);
    assert.equal(JSON.stringify(colleges).includes("179"), false);
  });

  it("a Parlay size shows both getleads and AI Ark counts", () => {
    assert.equal(icpKindForClient("parlay"), "linkedin_native");
    assert.equal(icpKindForClient("emcor"), "non_linkedin");
    assert.equal(icpKindForClient("emcor", "linkedin_native"), "linkedin_native");
    const agreed = linkedinTamDecision(1000, 950);
    assert.equal(agreed.tam_check, "ok");
    assert.equal(agreed.tam_total, 1000);
    assert.equal(agreed.getleads_count, 1000);
    assert.equal(agreed.ai_ark_count, 950);
    const apart = linkedinTamDecision(1000, 800);
    assert.equal(apart.tam_check, "tam_mismatch");
    assert.equal(apart.getleads_count, 1000);
    assert.equal(apart.ai_ark_count, 800);
    assert.match(apart.reason ?? "", /tam_mismatch/);
    const unwired = linkedinTamDecision(4040, null);
    assert.equal(unwired.tam_check, "single_source");
    assert.equal(unwired.tam_total, 4040);
    assert.equal(unwired.getleads_count, 4040);
    assert.equal(unwired.ai_ark_count, null);
    assert.equal(unwired.reason, null);
    assert.match(unwired.tam_source, /AI Ark/);
  });
});
