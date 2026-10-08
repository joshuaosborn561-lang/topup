import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CampaignHealth } from "../ledger/health.js";
import { assessClientRunway } from "../ledger/client_runway.js";
import type { CampaignVerdict } from "../policy/index.js";
import { isNeedy, isWatchdogLeadNeed, recipeCampaignIds, watchdogLeadFlag, watchDecision } from "./decide.js";

/** D27 / D38 / D46 — the watch goes on its own when a dry campaign passes the policy; a refused one gets no card. */

function health(partial: Partial<CampaignHealth> & { smartlead_campaign_id: number }): CampaignHealth {
  return {
    name: `c${partial.smartlead_campaign_id}`,
    status: "ACTIVE",
    leads_total: 100,
    untouched: 10,
    sends_window: 70,
    sends_last_14d: 140,
    last_send_at: null,
    interested_window: 1,
    bounces_window: 0,
    synced_at: null,
    sending: true,
    runway_days: 5,
    flags: ["low"],
    ...partial,
  };
}

const live: CampaignVerdict = { campaign_id: 0, gate: "ok", reason: "2 interested in 4000 sends (1.00 per 2,000); sizing pending", qualifies: true, reply_rate_per_2000: 1, sizing_pending: true };
const dead: CampaignVerdict = { campaign_id: 0, gate: "under_reply_bar", reason: "0 interested in 4000 sends; a campaign with no positive reply does not qualify", qualifies: false, reply_rate_per_2000: 0, sizing_pending: false };

