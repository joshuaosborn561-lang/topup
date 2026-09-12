import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bestYieldBuild,
  companySourceFromRecipeKind,
  parsePullReceipt,
  proposedTam,
  receiptConfirmed,
  receiptNeedsRecount,
} from "./receipt.js";

/** D31–D33 — a receipt is enough to repeat a build; it never carries rows. */

describe("D31/D32/D33 pull receipts", () => {
  const parlay = {
    granularity: "lane" as const,
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
      email_status: ["VALID"],
      export_caps: { max_per_company: 3 },
    },
    domain_source: "already",
    person_source: "getleads",
    email_source: "getleads",
    rows_found: 11405,
    rows_imported: 11249,
    tam_count: 36810,
    how_i_did_it:
      "getleads count then export on IT DM titles. tam_count is count_contacts; rows_found is the export.",
    notes: "Josh to confirm bands and titles.",
  };

  it("accepts a Parlay-shaped getleads lane row and treats backfill as unconfirmed", () => {
    const r = parsePullReceipt(parlay);
    assert.equal(r.icp_kind, "linkedin_native");
    assert.equal(r.tam_count, 36810);
    assert.equal(receiptConfirmed(r), false);
  });

  it("accepts a Peterson physical lane whose maps_runs reconstruct company counts", () => {
    const r = parsePullReceipt({
      granularity: "lane",
      client_tag: "peterson",
      lane: "c1_general_contractors",
      campaign_ids: [3798227],
      icp_kind: "physical",
      persona: "gc_owner_pm",
      company_source: "maps_and_permits",
      company_filters: {
        maps_runs: [{ run_label: "peterson", businesses: 76830, categories: 72, zips: 832 }],
        permits: { source: "PermitStack", permits: 147366, distinct_contractors: 28767 },
      },
      domain_source: "domain_waterfall",
      person_source: "people_waterfall",
      email_source: "email_waterfall",
      email_max_tier: "leadmagic",
      how_i_did_it: "Maps DFW grid plus PermitStack commercial GC permits. Company counts come from maps_runs, not people.",
    });
    const runs = r.company_filters.maps_runs as Array<{ businesses: number }>;
    assert.equal(runs[0]?.businesses, 76830);
  });

  it("a build may have empty campaign_ids; a lane may not", () => {
    assert.doesNotThrow(() =>
      parsePullReceipt({
        granularity: "build",
        client_tag: "peterson",
        lane: "c1_general_contractors",
        campaign_ids: [],
        icp_kind: "physical",
        persona: "gc_owner_pm",
        company_source: "maps",
        domain_source: "maps",
        person_source: "already",
        email_source: "none",
        build_label: "feed1_owners:gc",
        how_i_did_it: "Pulled from Maps team pages and never loaded to Smartlead.",
      }),
    );
    assert.throws(() => parsePullReceipt({ ...parlay, campaign_ids: [] }), /invalid pull receipt/);
  });

  it("proposes the build with the best imported count, not the lane row", () => {
    const lane = parsePullReceipt(parlay);
    const small = parsePullReceipt({
      ...parlay,
      granularity: "build",
      build_label: "old",
      campaign_ids: [3847839],
      rows_imported: 30,
      notes: null,
    });
    const big = parsePullReceipt({
      ...parlay,
      granularity: "build",
      build_label: "gc_contacts_valid:gc",
      campaign_ids: [3847839],
      rows_imported: 1487,
      notes: null,
    });
    const pick = bestYieldBuild([lane, small, big]);
    assert.equal(pick?.receipt.build_label, "gc_contacts_valid:gc");
  });

  it("D33 — other is not a value; named signals parse; a signal needs rerun filters", () => {
    assert.throws(() => parsePullReceipt({ ...parlay, company_source: "other" }), /invalid pull receipt/);
    assert.throws(() => parsePullReceipt({ ...parlay, domain_source: "other" }), /invalid pull receipt/);
    assert.throws(() => parsePullReceipt({ ...parlay, person_source: "other" }), /invalid pull receipt/);
    assert.throws(() => parsePullReceipt({ ...parlay, email_source: "other" }), /invalid pull receipt/);
    const signal = parsePullReceipt({
      ...parlay,
      company_source: "theirstack_tech_signal",
      company_filters: { technologies: ["Salesforce"], query: "uses Salesforce" },
      domain_source: "theirstack",
      person_source: "leadmagic_employee_finder",
      notes: null,
    });
    assert.equal(signal.company_source, "theirstack_tech_signal");
    assert.equal(signal.domain_source, "theirstack");
    assert.equal(signal.person_source, "leadmagic_employee_finder");
    assert.throws(
      () => parsePullReceipt({ ...parlay, company_source: "job_posting_signal", company_filters: {} }),
      /company_filters/,
    );
  });

  it("D33 — mixed or unnamed recipe sources raise; they do not become other", () => {
    assert.equal(companySourceFromRecipeKind("getleads"), "getleads");
    assert.equal(companySourceFromRecipeKind("supabase_table"), "table");
    assert.throws(() => companySourceFromRecipeKind("mixed"), /'other' is not a value/);
    assert.throws(() => companySourceFromRecipeKind("mystery"), /'other' is not a value/);
  });

  it("D33 — backfill writers and a blank tam_count mean recount before proposing", () => {
    const backfill = parsePullReceipt({ ...parlay, written_by: "claude_backfill", tam_count: null });
    assert.equal(receiptNeedsRecount(backfill), true);
    assert.equal(proposedTam(backfill), null, "do not treat rows_found as TAM");
    const build = parsePullReceipt({
      ...parlay,
      written_by: "claude_backfill_build",
      granularity: "build",
      build_label: "old_export",
      tam_count: null,
      notes: null,
    });
    assert.equal(receiptNeedsRecount(build), true);
    const counted = parsePullReceipt({ ...parlay, written_by: "leadtopup_acceptance", tam_count: 36810, notes: null });
    assert.equal(receiptNeedsRecount(counted), false);
    assert.equal(proposedTam(counted), 36810);
    const blankTam = parsePullReceipt({ ...parlay, written_by: "claude", tam_count: null, notes: null });
    assert.equal(receiptNeedsRecount(blankTam), true);
    assert.equal(proposedTam(blankTam), null);
  });
});
