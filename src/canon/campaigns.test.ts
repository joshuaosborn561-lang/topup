import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listCampaigns } from "./campaigns.js";

/** D52 — campaigns: the numbers Grok picks on, the rule stated, no other judgement. Ask Josh. */

function fakeDb() {
  return {
    query: async (text: string, params?: unknown[]) => {
      if (text.includes("from topup.client_map")) return { rows: [{ client_tag: "bcp", smartlead_client_id: "542838" }, { client_tag: "salesglider", smartlead_client_id: "345263" }] };
      if (text.includes("from public.campaigns") && text.includes("where smartlead_client_id = $1")) {
        return params?.[0] === 542838 ? { rows: [{ id: "10" }, { id: "11" }] } : { rows: [{ id: "4085158" }] };
      }
      if (text.includes("coalesce(l.leads_total,0)")) {
        const ids = params?.[0] as number[];
        return { rows: ids.map((id) => ({ smartlead_campaign_id: String(id), name: id === 4085158 ? "SG Gabe Calls" : `c${id}`, status: "ACTIVE", synced_at: null, leads_total: "500", untouched: id === 10 ? "20" : "900", sends_window: "70", sends_last_14d: "140", last_send_at: null, interested_window: "1", bounces_window: "0" })) };
      }
      if (text.includes("count(*) filter (where s.sent)")) {
        return { rows: [{ id: "10", sends: "4000", positives: "2" }, { id: "11", sends: "4000", positives: "1" }, { id: "4085158", sends: "100", positives: "5" }] };
      }
      return { rows: [] };
    },
  };
}
const repo = { campaignRegistry: async () => [{ campaign_id: "10", client_tag: "bcp", lane: "it_dm_airpods", status: "ACTIVE" }] };

describe("D52 — campaigns", () => {
  it("lists every client's ACTIVE campaigns with sends, positives, the rate per 2,000 and the bar; passing and emptiest first", async () => {
    const out = await listCampaigns(fakeDb() as never, repo, null);
    assert.ok(!("error" in out));
    if ("error" in out) return;
    assert.match(out.rule, /1 positive reply per 2,000 sends/);
    assert.deepEqual(out.campaigns.map((c) => c.campaign_id), [10, 11], "over the bar first, then the emptiest; the cold call campaign is left off (D54)");
    const ten = out.campaigns.find((c) => c.campaign_id === 10)!;
    assert.equal(ten.rate_per_2000, 1);
    assert.equal(ten.passes_reply_bar, true);
    assert.equal(ten.lane, "it_dm_airpods");
    assert.equal(ten.untouched, 20);
    const eleven = out.campaigns.find((c) => c.campaign_id === 11)!;
    assert.equal(eleven.rate_per_2000, 0.5);
    assert.equal(eleven.passes_reply_bar, false);
    assert.equal(out.campaigns.find((c) => c.campaign_id === 4085158), undefined, "D54: SG Gabe Calls is a cold call campaign and is ignored");
    assert.deepEqual(out.counts, { campaigns: 2, passing_reply_bar: 1, passing_and_under_1000_untouched: 1, never_top_up: 0, ignored_cold_call: 1 });
    assert.ok(!JSON.stringify(out).includes("@"));
  });

  it("narrows to one client and refuses an unmapped one", async () => {
    const one = await listCampaigns(fakeDb() as never, repo, "bcp");
    if ("error" in one) assert.fail(one.error);
    assert.deepEqual(one.clients, ["bcp"]);
    const none = await listCampaigns(fakeDb() as never, repo, "nobody");
    assert.ok("error" in none && /not in topup.client_map/.test(none.error));
  });
});
