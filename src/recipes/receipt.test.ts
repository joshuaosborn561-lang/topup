import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePullReceipt } from "./receipt.js";

/** D31 — a first-pull receipt is enough to repeat the list; it never carries rows. */

describe("D31 pull receipts", () => {
  const parlay = {
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
      email_status: ["VALID"],
      max_per_company: 3,
    },
    domain_source: "already",
    person_source: "getleads",
    email_source: "getleads",
    rows_found: 400,
    rows_imported: 380,
    tam_count: 16000,
    how_i_did_it:
      "getleads count then export on IT DM titles, bands 11-50 and 51-200, VALID only. People and emails came with the export. Loaded the two 11-50 team campaigns.",
  };

  it("accepts a Parlay-shaped getleads first pull", () => {
    const r = parsePullReceipt(parlay);
    assert.equal(r.icp_kind, "linkedin_native");
    assert.equal(r.email_source, "getleads");
    assert.equal(r.supabase_project, "azpapwtnrbzywlnxxecz");
  });

  it("accepts a Peterson roof physical pull that still needs the waterfall", () => {
    const r = parsePullReceipt({
      client_tag: "peterson",
      lane: "roof_owner",
      campaign_ids: [1],
      icp_kind: "physical",
      persona: "owner",
      company_source: "maps_and_permits",
      company_filters: { categories: ["roofing contractor"], states: ["TX"], permit_types: ["reroof"] },
      domain_source: "domain_waterfall",
      person_source: "people_waterfall",
      email_source: "email_waterfall",
      email_max_tier: "leadmagic",
      how_i_did_it:
        "Maps roofing categories plus PermitStack reroofs in Texas. Domain Waterfall on the company+city, Find Named Person for owner titles, Name to Email then Email Waterfall to leadmagic.",
    });
    assert.equal(r.company_source, "maps_and_permits");
    assert.equal(r.email_max_tier, "leadmagic");
  });

  it("refuses another project, an empty campaign list, or a short how", () => {
    assert.throws(() => parsePullReceipt({ ...parlay, supabase_project: "kemvxzhcxvynmoutwdrh" }), /invalid pull receipt/);
    assert.throws(() => parsePullReceipt({ ...parlay, campaign_ids: [] }), /invalid pull receipt/);
    assert.throws(() => parsePullReceipt({ ...parlay, how_i_did_it: "getleads" }), /invalid pull receipt/);
  });
});
