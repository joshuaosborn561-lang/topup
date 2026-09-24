import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Db } from "../db/pool.js";
import { assessCampaign, BOUNCE_LINE, DEFAULT_FLOOR_DAYS, type CampaignSnapshot, WINDOW_DAYS } from "./health.js";
import { LaneLedger, type LaneState } from "./lane.js";
import { buildDigest, fingerprint, renderWhere } from "./render.js";

/** D18 / D19 — the service is the memory: state is composable, the digest speaks only on change, nothing renders a row. */

function snap(over: Partial<CampaignSnapshot> = {}): CampaignSnapshot {
  return {
    smartlead_campaign_id: 1001,
    name: "Peterson Roofing Owners",
    status: "ACTIVE",
    leads_total: 4000,
    untouched: 3900,
    sends_window: 0,
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

function state(over: Partial<LaneState> = {}): LaneState {
  return {
    client_tag: "peterson",
    lane: "roof_owners",
    step: null,
    step_label: "no step (idle)",
    step_since: "2026-09-10T00:00:00Z",
    step_owner: null,
    gate_unmet: null,
    run: null,
    next_intent: "Nothing queued.",
    blocked: [],
    queues: { ingested_by_status: { needs_verify: 4000 }, registry: [{ queue_name: "have_domain_no_person", source_table: "public.peterson_roof_people_queue", missing: "person", next_method: "people_waterfall", last_count: 200, last_counted_at: "2026-09-11T01:00:00Z", note: null }] },
    spend: { this_run_cents_by_vendor: {}, this_month_cents_by_vendor: { millionverifier: 1234 } },
    campaigns: [assessCampaign(snap())],
    client_runway: null,
    campaigns_error: null,
    events: [{ at: "2026-09-10T00:00:00Z", event: "note", line: "Queue registered from Claude.", next_intent: null, actor: "mcp:owner" }],
    registered: true,
    ...over,
  };
}

describe("/where rendering", () => {
  it("says the step, since when, the unmet gate, who it waits on, queues, spend, campaigns and recent events", () => {
    const text = renderWhere(state({ blocked: [{ on: "owner", what: "approve or decline $12.00 worst case (millionverifier, 4000 rows)", since: "2026-09-11T00:00:00Z", card_id: "abcdef12-0000" }] }), Date.parse("2026-09-11T02:00:00Z"));
    assert.match(text, /\*peterson \/ roof_owners\* — idle for 26h/);
    const running = renderWhere(state({ step: 6, step_label: "Step 6", step_owner: "code", gate_unmet: "sendable rule and stall runbook: 0 sendable of 400 verified", run: { run_id: "12345678-abcd", status: "awaiting_josh", current_step: "verify", opened_at: "2026-09-11T00:00:00Z" } }), Date.parse("2026-09-11T02:00:00Z"));
    assert.match(running, /— Step 6 · owner code \(run `12345678` awaiting_josh\)/);
    assert.match(running, /Gate unmet: sendable rule and stall runbook: 0 sendable of 400 verified/);
    assert.match(text, /Josh — approve or decline \$12\.00/);
    assert.match(text, /needs_verify 4000/);
    assert.match(text, /have_domain_no_person · public\.peterson_roof_people_queue · missing person → people_waterfall · 200 rows/);
    assert.match(text, /this month millionverifier \$12\.34/);
    assert.match(text, /3900 untouched of 4000 · 0 sends\/7d · never sent .* \*silent\*/);
    assert.match(text, /Queue registered from Claude\./);
  });

  it("never renders anything that looks like an email or a person (D2)", () => {
    const text = renderWhere(state());
    assert.doesNotMatch(text, /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("names client-wide rem on /where when the rollup is present (D38)", () => {
    const text = renderWhere(
      state({
        client_runway: {
          client_tag: "peterson",
          email_rem: 1200,
          li_rem: 0,
          active_campaigns: 3,
          unique_inboxes: null,
          message_per_day: null,
          email_capacity_per_day: null,
          email_days: null,
          li_days: null,
          floor_days: 7,
          under_floor: false,
          sibling_rem: true,
          propose_holistic_mock: false,
          days_note: null,
        },
      }),
    );
    assert.match(text, /Client runway: rem 1200 across 3 ACTIVE/);
  });
});

describe("daily digest", () => {
  it("is silent when no lane changed", () => {
    const s = state();
    const d = buildDigest([s], { "peterson/roof_owners": fingerprint(s) });
    assert.equal(d.text, null);
    assert.equal(Object.keys(d.fingerprints).length, 1);
  });

  it("names client under-7 on the daily board when the rollup is under the floor (D38)", () => {
    const quiet = state();
    const loud = state({
      client_runway: {
        client_tag: "peterson",
        email_rem: 0,
        li_rem: 0,
        active_campaigns: 2,
        unique_inboxes: null,
        message_per_day: null,
        email_capacity_per_day: null,
        email_days: 0,
        li_days: null,
        floor_days: 7,
        under_floor: true,
        sibling_rem: false,
        propose_holistic_mock: false,
        days_note: null,
      },
    });
    const d = buildDigest([loud], { "peterson/roof_owners": fingerprint(quiet) });
    assert.ok(d.text);
    assert.match(d.text!, /client under-7/);
    assert.match(d.text!, /Client runway: rem 0/);
  });

  it("names a lane whose health crossed a line, and only that lane", () => {
    const quiet = state({ client_tag: "parlay", lane: "it_dm", campaigns: [assessCampaign(snap({ smartlead_campaign_id: 7, untouched: 5000, sends_window: 700, last_send_at: "2026-09-10T00:00:00Z" }))] });
    const loud = state();
    const d = buildDigest([quiet, loud], { "parlay/it_dm": fingerprint(quiet), "peterson/roof_owners": fingerprint(state({ campaigns: [] })) });
    assert.ok(d.text);
    assert.match(d.text!, /1 lane changed/);
    assert.match(d.text!, /peterson\/roof_owners/);
    assert.doesNotMatch(d.text!, /parlay\/it_dm/);
    assert.match(d.text!, /\*silent\*/);
  });

  it("timestamps and spend do not move the fingerprint; step, gate and blockers do", () => {
    const a = state();
    const b = state({ step_since: "2026-09-11T00:00:00Z", spend: { this_run_cents_by_vendor: { no2bounce: 500 }, this_month_cents_by_vendor: {} } });
    assert.equal(fingerprint(a), fingerprint(b));
    const c = state({ step: 6, step_label: "Step 6" });
    assert.notEqual(fingerprint(a), fingerprint(c));
    const g = state({ gate_unmet: "every merge field populated: 3 of 400 normalized rows have an empty merge field" });
    assert.notEqual(fingerprint(a), fingerprint(g));
    const blocked = state({ blocked: [{ on: "vendor", what: "MillionVerifier balance is zero", since: "2026-09-11T00:00:00Z" }] });
    assert.notEqual(fingerprint(a), fingerprint(blocked));
  });
});

describe("queue registry guards", () => {
  const calls: string[] = [];
  const fakeDb = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
    readOnly: async () => 0,
  } as unknown as Db;
  const ledger = new LaneLedger(fakeDb);

  it("refuses a source_table that is not schema.table", async () => {
    await assert.rejects(
      ledger.registerQueue({ client_tag: "peterson", lane: "roof", queue_name: "q", source_table: "peterson_roof_people_queue", missing: "person", registered_by: "test" }),
      /schema\.table/,
    );
    await assert.rejects(
      ledger.registerQueue({ client_tag: "peterson", lane: "roof", queue_name: "q", source_table: "public.x; drop table y", missing: "person", registered_by: "test" }),
      /schema\.table/,
    );
  });

  it("refuses a where predicate with a statement separator or comment", async () => {
    await assert.rejects(
      ledger.registerQueue({ client_tag: "peterson", lane: "roof", queue_name: "q", source_table: "public.q", where_sql: "1=1; delete from public.q", missing: "person", registered_by: "test" }),
      /single predicate/,
    );
    assert.equal(calls.length, 0, "nothing reached the database");
  });

  it("counts are read-only and a bad table never throws out of countQueue", async () => {
    const r = await ledger.countQueue({ client_tag: "a", lane: "b", queue_name: "c", source_table: "not-a-table", where_sql: null });
    assert.equal(r.count, null);
    assert.match(r.count_error!, /schema\.table/);
  });
});