describe("D27 watch decision", () => {
  it("recipe campaign ids are the unique routing targets", () => {
    const ids = recipeCampaignIds({
      routing: [
        { when: { band: "11_50" }, campaign_id: 1 },
        { when: { band: "51_200" }, campaign_id: 2 },
        { when: { band: "11_50", gift: "airpods" }, campaign_id: 1 },
      ],
    } as never);
    assert.deepEqual(ids, [1, 2]);
  });

  it("low and empty are needy flags; silent is not — flags are the board, not the start", () => {
    assert.equal(isNeedy(health({ smartlead_campaign_id: 1, flags: ["low"] })), true);
    assert.equal(isNeedy(health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0, runway_days: 0 })), true);
    assert.equal(isNeedy(health({ smartlead_campaign_id: 1, flags: ["silent"], runway_days: null, sending: false })), false);
    assert.equal(isNeedy(health({ smartlead_campaign_id: 1, flags: [], runway_days: 20 })), false);
  });

  it("D44 — watchdog lead flags are empty, low, or 90% consumed; not silent or STOPPED", () => {
    assert.equal(watchdogLeadFlag(health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0 })), "empty");
    assert.equal(watchdogLeadFlag(health({ smartlead_campaign_id: 2, flags: ["low"], runway_days: 2 })), "low");
    assert.equal(
      watchdogLeadFlag(health({ smartlead_campaign_id: 3, flags: [], leads_total: 600, untouched: 60, runway_days: 20 })),
      "nearly_done",
    );
    assert.equal(isWatchdogLeadNeed(health({ smartlead_campaign_id: 4, flags: ["silent"], runway_days: null, sending: false, untouched: 80, leads_total: 100 })), false);
    assert.equal(watchdogLeadFlag(health({ smartlead_campaign_id: 5, status: "STOPPED", flags: [], untouched: 0 })), null);
  });

  it("skips when nothing is low or a run is already open", () => {
    assert.equal(watchDecision({ needy: [], openRun: false, lastStatus: null }).kind, "skip");
    assert.equal(
      watchDecision({ needy: [{ health: health({ smartlead_campaign_id: 1 }), verdict: live }], openRun: true, lastStatus: null }).kind,
      "skip",
    );
  });

  it("goes when any needy campaign is still working — no card, no Josh (legacy path, no client rollup)", () => {
    const d = watchDecision({
      needy: [
        { health: health({ smartlead_campaign_id: 1 }), verdict: live },
        { health: health({ smartlead_campaign_id: 2 }), verdict: dead },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "go");
    if (d.kind === "go") {
      assert.deepEqual(d.campaigns, [1]);
      assert.deepEqual(d.refused.map((r) => r.campaign_id), [2]);
      assert.match(d.why, /Not started: #2 \(under_reply_bar\)/);
    }
  });

  it("D46 — refuses, with each campaign's gate and reason, when every needy campaign fails the policy; no card", () => {
    const d = watchDecision({
      needy: [
        { health: health({ smartlead_campaign_id: 9, runway_days: 2 }), verdict: dead },
        { health: health({ smartlead_campaign_id: 8, flags: ["empty"], runway_days: 0, untouched: 0 }), verdict: { ...dead, gate: "paused", reason: "#8 is paused; it never starts" } },
      ],
      openRun: false,
      lastStatus: "done",
    });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") {
      assert.deepEqual(d.refused?.map((r) => [r.campaign_id, r.gate]), [[9, "under_reply_bar"], [8, "paused"]]);
      assert.match(d.why, /#9 needs leads but under_reply_bar/);
      assert.match(d.why, /\/working on is Josh's override/);
    }
  });

  it("after Leave it, does not nag again until something is working", () => {
    const stillDead = watchDecision({
      needy: [{ health: health({ smartlead_campaign_id: 1 }), verdict: dead }],
      openRun: false,
      lastStatus: "not_working",
    });
    assert.equal(stillDead.kind, "skip");
    const recovered = watchDecision({
      needy: [{ health: health({ smartlead_campaign_id: 1 }), verdict: live }],
      openRun: false,
      lastStatus: "not_working",
    });
    assert.equal(recovered.kind, "go");
  });

  it("does not restart a lane whose last run was aborted", () => {
    const d = watchDecision({
      needy: [{ health: health({ smartlead_campaign_id: 1 }), verdict: live }],
      openRun: false,
      lastStatus: "aborted",
    });
    assert.equal(d.kind, "skip");
  });

});

describe("D38 client-wide watch start", () => {
  it("fills one empty campaign that is still working and does not refill the sibling that has runway", () => {
    const client = assessClientRunway({
      clientTag: "parlay",
      campaigns: [
        { status: "ACTIVE", untouched: 0, sends_window: 0 },
        { status: "ACTIVE", untouched: 8000, sends_window: 700 },
      ],
    });
    const d = watchDecision({
      client,
      recipeCampaignIds: [3847846, 3847839],
      needy: [{ health: health({ smartlead_campaign_id: 3847846, flags: ["empty"], untouched: 0, runway_days: 0 }), verdict: live }],
      camps: [
        { health: health({ smartlead_campaign_id: 3847846, flags: ["empty"], untouched: 0, runway_days: 0 }), verdict: live },
        { health: health({ smartlead_campaign_id: 3847839, flags: [], untouched: 8000, runway_days: 20 }), verdict: live },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "go");
    if (d.kind === "go") {
      assert.deepEqual(d.campaigns, [3847846]);
      assert.match(d.why, /3847846/);
      assert.doesNotMatch(d.why, /Filling these campaigns[\s\S]*3847839/);
    }
  });

  it("goes when client rem is exhausted, and targets only the campaigns that are dry and still working", () => {
    const client = assessClientRunway({
      clientTag: "parlay",
      campaigns: [
        { status: "ACTIVE", untouched: 0 },
        { status: "ACTIVE", untouched: 0 },
      ],
    });
    const d = watchDecision({
      client,
      recipeCampaignIds: [1, 2, 3],
      needy: [{ health: health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0 }), verdict: live }],
      camps: [
        { health: health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0 }), verdict: live },
        { health: health({ smartlead_campaign_id: 2, flags: ["empty"], untouched: 0 }), verdict: dead },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "go");
    if (d.kind === "go") {
      assert.deepEqual(d.campaigns, [1]);
      assert.match(d.why, /sends do not stop/);
    }
  });

  it("known capacity under 2 days on a non-SalesGlider client flags the holistic mock; SalesGlider does not", () => {
    const parlay = assessClientRunway({
      clientTag: "parlay",
      campaigns: [{ status: "ACTIVE", untouched: 100 }],
      uniqueInboxes: 20,
      messagePerDay: 10,
    });
    const sg = assessClientRunway({
      clientTag: "salesglider",
      campaigns: [{ status: "ACTIVE", untouched: 100 }],
      uniqueInboxes: 20,
      messagePerDay: 10,
    });
    const go = watchDecision({
      client: parlay,
      recipeCampaignIds: [9],
      needy: [{ health: health({ smartlead_campaign_id: 9 }), verdict: live }],
      camps: [{ health: health({ smartlead_campaign_id: 9 }), verdict: live }],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(go.kind, "go");
    if (go.kind === "go") assert.equal(go.proposeMock, true);

    const sgGo = watchDecision({
      client: sg,
      recipeCampaignIds: [9],
      needy: [{ health: health({ smartlead_campaign_id: 9 }), verdict: live }],
      camps: [{ health: health({ smartlead_campaign_id: 9 }), verdict: live }],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(sgGo.kind, "go");
    if (sgGo.kind === "go") assert.equal(sgGo.proposeMock, false);
  });

  it("healthy client-wide days still fill the one empty campaign", () => {
    const client = assessClientRunway({
      clientTag: "parlay",
      campaigns: [
        { status: "ACTIVE", untouched: 0 },
        { status: "ACTIVE", untouched: 4000 },
      ],
      uniqueInboxes: 20,
      messagePerDay: 10,
    });
    assert.ok((client.email_days ?? 0) >= 7);
    const d = watchDecision({
      client,
      recipeCampaignIds: [1, 2],
      needy: [{ health: health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0 }), verdict: live }],
      camps: [
        { health: health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0, runway_days: 0 }), verdict: live },
        { health: health({ smartlead_campaign_id: 2, flags: [], untouched: 4000, runway_days: 20 }), verdict: live },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "go");
    if (d.kind === "go") assert.deepEqual(d.campaigns, [1]);
  });

  it("names each campaign and skips when every one still has runway", () => {
    const d = watchDecision({
      needy: [],
      camps: [
        { health: health({ smartlead_campaign_id: 1, flags: [], untouched: 500, runway_days: 12 }), verdict: live },
        { health: health({ smartlead_campaign_id: 2, flags: [], untouched: 800, runway_days: 18 }), verdict: live },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") {
      assert.match(d.why, /#1 covered/);
      assert.match(d.why, /#2 covered/);
    }
  });
});
