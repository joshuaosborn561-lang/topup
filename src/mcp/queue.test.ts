import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankQueueItems, queueRankKey, type UnrankedQueueItem } from "./queue.js";
import { flaggedCampaigns } from "../watch/assess.js";
import type { WatchLaneSnapshot } from "../watch/assess.js";
import { isWatchdogLeadNeed, watchdogLeadFlag, type NeedyCampaign } from "../watch/decide.js";
import { recipeSummaryCounts } from "./recipe.js";

function camp(id: number, flags: string[], runway: number | null, working = true): NeedyCampaign {
  return {
    health: {
      smartlead_campaign_id: id,
      name: `c${id}`,
      status: "ACTIVE",
      leads_total: 10,
      untouched: flags.includes("empty") ? 0 : 5,
      sends_window: 7,
      sends_last_14d: 14,
      last_send_at: null,
      interested_window: 1,
      bounces_window: 0,
      synced_at: null,
      sending: true,
      runway_days: runway,
      flags: flags as never,
    },
    working: { working, reason: working ? "ok" : "dead", deadVariants: [], liveVariants: [] },
  };
}

function item(partial: Partial<UnrankedQueueItem> & Pick<UnrankedQueueItem, "campaign_id" | "watchdog">): UnrankedQueueItem {
  return {
    client_tag: "parlay",
    lane: "it_dm",
    campaign_name: `c${partial.campaign_id}`,
    flags: partial.watchdog === "empty" ? ["empty"] : partial.watchdog === "low" ? ["low"] : [],
    remaining_new: partial.watchdog === "empty" ? 0 : 5,
    runway_days: 3,
    sends_last_14d: 14,
    client_email_days: 2.4,
    decision: "skip",
    why: "client-wide runway is healthy",
    working: true,
    working_reason: "1 interested in 1500 sends (under 2,000; acceptable)",
    client_under_floor: false,
    sibling_rem: true,
    recipe_summary: { campaign_id: partial.campaign_id, builds: [], any_reconstructed: false, leads_without_method: 0, campaign_not_found: false },
    ...partial,
  };
}

describe("D43 / D44 — topup_queue ranking and watchdog flags", () => {
  it("ranks empty first, then nearly-done, then shortest low runway", () => {
    const items: UnrankedQueueItem[] = [
      item({ campaign_id: 2, watchdog: "low", flags: ["low"], remaining_new: 40, runway_days: 3 }),
      item({ campaign_id: 1, watchdog: "empty", flags: ["empty"], remaining_new: 0, runway_days: 0 }),
      item({ campaign_id: 4, watchdog: "nearly_done", flags: [], remaining_new: 12, runway_days: 20 }),
      item({ campaign_id: 3, watchdog: "low", flags: ["low"], remaining_new: 80, runway_days: 6, decision: "ask", working: false }),
    ];
    const ranked = rankQueueItems(items);
    assert.deepEqual(ranked.map((r) => r.campaign_id), [1, 4, 2, 3]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4]);
    assert.equal(ranked[0]!.watchdog, "empty");
    assert.equal(ranked[1]!.watchdog, "nearly_done");
    assert.ok(ranked.every((r) => "recipe_summary" in r && "working_reason" in r));
    assert.ok(!JSON.stringify(ranked).includes("@"), "D44: queue is counts, never an email. Ask Josh.");
  });

  it("queueRankKey keeps empty ahead of a healthy-client skip", () => {
    assert.ok(queueRankKey(item({ campaign_id: 1, watchdog: "empty", remaining_new: 0 })) < queueRankKey(item({ campaign_id: 2, watchdog: "low", runway_days: 1 })));
  });

  it("flaggedCampaigns is empty on skip, the ask camp on ask, needy on go", () => {
    const a = camp(1, ["empty"], 0);
    const b = camp(2, ["low"], 2);
    const skip: WatchLaneSnapshot = {
      ids: [1],
      health: [a.health],
      needy: [a],
      camps: [a],
      client: null,
      decision: { kind: "skip", why: "healthy" },
      openRun: false,
    };
    assert.deepEqual(flaggedCampaigns(skip), []);
    const ask: WatchLaneSnapshot = {
      ...skip,
      needy: [a, b],
      camps: [a, b],
      decision: { kind: "ask", why: "dead", campaignId: 2 },
    };
    assert.deepEqual(flaggedCampaigns(ask).map((c) => c.health.smartlead_campaign_id), [2]);
    const go: WatchLaneSnapshot = {
      ...skip,
      needy: [a, b],
      camps: [a, b],
      decision: { kind: "go", why: "under floor", campaigns: [1, 2], proposeMock: false },
    };
    assert.deepEqual(flaggedCampaigns(go).map((c) => c.health.smartlead_campaign_id), [1, 2]);
  });

  it("watchdog lead flags match the channel: empty, low, nearly-done 90%; not silent", () => {
    assert.equal(watchdogLeadFlag(camp(1, ["empty"], 0).health), "empty");
    assert.equal(watchdogLeadFlag(camp(2, ["low"], 3).health), "low");
    assert.equal(
      watchdogLeadFlag({
        ...camp(3, [], 20).health,
        leads_total: 600,
        untouched: 60,
        flags: [],
      }),
      "nearly_done",
    );
    assert.equal(isWatchdogLeadNeed(camp(4, ["silent"], null).health), false);
    assert.equal(
      watchdogLeadFlag({
        ...camp(5, [], 20).health,
        status: "STOPPED",
        untouched: 0,
        flags: [],
      }),
      null,
    );
  });

  it("recipe summary is counts, never the method paragraph", () => {
    const s = recipeSummaryCounts(
      {
        campaign: { smartlead_campaign_id: 3847838 },
        builds: [{ build_label: "parlay_adjacent_dms_20260825", interested: 1, method: "secret method" }],
        any_reconstructed: false,
        leads_without_method: 0,
      },
      3847838,
    );
    assert.equal(s.campaign_not_found, false);
    assert.equal(s.builds[0]?.build_label, "parlay_adjacent_dms_20260825");
    assert.equal(s.builds[0]?.interested, 1);
    assert.ok(!JSON.stringify(s).includes("secret method"), "D44: queue starts from counts, not the method. Ask Josh.");
  });
});
