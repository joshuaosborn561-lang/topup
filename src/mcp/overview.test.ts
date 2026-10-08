import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunRow } from "../domain/runs.js";
import { clientOverview, OVERVIEW_REASON_MAX } from "./overview.js";

/** D49 — one client in one read: counts, gates, builds and tags; never a lead row. Ask Josh. */

function fakeDb(sql: string[]) {
  return {
    query: async (text: string, params?: unknown[]) => {
      sql.push(text);
      if (text.includes("from topup.client_map")) return { rows: [{ client_tag: "bcp", smartlead_client_id: "542838" }] };
      if (text.includes("from public.campaigns") && text.includes("where smartlead_client_id = $1")) return { rows: [{ id: "10" }, { id: "11" }, { id: "12" }] };
      if (text.includes("coalesce(l.leads_total,0)")) {
        return {
          rows: [
            { smartlead_campaign_id: "10", name: "BCP Healthcare IT", status: "ACTIVE", synced_at: null, leads_total: "500", untouched: "0", sends_window: "70", sends_last_14d: "140", last_send_at: null, interested_window: "1", bounces_window: "0" },
            { smartlead_campaign_id: "11", name: "BCP Logistics IT", status: "ACTIVE", synced_at: null, leads_total: "500", untouched: "0", sends_window: "70", sends_last_14d: "140", last_send_at: null, interested_window: "0", bounces_window: "0" },
            { smartlead_campaign_id: "12", name: "BCP Covered", status: "ACTIVE", synced_at: null, leads_total: "900", untouched: "800", sends_window: "70", sends_last_14d: "140", last_send_at: null, interested_window: "2", bounces_window: "0" },
          ],
        };
      }
      if (text.includes("count(*) filter (where s.sent)")) {
        return { rows: [{ id: "10", sends: "3000", positives: "3" }, { id: "11", sends: "3000", positives: "0" }, { id: "12", sends: "3000", positives: "4" }] };
      }
      if (text.includes("smartlead_client_id::text as client")) return { rows: (params?.[0] as number[]).map((id) => ({ id: String(id), client: "542838" })) };
      if (text.includes("from topup.campaign_method")) {
        return { rows: [{ campaign_id: "10", lane: "it_dm_airpods", company_source: "getleads", domain_source: "already", person_source: "getleads", email_source: "getleads", email_tier: null, company_detail: true, evidence: false }] };
      }
      return { rows: [] };
    },
  };
}

const repo = {
  workingOverrides: async () => new Map<number, boolean | null>(),
  openRunFor: async () => null,
  lastRunForLane: async () => null,
  campaignRegistry: async () => [
    { campaign_id: "10", client_tag: "bcp", smartlead_client_id: "542838", lane: "it_dm_airpods", status: "ACTIVE" },
    { campaign_id: "11", client_tag: "bcp", smartlead_client_id: "542838", lane: "it_dm_airpods", status: "ACTIVE" },
  ],
  campaignBuilds: async () => [
    { smartlead_campaign_id: "10", client_tag: "bcp", lane: "it_dm_airpods", build_label: "getleads_bcp_healthcare_itdm_20260903", company_source: "getleads", company_filters: { job_titles: ["IT Director"], industries: ["Hospitals"], company_size: ["51 to 200"] }, method: "getleads people search on IT titles in hospitals.", leads: 844, interested: 3, email: "nobody@example.com" },
  ],
  openRuns: async () => [{ run_id: "abcdef12-0000", client_tag: "bcp", lane: "it_dm_airpods", status: "awaiting_operator", current_step: "size", counts_by_status: {} } as unknown as RunRow],
  loadsPaused: async () => true,
  clientIcpKind: async () => "linkedin_native",
};

describe("D49 — client_overview", () => {
  it("lists every ACTIVE campaign with its flag, gate, chosen build and tags, empties first, and names the next tool", async () => {
    const sql: string[] = [];
    const out = await clientOverview(fakeDb(sql) as never, repo as never, "bcp");
    assert.ok(!("error" in out));
    if ("error" in out) return;
    assert.equal(out.smartlead_client_id, 542838);
    assert.equal(out.loads_paused, true);
    assert.deepEqual(out.campaigns.map((c) => c.campaign_id), [10, 11, 12]);
    const [a, b, c] = out.campaigns;
    assert.equal(a!.flag, "empty");
    assert.equal(a!.lane, "it_dm_airpods");
    assert.equal(a!.gate, "ok");
    assert.equal(a!.qualifies, true);
    assert.equal(a!.chosen_build?.label, "getleads_bcp_healthcare_itdm_20260903");
    assert.equal(a!.chosen_build?.repeatable, true);
    assert.equal(a!.tags?.company_source, "getleads");
    assert.deepEqual(a!.missing_tags, []);
    assert.equal(b!.gate, "under_reply_bar");
    assert.equal(b!.chosen_build, null, "D47/D49: no build on record is said, not guessed");
    assert.deepEqual(b!.missing_tags, ["campaign_method row or campaign_builds row"]);
    assert.equal(c!.flag, null);
    assert.deepEqual(out.counts, { campaigns: 3, needing_leads: 2, qualifying: 1, without_build_record: 2, missing_tags: 2 });
    assert.deepEqual(out.open_runs, [{ run_id: "abcdef12-0000", lane: "it_dm_airpods", status: "awaiting_operator", step: "size" }]);
    assert.match(out.next, /1 of 2 needy bcp campaign\(s\) pass the policy/);
    assert.match(out.next, /size_client\("bcp"\)/);
    const text = JSON.stringify(out);
    assert.ok(!text.includes("@"), "D2/D49: the overview never carries an address");
    assert.ok(!text.includes("nobody"), "D2/D49: a stray lead column on a build row never reaches the overview");
    for (const c of out.campaigns) assert.ok(c.gate_reason.length <= OVERVIEW_REASON_MAX);
    for (const t of sql) assert.doesNotMatch(t, /select[^;]*\bemail\b(?!_)[^;]*from/i);
  });

  it("refuses a client that is not in topup.client_map", async () => {
    const out = await clientOverview(fakeDb([]) as never, repo as never, "nobody_client");
    assert.ok("error" in out);
    if ("error" in out) assert.match(out.error, /not in topup\.client_map/);
  });
});
