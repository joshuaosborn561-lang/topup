import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { campaignRecord } from "./record.js";

/** D52 — campaign_record: what Supabase holds, newest first, counted by leg, never a lead row. Ask Josh. */

const db = {
  query: async (text: string) => {
    if (text.includes("count(*) filter (where s.sent)")) return { rows: [{ id: "7", sends: "2000", positives: "1" }] };
    if (text.includes("group by 1, 2\n")) return { rows: [{ build_label: "b2", confidence: "traced", leads: "300" }] };
    if (text.includes("company_source, domain_source, person_source, email_source, count(*)")) {
      return { rows: [{ company_source: "getleads", domain_source: "already", person_source: "getleads", email_source: "getleads", leads: "280" }, { company_source: "getleads", domain_source: "already", person_source: "getleads", email_source: "email_waterfall", leads: "20" }] };
    }
    return { rows: [] };
  },
};
const repo = {
  listPullReceipts: async () => [
    { written_by: "josh", written_at: "2026-09-03", lane: "it_dm", campaign_ids: [7], icp_kind: "linkedin_native", persona: "it_dm", granularity: "build", build_label: "b1", company_source: "getleads", company_filters: { job_titles: ["CIO"] }, domain_source: "already", person_source: "getleads", email_source: "getleads", email_max_tier: null, rows_found: 800, rows_imported: 700, tam_count: 1857, segment: null, yield_by_step: { pulled: 800 }, how_i_did_it: "getleads on CIO titles in hospitals.", notes: null, email: "stray@example.com" },
    { written_by: "josh", written_at: "2026-09-07", lane: "it_dm", campaign_ids: [7], icp_kind: "linkedin_native", persona: "it_dm", granularity: "build", build_label: "b2", company_source: "getleads", company_filters: { job_titles: ["CIO"], company_size: ["501 to 1000"] }, domain_source: "already", person_source: "getleads", email_source: "made_up", email_max_tier: "leadmagic", rows_found: 300, rows_imported: 300, tam_count: 900, segment: null, yield_by_step: null, how_i_did_it: "same titles, 501 to 1000.", notes: "second pass", first_name: "Jane" },
  ],
  campaignBuilds: async () => [{ smartlead_campaign_id: "7", build_label: "b2", company_source: "getleads", leads: 300, interested: 1, method: "same titles, 501 to 1000.", email: "x@example.com" }],
  campaignRegistry: async () => [{ campaign_id: "7", client_tag: "bcp", smartlead_client_id: "542838", lane: "it_dm", status: "ACTIVE", campaign_name: "BCP IT" }],
};

describe("D52 — campaign_record", () => {
  it("returns receipts newest first with their filters and notes, builds, counts by label and leg, the registry row and the rule, and drops stray lead columns", async () => {
    const r = await campaignRecord(db as never, repo as never, "bcp", 7);
    assert.equal(r.receipts.length, 2);
    assert.equal(r.receipts[0]?.build_label, "b2");
    assert.deepEqual(r.receipts[1]?.company_filters, { job_titles: ["CIO"] });
    assert.deepEqual(r.notes, ["same titles, 501 to 1000.", "second pass", "getleads on CIO titles in hospitals."], "newest receipt first");
    assert.equal(r.builds[0]?.leads, 300);
    assert.deepEqual(r.leads_by_label, [{ build_label: "b2", confidence: "traced", leads: 300 }]);
    assert.equal(r.leads_by_leg[0]?.leads, 280);
    assert.equal(r.registry?.lane, "it_dm");
    assert.equal(r.performance.passes_reply_bar, true);
    assert.ok(r.sources.lines.some((l) => l.leg === "email" && l.value === "email_waterfall"));
    assert.deepEqual(r.sources.unknown, [{ leg: "email", value: "made_up" }]);
    const text = JSON.stringify(r);
    assert.ok(!text.includes("@") && !text.includes("Jane"), "D2/D52: stray lead columns never reach the record");
    assert.match(r.how_to_read, /Repeat the legs that fed most of the leads/);
  });
});
