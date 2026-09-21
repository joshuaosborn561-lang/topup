import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { assessClientRunway, shouldProposeHolisticMock } from "../ledger/client_runway.js";
import { watchDecision } from "../watch/decide.js";

/** D38 — client-wide runway and DM pulls, not camp-by-camp SEG fills. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D38 — client-wide runway, not one-camp SEG fills", () => {
  it("CANON and the ledger name D38; the watch start is client rem/capacity", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const watch = await readFile(new URL("src/watch/decide.ts", root), "utf8");
    const tick = await readFile(new URL("src/watch/index.ts", root), "utf8");
    assert.match(canon, /Canon as of \*\*D38\*\*/);
    assert.match(canon, /client-wide/);
    assert.match(canon, /unique inboxes/);
    assert.match(canon, /MESSAGE_PER_DAY/);
    assert.match(canon, /SalesGlider is excluded/);
    assert.match(ledger, /## D38 — Client-wide runway and DM pulls/);
    assert.match(watch, /client-wide/);
    assert.match(tick, /assessClientRunway/);
    assert.match(tick, /recipeCampaignIds: ids/);
  });

  it("one empty SEG camp is not go while sibling ACTIVE rem remains — Ask Josh", () => {
    const client = assessClientRunway({
      clientTag: "parlay",
      campaigns: [
        { status: "ACTIVE", untouched: 0 },
        { status: "ACTIVE", untouched: 5000 },
      ],
    });
    const d = watchDecision({
      client,
      recipeCampaignIds: [1, 2],
      needy: [
        {
          health: {
            smartlead_campaign_id: 1,
            name: "SEG",
            status: "ACTIVE",
            leads_total: 0,
            untouched: 0,
            sends_window: 10,
            last_send_at: null,
            interested_window: 0,
            bounces_window: 0,
            synced_at: null,
            sending: true,
            runway_days: 0,
            flags: ["empty"],
          },
          working: { working: true, reason: "ok", deadVariants: [], liveVariants: [] },
        },
      ],
      openRun: false,
      lastStatus: null,
    });
    assert.equal(d.kind, "skip", "D38: do not auto-open a one-camp SEG refill while the client still has rem. Ask Josh.");
  });

  it("SalesGlider is excluded from under-2 auto mocks; paid spend is still Josh", async () => {
    assert.equal(shouldProposeHolisticMock("salesglider", 1), false);
    assert.equal(shouldProposeHolisticMock("parlay", 1), true);
    const rails = await readFile(new URL("src/spend/rails.ts", root), "utf8");
    assert.match(rails, /gate/, "D38: paid spend still goes through SpendRails.gate. Ask Josh.");
  });

  it("TODO until Josh names unique inboxes × MESSAGE_PER_DAY — days stay null at watch time", async () => {
    const tick = await readFile(new URL("src/watch/index.ts", root), "utf8");
    assert.match(tick, /uniqueInboxes: null/);
    assert.match(tick, /messagePerDay: null/);
    const r = assessClientRunway({
      clientTag: "parlay",
      campaigns: [{ status: "ACTIVE", untouched: 100 }],
      uniqueInboxes: null,
      messagePerDay: null,
    });
    assert.equal(r.email_days, null, "D38: do not invent inbox count or MESSAGE_PER_DAY. Ask Josh where those live.");
  });
});
