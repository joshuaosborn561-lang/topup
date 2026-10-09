import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessCampaign, BOUNCE_LINE, DEFAULT_FLOOR_DAYS, type CampaignSnapshot, WINDOW_DAYS } from "./health.js";

/** D18 / D19 — the service is the memory: state is composable, the digest speaks only on change, nothing renders a row. */

function snap(over: Partial<CampaignSnapshot> = {}): CampaignSnapshot {
  return {
    smartlead_campaign_id: 1001,
    name: "Peterson Roofing Owners",
    status: "ACTIVE",
    leads_total: 4000,
    untouched: 3900,
    sends_window: 0,
    sends_last_14d: 0,
    last_send_at: null,
    interested_window: 0,
    bounces_window: 0,
    synced_at: "2026-09-11T00:00:00Z",
    ...over,
  };
}

describe("campaign health", () => {
  it("a live campaign with thousands of leads and no sends for a week is silent", () => {
    const h = assessCampaign(snap());
    assert.deepEqual(h.flags, ["silent"]);
    assert.equal(h.sending, false);
    assert.equal(h.runway_days, null);
  });

  it("runway under the floor is low; over it is fine", () => {
    const perDay = 100;
    const low = assessCampaign(snap({ untouched: perDay * (DEFAULT_FLOOR_DAYS - 1), sends_window: perDay * WINDOW_DAYS, last_send_at: "2026-09-10T12:00:00Z" }));
    assert.deepEqual(low.flags, ["low"]);
    assert.equal(low.runway_days, DEFAULT_FLOOR_DAYS - 1);
    const fine = assessCampaign(snap({ untouched: perDay * 30, sends_window: perDay * WINDOW_DAYS, last_send_at: "2026-09-10T12:00:00Z" }));
    assert.deepEqual(fine.flags, []);
  });

  it("the recipe floor wins over the default", () => {
    const h = assessCampaign(snap({ untouched: 100 * 10, sends_window: 100 * WINDOW_DAYS }), 14);
    assert.deepEqual(h.flags, ["low"]);
  });

  it("active with nothing left is empty; paused with nothing left is not flagged", () => {
    assert.deepEqual(assessCampaign(snap({ untouched: 0, sends_window: 50 })).flags, ["empty"]);
    assert.deepEqual(assessCampaign(snap({ status: "PAUSED", untouched: 0 })).flags, []);
  });

  it("bounces over the line flag even on a paused campaign", () => {
    const h = assessCampaign(snap({ status: "PAUSED", sends_window: 1000, bounces_window: Math.ceil(1000 * BOUNCE_LINE) + 1 }));
    assert.deepEqual(h.flags, ["bouncing"]);
  });
});
