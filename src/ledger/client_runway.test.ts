import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_FLOOR_DAYS,
  CLIENT_MOCK_DAYS,
  LI_SENDS_PER_DAY,
  assessClientRunway,
  clientRunwayLine,
  emailDaysLeft,
  linkedinDaysLeft,
  shouldProposeHolisticMock,
} from "./client_runway.js";

/** D38 — client-wide rem / capacity, not one-camp SEG fills. */

function camps(...untouched: number[]): Array<{ status: string; untouched: number }> {
  return untouched.map((n) => ({ status: "ACTIVE", untouched: n }));
}

describe("D38 client runway math", () => {
  it("email days are rem ÷ (unique inboxes × MESSAGE_PER_DAY)", () => {
    assert.equal(emailDaysLeft(800, 20, 20), 2);
    assert.equal(emailDaysLeft(0, 20, 20), 0);
    assert.equal(emailDaysLeft(100, 0, 20), null);
    assert.equal(emailDaysLeft(100, 10, 0), null);
  });

  it("LI days are rem ÷ 40", () => {
    assert.equal(LI_SENDS_PER_DAY, 40);
    assert.equal(linkedinDaysLeft(80), 2);
    assert.equal(linkedinDaysLeft(0), 0);
  });

  it("under-2 holistic mock is off for SalesGlider and when days are unknown", () => {
    assert.equal(shouldProposeHolisticMock("parlay", 1.9), true);
    assert.equal(shouldProposeHolisticMock("parlay", CLIENT_MOCK_DAYS), false);
    assert.equal(shouldProposeHolisticMock("salesglider", 0.5), false);
    assert.equal(shouldProposeHolisticMock("parlay", null), false);
  });

  it("a thin SEG camp is not under-floor while siblings hold rem and days are unknown", () => {
    const r = assessClientRunway({
      clientTag: "parlay",
      campaigns: [...camps(0, 4000), { status: "PAUSED", untouched: 0 }],
    });
    assert.equal(r.email_rem, 4000);
    assert.equal(r.email_days, null);
    assert.equal(r.sibling_rem, true);
    assert.equal(r.under_floor, false);
    assert.equal(r.propose_holistic_mock, false);
    assert.match(r.days_note ?? "", /Ask Josh/);
  });

  it("client rem exhausted (all ACTIVE empty) is under-floor even without inbox capacity", () => {
    const r = assessClientRunway({ clientTag: "parlay", campaigns: camps(0, 0) });
    assert.equal(r.email_rem, 0);
    assert.equal(r.sibling_rem, false);
    assert.equal(r.under_floor, true);
  });

  it("known capacity under the 7-day floor is needy; over it is not", () => {
    const low = assessClientRunway({
      clientTag: "parlay",
      campaigns: camps(200, 200),
      uniqueInboxes: 20,
      messagePerDay: 10,
      floorDays: CLIENT_FLOOR_DAYS,
    });
    assert.equal(low.email_days, 2);
    assert.equal(low.email_capacity_per_day, 200);
    assert.equal(low.under_floor, true);
    assert.equal(low.propose_holistic_mock, true);

    const healthy = assessClientRunway({
      clientTag: "parlay",
      campaigns: camps(0, 3000),
      uniqueInboxes: 20,
      messagePerDay: 10,
    });
    assert.equal(healthy.email_days, 15);
    assert.equal(healthy.under_floor, false);
    assert.equal(healthy.sibling_rem, true);
  });

  it("SalesGlider under 2 days is under-floor but does not auto-mock", () => {
    const r = assessClientRunway({
      clientTag: "salesglider",
      campaigns: camps(100),
      uniqueInboxes: 20,
      messagePerDay: 10,
    });
    assert.equal(r.email_days, 0.5);
    assert.equal(r.under_floor, true);
    assert.equal(r.propose_holistic_mock, false);
  });

  it("the board line is counts and days, never a row", () => {
    const line = clientRunwayLine(
      assessClientRunway({
        clientTag: "parlay",
        campaigns: camps(400),
        uniqueInboxes: 20,
        messagePerDay: 10,
      }),
    );
    assert.match(line, /rem 400/);
    assert.match(line, /2d email/);
    assert.match(line, /under floor/);
    assert.doesNotMatch(line, /@/);
  });
});
