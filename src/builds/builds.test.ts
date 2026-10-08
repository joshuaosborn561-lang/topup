import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecordFromRow, buildRecordsFromRows, chooseBuildForCampaign, queryFingerprint, strategyLine } from "./index.js";

const getleadsRow = {
  smartlead_campaign_id: 3921850,
  client_tag: "bcp",
  lane: "it_dm_airpods",
  build_label: "getleads_bcp_healthcare_itdm_20260903",
  company_source: "getleads",
  company_filters: {
    job_titles: ["CIO", "CTO", "Director of IT"],
    company_size: ["51 to 200", "201 to 500"],
    countries: ["United States"],
    industries: ["Hospitals and Health Care", "Medical Practices"],
    max_per_company: 3,
    fallback_personas: ["coo"],
  },
  leads: "1223",
  interested: "5",
  rows_found: "1262",
  rows_imported: "1223",
  tam_count: null,
  how_i_did_it: "getleads count_contacts then export_contacts on senior IT titles, 51 to 1,000, healthcare industries.",
  confidence: "traced",
  written_at: "2026-09-03T10:00:00Z",
};

const mapsRow = {
  smartlead_campaign_id: 4037475,
  client_tag: "emcor",
  lane: "e_small_ops",
  build_label: "emcor_small_ops_maps_20260920",
  company_source: "maps",
  company_filters: { maps: { categories: ["hvac contractor"], states: ["CA"] } },
  leads: "1016",
  interested: "2",
  rows_imported: "1016",
  method: "Google Maps scrape, 137 zips x 9 categories. 13,438 with a domain plus 4,885 needing one.",
  written_at: "2026-09-20T10:00:00Z",
};

describe("D47 — build records are the memory", () => {
  it("a getleads build becomes a vendor_search record with its exact query and fallback persona", () => {
    const rec = buildRecordFromRow(getleadsRow)!;
    assert.equal(rec.source_kind, "vendor_search");
    assert.equal(rec.vendor, "getleads");
    assert.deepEqual(rec.query?.job_titles, ["CIO", "CTO", "Director of IT"]);
    assert.deepEqual(rec.query?.company_size, ["51 to 200", "201 to 500"]);
    assert.deepEqual(rec.query?.industries, ["Hospitals and Health Care", "Medical Practices"]);
    assert.equal(rec.query?.max_per_company, 3);
    assert.deepEqual(rec.query?.fallback_personas, ["coo"]);
    assert.deepEqual(rec.campaigns, [3921850]);
    assert.equal(rec.interested, 5);
    assert.equal(rec.reconstructed, false);
    assert.equal(rec.repeatable.ok, true);
  });

  it("a Maps build is a stored pool with the count from its method note, minus nothing invented", () => {
    const rec = buildRecordFromRow(mapsRow)!;
    assert.equal(rec.source_kind, "stored_pool");
    assert.equal(rec.vendor, "maps");
    assert.equal(rec.query, null);
    assert.equal(rec.pool?.kind, "maps");
    assert.equal(rec.pool?.count, 18_323);
    assert.equal(rec.repeatable.ok, true);
    assert.match(rec.repeatable.why, /18,323/);
  });

  it("titles alone, a backfilled method, or no source is flagged, never guessed", () => {
    const titlesOnly = buildRecordFromRow({ ...getleadsRow, company_filters: { job_titles: ["CIO"] } })!;
    assert.equal(titlesOnly.repeatable.ok, false);
    assert.match(titlesOnly.repeatable.why, /titles alone/);
    const backfill = buildRecordFromRow({ ...getleadsRow, written_by: "claude_backfill_build", confidence: "label_inferred" })!;
    assert.equal(backfill.reconstructed, true);
    const nothing = buildRecordFromRow({ smartlead_campaign_id: 1, build_label: "mystery", client_tag: "x" })!;
    assert.equal(nothing.source_kind, "unknown");
    assert.equal(nothing.repeatable.ok, false);
    const mapsNoCount = buildRecordFromRow({ ...mapsRow, method: "Google Maps scrape in CA." })!;
    assert.equal(mapsNoCount.pool?.count, null);
    assert.equal(mapsNoCount.repeatable.ok, false);
  });

  it("rows sharing a label are one build that fed several campaigns", () => {
    const recs = buildRecordsFromRows([getleadsRow, { ...getleadsRow, smartlead_campaign_id: 3921854, interested: "2", leads: "900" }]);
    assert.equal(recs.length, 1);
    assert.deepEqual(recs[0]?.campaigns, [3921850, 3921854]);
    assert.equal(recs[0]?.interested, 7);
    assert.equal(recs[0]?.leads, 2123);
  });

  it("the fingerprint ignores list order and names the pool two campaigns share", () => {
    const a = buildRecordFromRow(getleadsRow)!.query;
    const b = buildRecordFromRow({ ...getleadsRow, company_filters: { ...getleadsRow.company_filters, job_titles: ["Director of IT", "CTO", "CIO"], industries: ["Medical Practices", "Hospitals and Health Care"] } })!.query;
    assert.equal(queryFingerprint(a), queryFingerprint(b));
    const c = buildRecordFromRow({ ...getleadsRow, company_filters: { ...getleadsRow.company_filters, industries: ["Truck Transportation"] } })!.query;
    assert.notEqual(queryFingerprint(a), queryFingerprint(c));
    assert.equal(queryFingerprint(null), "none");
  });

  it("chooses the build that earned the replies, then the latest repeatable one, then says it cannot", () => {
    const old = buildRecordFromRow({ ...getleadsRow, build_label: "old_build", interested: "9", written_at: "2026-08-01T00:00:00Z" })!;
    const recent = buildRecordFromRow({ ...getleadsRow, build_label: "recent_build", interested: "1", written_at: "2026-09-03T00:00:00Z" })!;
    const earned = chooseBuildForCampaign(3921850, [recent, old]);
    assert.equal(earned.build?.build_label, "old_build");
    assert.equal(earned.earned_replies, true);
    assert.equal(earned.repeatable, true);

    const quiet = buildRecordFromRow({ ...getleadsRow, build_label: "quiet", interested: "0", written_at: "2026-09-10T00:00:00Z" })!;
    const unrepeatable = buildRecordFromRow({ ...getleadsRow, build_label: "thin", interested: "0", company_filters: { job_titles: ["CIO"] }, written_at: "2026-09-12T00:00:00Z" })!;
    const fallback = chooseBuildForCampaign(3921850, [quiet, unrepeatable]);
    assert.equal(fallback.build?.build_label, "quiet");
    assert.equal(fallback.earned_replies, false);
    assert.equal(fallback.repeatable, true);

    const stuck = chooseBuildForCampaign(3921850, [unrepeatable]);
    assert.equal(stuck.repeatable, false);
    assert.match(stuck.reason, /cannot be repeated/);

    const none = chooseBuildForCampaign(999, [old]);
    assert.equal(none.build, null);
    assert.match(none.reason, /no build on record/);
  });

  it("the strategy line names the build and the vendor, never a person", () => {
    const rec = buildRecordFromRow(getleadsRow)!;
    const line = strategyLine(rec, "bcp.it_dm_airpods.v0");
    assert.match(line, /Repeats getleads_bcp_healthcare_itdm_20260903 \(getleads, 5 interested\)/);
    assert.equal(line.includes("@"), false);
    assert.match(strategyLine(null, "bcp.it_dm_airpods.v0"), /No build on record/);
  });
});
