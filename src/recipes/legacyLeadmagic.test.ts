import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jobRecipe } from "../jobs/recipe.js";
import { parsePullReceipt } from "./receipt.js";
import {
  DEFAULT_EMAIL_MAX_TIER,
  legacyReplayWarnings,
  liveEmailMaxTier,
  mapEmailMaxTier,
  mapPersonSource,
  PEOPLE_DEFAULT_ORDER,
} from "./legacyLeadmagic.js";

/** D58 — LeadMagic names are legacy. Replay maps them; stored receipts stay. Ask Josh. */

describe("D58 — LeadMagic legacy mapping", () => {
  it("email_max_tier=leadmagic (and aliases) maps to the aiark ceiling with a warning", () => {
    for (const name of ["leadmagic", "lm", "lead_magic", "LeadMagic"]) {
      const m = mapEmailMaxTier(name);
      assert.equal(m.tier, "aiark", `D58: ${name} is the old ceiling and maps to aiark`);
      assert.equal(m.legacy, true);
      assert.match(m.warning ?? "", /D58/);
      assert.match(m.warning ?? "", /aiark/);
    }
    assert.equal(liveEmailMaxTier("leadmagic"), DEFAULT_EMAIL_MAX_TIER);
    assert.equal(mapEmailMaxTier("prospeo").tier, "prospeo");
    assert.equal(mapEmailMaxTier("prospeo").legacy, false);
    assert.equal(mapEmailMaxTier(null).tier, null);
    assert.equal(mapEmailMaxTier("hunter").tier, null);
  });

  it("legacy person sources map to people_waterfall and the live Find Named Person order", () => {
    const m = mapPersonSource("leadmagic_employee_finder");
    assert.equal(m.source, "people_waterfall");
    assert.deepEqual(m.order, PEOPLE_DEFAULT_ORDER);
    assert.equal(m.legacy, true);
    assert.match(m.warning ?? "", /D58/);
    assert.deepEqual([...PEOPLE_DEFAULT_ORDER], ["site_staff", "cache", "discolike", "prospeo_search", "aiark_people"]);
    assert.equal(mapPersonSource("getleads").source, "getleads");
    assert.equal(mapPersonSource("getleads").legacy, false);
    assert.deepEqual(mapPersonSource("people_waterfall").order, PEOPLE_DEFAULT_ORDER);
  });

  it("a stored receipt with the old names still parses; the mapping does not rewrite it", () => {
    const r = parsePullReceipt({
      granularity: "build",
      client_tag: "vasco",
      lane: "signal_warranty_admin_hiring",
      campaign_ids: [1],
      icp_kind: "physical",
      persona: "warranty_admin",
      company_source: "table",
      domain_source: "already",
      person_source: "leadmagic_employee_finder",
      email_source: "email_waterfall",
      email_max_tier: "leadmagic",
      how_i_did_it: "Historical vasco receipt that still names LeadMagic as the email ceiling.",
    });
    assert.equal(r.email_max_tier, "leadmagic", "D58: parse keeps the stored ceiling");
    assert.equal(r.person_source, "leadmagic_employee_finder", "D58: parse keeps the stored person source");
    const warnings = legacyReplayWarnings([r as unknown as Record<string, unknown>]);
    assert.equal(warnings.length, 2);
    assert.equal(mapEmailMaxTier(r.email_max_tier).tier, "aiark");
    assert.equal(mapPersonSource(r.person_source).source, "people_waterfall");
  });

  it("a new job recipe cannot store leadmagic: the default and the alias both become aiark", () => {
    const spec = {
      client_tag: "bcp",
      smartlead_client_id: 542838,
      lane: "it_dm_airpods",
      campaign_id: 3921850,
      source: "getleads" as const,
      filters: { job_titles: ["CIO"], industries: ["Hospitals"], company_size: ["51 to 200"], countries: ["United States"] },
      max_rows: 200,
    };
    assert.equal(jobRecipe(spec, 1).email_finding.max_tier, "aiark", "D58: the service default is aiark, not leadmagic");
    assert.equal(jobRecipe({ ...spec, email_max_tier: "leadmagic" }, 2).email_finding.max_tier, "aiark");
    assert.throws(() => jobRecipe({ ...spec, email_max_tier: "hunter" }, 3), /unknown email_max_tier/);
  });
});
