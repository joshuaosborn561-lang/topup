import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CampaignHealth } from "../ledger/health.js";
import { assessClientRunway } from "../ledger/client_runway.js";
import type { WorkingVerdict } from "../domain/working.js";
import { isNeedy, pickAsk, recipeCampaignIds, watchDecision } from "./decide.js";

/** D27 / D38 — the watch goes on its own when the *client* is low and still working. */

function health(partial: Partial<CampaignHealth> & { smartlead_campaign_id: number }): CampaignHealth {
  return {
    name: `c${partial.smartlead_campaign_id}`,
    status: "ACTIVE",
    leads_total: 100,
    untouched: 10,
    sends_window: 70,
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

const live: WorkingVerdict = { working: true, reason: "2 interested in 4000 sends (1.00 per 2,000)", deadVariants: [], liveVariants: [] };
const dead: WorkingVerdict = { working: false, reason: "0 interested in 4000 sends (0.00 per 2,000)", deadVariants: ["A"], liveVariants: [] };

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

  it("skips when nothing is low or a run is already open", () => {
    assert.equal(watchDecision({ needy: [], openRun: false, lastStatus: null }).kind, "skip");
    assert.equal(
      watchDecision({ needy: [{ health: health({ smartlead_campaign_id: 1 }), working: live }], openRun: true, lastStatus: null }).kind,
      "skip",
    );
  });

  it("goes when any needy campaign is still working — no card, no Josh (legacy path, no client rollup)", () => {
    const d = watchDecision({
      needy: [
        { health: health({ smartlead_campaign_id: 1 }), working: live },
        { health: health({ smartlead_campaign_id: 2 }), working: dead },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "go");
    if (d.kind === "go") assert.deepEqual(d.campaigns, [1]);
  });

  it("asks Josh when every needy campaign is not working", () => {
    const d = watchDecision({
      needy: [
        { health: health({ smartlead_campaign_id: 9, runway_days: 2 }), working: dead },
        { health: health({ smartlead_campaign_id: 8, flags: ["empty"], runway_days: 0, untouched: 0 }), working: dead },
      ],
      openRun: false,
      lastStatus: "done",
    });
    assert.equal(d.kind, "ask");
    if (d.kind === "ask") assert.equal(d.campaignId, 8, "empty is asked first");
  });

  it("after Leave it, does not nag again until something is working", () => {
    const stillDead = watchDecision({
      needy: [{ health: health({ smartlead_campaign_id: 1 }), working: dead }],
      openRun: false,
      lastStatus: "not_working",
    });
    assert.equal(stillDead.kind, "skip");
    const recovered = watchDecision({
      needy: [{ health: health({ smartlead_campaign_id: 1 }), working: live }],
      openRun: false,
      lastStatus: "not_working",
    });
    assert.equal(recovered.kind, "go");
  });

  it("pickAsk prefers empty over a short runway", () => {
    const a = { health: health({ smartlead_campaign_id: 1, runway_days: 1 }), working: dead };
    const b = { health: health({ smartlead_campaign_id: 2, flags: ["empty"], runway_days: 0, untouched: 0 }), working: dead };
    assert.equal(pickAsk([a, b]).health.smartlead_campaign_id, 2);
  });
});

describe("D38 client-wide watch start", () => {
  it("does not auto-start a one-camp SEG empty while sibling ACTIVE rem remains", () => {
    const client = assessClientRunway({
      clientTag: "parlay",
      campaigns: [
        { status: "ACTIVE", untouched: 0 },
        { status: "ACTIVE", untouched: 8000 },
      ],
    });
    const d = watchDecision({
      client,
      recipeCampaignIds: [3847846, 3847839],
      needy: [{ health: health({ smartlead_campaign_id: 3847846, flags: ["empty"], untouched: 0, runway_days: 0 }), working: live }],
      camps: [{ health: health({ smartlead_campaign_id: 3847846, flags: ["empty"], untouched: 0 }), working: live }],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.match(d.why, /D38/);
  });

  it("goes when client rem is exhausted, and targets every recipe campaign so the pull can title-segment", () => {
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
      needy: [{ health: health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0 }), working: live }],
      camps: [
        { health: health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0 }), working: live },
        { health: health({ smartlead_campaign_id: 2, flags: ["empty"], untouched: 0 }), working: dead },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "go");
    if (d.kind === "go") {
      assert.deepEqual(d.campaigns, [1, 2, 3]);
      assert.match(d.why, /title-segment/);
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
      needy: [{ health: health({ smartlead_campaign_id: 9 }), working: live }],
      camps: [{ health: health({ smartlead_campaign_id: 9 }), working: live }],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(go.kind, "go");
    if (go.kind === "go") assert.equal(go.proposeMock, true);

    const sgGo = watchDecision({
      client: sg,
      recipeCampaignIds: [9],
      needy: [{ health: health({ smartlead_campaign_id: 9 }), working: live }],
      camps: [{ health: health({ smartlead_campaign_id: 9 }), working: live }],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(sgGo.kind, "go");
    if (sgGo.kind === "go") assert.equal(sgGo.proposeMock, false);
  });

  it("healthy client-wide days skip even when one camp is flagged empty", () => {
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
      needy: [{ health: health({ smartlead_campaign_id: 1, flags: ["empty"], untouched: 0 }), working: live }],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "skip");
  });
});
