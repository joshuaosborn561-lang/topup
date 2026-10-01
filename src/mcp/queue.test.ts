import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankQueueItems, type UnrankedQueueItem } from "./queue.js";
import { flaggedCampaigns } from "../watch/assess.js";
import type { WatchLaneSnapshot } from "../watch/assess.js";
import type { NeedyCampaign } from "../watch/decide.js";
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

describe("D43 — topup_queue ranking and flags", () => {
  it("ranks empty first, then shortest runway", () => {
    const items: UnrankedQueueItem[] = [
      {
        client_tag: "parlay",
        lane: "it_dm",
        campaign_id: 2,
        campaign_name: "low",
        flags: ["low"],
        runway_days: 3,
        decision: "go",
        why: "under floor",
        working: true,
        recipe_summary: { campaign_id: 2, builds: [], any_reconstructed: false, leads_without_method: 0, campaign_not_found: false },
      },
      {
        client_tag: "bcp",
        lane: "it_dm",
        campaign_id: 1,
        campaign_name: "empty",
        flags: ["empty"],
        runway_days: 0,
        decision: "go",
        why: "under floor",
        working: true,
        recipe_summary: { campaign_id: 1, builds: [{ build_label: "b", interested: 2 }], any_reconstructed: false, leads_without_method: 0, campaign_not_found: false },
      },
      {
        client_tag: "goliath",
        lane: "it_dm",
        campaign_id: 3,
        campaign_name: "less low",
        flags: ["low"],
        runway_days: 6,
        decision: "ask",
        why: "not working",
        working: false,
        recipe_summary: { campaign_id: 3, builds: [], any_reconstructed: null, leads_without_method: null, campaign_not_found: true },
      },
    ];
    const ranked = rankQueueItems(items);
    assert.deepEqual(ranked.map((r) => r.campaign_id), [1, 2, 3]);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
    assert.equal(ranked[0]!.recipe_summary.builds[0]?.interested, 2);
    assert.ok(!JSON.stringify(ranked).includes("@"), "D43: queue is counts, never an email. Ask Josh.");
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
    assert.ok(!JSON.stringify(s).includes("secret method"), "D43: queue starts from counts, not the method. Ask Josh.");
  });
});
