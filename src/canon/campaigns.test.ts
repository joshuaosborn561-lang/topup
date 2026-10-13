import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listCampaigns, rollupLanes, type CampaignLine } from "./campaigns.js";

/** D52 / D105 — campaigns: the numbers Grok picks on, rolled up by lane. STOPPED is out of the runway. Ask Josh. */

function fakeDb(opts: { extra?: Array<{ id: number; status: string; untouched: string; name?: string }> } = {}) {
  return {
    query: async (text: string, params?: unknown[]) => {
      if (text.includes("from topup.client_map")) return { rows: [{ client_tag: "bcp", smartlead_client_id: "542838" }, { client_tag: "salesglider", smartlead_client_id: "345263" }] };
      if (text.includes("from public.campaigns") && text.includes("where smartlead_client_id = $1")) {
        if (params?.[0] === 542838) {
          const extra = (opts.extra ?? []).map((e) => ({ id: String(e.id) }));
          return { rows: [{ id: "10" }, { id: "11" }, ...extra] };
        }
        return { rows: [{ id: "4085158" }] };
      }
      if (text.includes("coalesce(l.leads_total,0)")) {
        const ids = params?.[0] as number[];
        return {
          rows: ids.map((id) => {
            const extra = (opts.extra ?? []).find((e) => e.id === id);
            return {
              smartlead_campaign_id: String(id),
              name: extra?.name ?? (id === 4085158 ? "SG Gabe Calls" : `c${id}`),
              status: extra?.status ?? "ACTIVE",
              synced_at: null,
              leads_total: "500",
              untouched: extra?.untouched ?? (id === 10 ? "20" : "900"),
              sends_window: "70",
              sends_last_14d: "140",
              last_send_at: null,
              interested_window: "1",
              bounces_window: "0",
            };
          }),
        };
      }
      if (text.includes("count(*) filter (where s.sent)")) {
        return { rows: [{ id: "10", sends: "4000", positives: "2" }, { id: "11", sends: "4000", positives: "1" }, { id: "12", sends: "2000", positives: "2" }, { id: "13", sends: "2000", positives: "2" }, { id: "4085158", sends: "100", positives: "5" }] };
      }
      return { rows: [] };
    },
  };
}
const repo = {
  campaignRegistry: async () => [
    { campaign_id: "10", client_tag: "bcp", lane: "it_dm", status: "ACTIVE" },
    { campaign_id: "12", client_tag: "bcp", lane: "it_dm", status: "PAUSED" },
    { campaign_id: "13", client_tag: "bcp", lane: "it_dm", status: "STOPPED" },
  ],
};

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
    assert.equal(ten.lane, "it_dm");
    assert.equal(ten.untouched, 20);
    assert.equal(ten.refillable, true);
    const eleven = out.campaigns.find((c) => c.campaign_id === 11)!;
    assert.equal(eleven.rate_per_2000, 0.5);
    assert.equal(eleven.passes_reply_bar, false);
    assert.equal(out.campaigns.find((c) => c.campaign_id === 4085158), undefined, "D54: SG Gabe Calls is a cold call campaign and is ignored");
    assert.deepEqual(out.counts, { campaigns: 2, passing_reply_bar: 1, passing_and_under_1000_untouched: 1, never_top_up: 0, ignored_cold_call: 1, lanes: 1 });
    assert.equal(out.lanes.length, 1);
    assert.equal(out.lanes[0]!.lane, "it_dm");
    assert.deepEqual(out.lanes[0]!.campaign_ids, [10]);
    assert.equal(ten.lane_untouched, 20);
    assert.ok(!JSON.stringify(out).includes("@"));
  });

  it("rolls a lane's runway up across refillable campaigns and leaves STOPPED out of the sum (D105)", async () => {
    const out = await listCampaigns(
      fakeDb({ extra: [{ id: 12, status: "PAUSED", untouched: "300" }, { id: 13, status: "STOPPED", untouched: "8000" }] }) as never,
      repo,
      "bcp",
      { include_inactive: true },
    );
    if ("error" in out) assert.fail(out.error);
    const lane = out.lanes.find((l) => l.lane === "it_dm");
    assert.ok(lane);
    assert.deepEqual(lane!.campaign_ids, [10, 12], "PAUSED stays; STOPPED is out");
    assert.equal(lane!.stopped_excluded, 1);
    assert.equal(lane!.untouched, 20 + 300, "STOPPED 8000 is not in the lane runway");
    const stopped = out.campaigns.find((c) => c.campaign_id === 13);
    assert.equal(stopped?.refillable, false);
    assert.equal(stopped?.lane_untouched, 320, "the STOPPED row still shows the lane total beside it");
    const paused = out.campaigns.find((c) => c.campaign_id === 12);
    assert.equal(paused?.refillable, true);
    assert.equal(paused?.lane_untouched, 320);
  });

  it("rollupLanes is the sum of refillable untouched, never STOPPED", () => {
    const rows: CampaignLine[] = [
      { client_tag: "aa", smartlead_client_id: 1, campaign_id: 1, name: "a", status: "ACTIVE", lane: "pe", sends: 100, positives: 1, rate_per_2000: 20, passes_reply_bar: true, leads_total: 10, untouched: 100, sends_last_14d: 14, sends_window: 7, runway_days: 100, last_send_at: null, never_top_up: false, refillable: true, lane_untouched: null },
      { client_tag: "aa", smartlead_client_id: 1, campaign_id: 2, name: "b", status: "PAUSED", lane: "pe", sends: 100, positives: 1, rate_per_2000: 20, passes_reply_bar: true, leads_total: 10, untouched: 50, sends_last_14d: 0, sends_window: 0, runway_days: null, last_send_at: null, never_top_up: false, refillable: true, lane_untouched: null },
      { client_tag: "aa", smartlead_client_id: 1, campaign_id: 3, name: "c", status: "STOPPED", lane: "pe", sends: 100, positives: 1, rate_per_2000: 20, passes_reply_bar: true, leads_total: 10, untouched: 9999, sends_last_14d: 14, sends_window: 7, runway_days: 9999, last_send_at: null, never_top_up: false, refillable: false, lane_untouched: null },
    ];
    const lanes = rollupLanes(rows);
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0]!.untouched, 150);
    assert.deepEqual(lanes[0]!.campaign_ids, [1, 2]);
    assert.equal(lanes[0]!.stopped_excluded, 1);
    assert.equal(lanes[0]!.runway_days, 150);
  });

  it("narrows to one client and refuses an unmapped one", async () => {
    const one = await listCampaigns(fakeDb() as never, repo, "bcp");
    if ("error" in one) assert.fail(one.error);
    assert.deepEqual(one.clients, ["bcp"]);
    const none = await listCampaigns(fakeDb() as never, repo, "nobody");
    assert.ok("error" in none && /not in topup.client_map/.test(none.error));
  });
});
