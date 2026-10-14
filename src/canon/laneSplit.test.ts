import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRouting, resolveLaneSegmentation, type GrokSplit, type LaneRecord } from "./laneSplit.js";
import type { RegistryCampaign } from "./registry.js";

/** D105, D108 — a lane splits the way Grokbot read it from the chats; nothing stored decides it; STOPPED is never a target. Ask Josh. */

function member(id: number, extra: Partial<RegistryCampaign> = {}): RegistryCampaign {
  return { campaign_id: id, client_tag: "aa", smartlead_client_id: 1, lane: "pe", ...extra };
}

function rec(campaign_ids: number[], extra: Partial<LaneRecord> = {}): LaneRecord {
  return { campaign_ids, lanes: ["pe"], ...extra };
}

const active = (...ids: number[]) => new Map<number, string | null>(ids.map((id) => [id, "ACTIVE"]));

describe("D108 — the lane split comes from Grokbot with the pool", () => {
  it("uses the passed split and drops STOPPED targets; PAUSED may still be refilled (D105)", () => {
    const split: GrokSplit = {
      rule: "SEG to the SEG twin; no-team rows to the third campaign; the rest to the main one.",
      routing: [
        { when: { mail_class: "SEG" }, campaign_id: 10 },
        { when: { mail_class: "OTHER" }, campaign_id: 11 },
        { when: { mail_class: "OTHER", team_source: "none" }, campaign_id: 12 },
      ],
      from: ["build step 388", "build step 361"],
    };
    const out = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10), member(11), member(12), member(13)],
      statuses: new Map([
        [10, "ACTIVE"],
        [11, "PAUSED"],
        [12, "STOPPED"],
        [13, "ACTIVE"],
      ]),
      records: [rec([10, 11, 12, 13])],
      split,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.source, "grok_split");
    assert.deepEqual(out.campaign_ids, [10, 11]);
    assert.deepEqual(out.stopped_ids, [12]);
    assert.ok(!out.routing.some((r) => r.campaign_id === 12), "D105: STOPPED is never in the split");
    assert.equal(out.routing.some((r) => r.campaign_id === 11), true, "D105: PAUSED may still be refilled");
    assert.match(out.split_rule ?? "", /SEG twin/);
    assert.deepEqual(out.split_from, ["build step 388", "build step 361"]);
  });

  it("with no split passed, one named refillable campaign is a catch-all; two or more is a refusal, never a guess", () => {
    const one = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10), member(11)],
      statuses: new Map([
        [10, "ACTIVE"],
        [11, "STOPPED"],
      ]),
      records: [rec([10, 11])],
    });
    assert.equal(one.ok, true);
    if (one.ok) {
      assert.equal(one.source, "single_campaign");
      assert.deepEqual(one.routing, [{ when: {}, campaign_id: 10 }]);
      assert.deepEqual(one.stopped_ids, [11]);
    }
    const two = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10, { band: "11_50" }), member(11, { band: "51_200" })],
      statuses: active(10, 11),
      records: [rec([10, 11])],
    });
    assert.equal(two.ok, false, "D108: registry cells and records never decide a split");
    if (!two.ok) {
      assert.match(two.reason, /no split was passed/);
      assert.match(two.reason, /ask Josh one plain question/);
      assert.deepEqual(two.campaign_ids, [10, 11]);
      assert.doesNotMatch(two.reason, /@/);
    }
  });

  it("refuses a lane whose every campaign is STOPPED, and a lane with no recorded build", () => {
    const stopped = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10), member(11)],
      statuses: new Map([
        [10, "STOPPED"],
        [11, "STOPPED"],
      ]),
      records: [rec([10, 11])],
      split: { rule: "x", routing: [{ when: {}, campaign_id: 10 }] },
    });
    assert.equal(stopped.ok, false);
    if (!stopped.ok) assert.match(stopped.reason, /STOPPED/);
    const none = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10)],
      statuses: active(10),
      records: [],
      split: { rule: "x", routing: [{ when: {}, campaign_id: 10 }] },
    });
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.reason, /no list_build_records/);
  });

  it("checks the passed split against the lane: a foreign campaign, an unknown or unreadable dimension, a missing rule are refused", () => {
    const base = { lane: "pe", members: [member(10), member(11)], statuses: active(10, 11), records: [rec([10, 11])] };
    const routing = [{ when: { greeting: "team", mail_class: "SEG" }, campaign_id: 10 }, { when: {}, campaign_id: 11 }];
    const dims = [{ name: "greeting", kind: "present", column: "first_name_n", present: "named", absent: "team" }];
    const foreign = resolveLaneSegmentation({ ...base, split: { rule: "r", routing: [{ when: {}, campaign_id: 99 }] } });
    assert.equal(foreign.ok, false);
    if (!foreign.ok) assert.match(foreign.reason, /#99.*not on lane pe/);
    const unknown = resolveLaneSegmentation({ ...base, split: { rule: "r", routing } });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.reason, /dimension "greeting"/);
    const bad = resolveLaneSegmentation({ ...base, split: { rule: "r", routing, dimensions: [{ name: "greeting", kind: "present", column: "email", present: "a", absent: "b" }] } });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.reason, /cannot read/);
    const noRule = resolveLaneSegmentation({ ...base, split: { rule: "  ", routing, dimensions: dims } });
    assert.equal(noRule.ok, false);
    if (!noRule.ok) assert.match(noRule.reason, /no plain-English rule/);
    const junk = resolveLaneSegmentation({ ...base, split: { rule: "r", routing: [{ campaign_id: 10 }] as never } });
    assert.equal(junk.ok, false);
    if (!junk.ok) assert.match(junk.reason, /no readable routing/);
    const ok = resolveLaneSegmentation({ ...base, split: { rule: "Team copy when no first name; SEG by mail class.", routing, dimensions: dims, from: ["step 564"] } });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.dimensions.length, 1);
    assert.deepEqual(ok.segments.greeting, ["named", "team"]);
    assert.match(ok.split_rule ?? "", /Team copy/);
  });

  it("parseRouting reads only a well-formed array; junk is not a split", () => {
    assert.deepEqual(parseRouting([{ when: { band: "11_50" }, campaign_id: 10 }]), [{ when: { band: "11_50" }, campaign_id: 10 }]);
    assert.equal(parseRouting([{ campaign_id: 10 }]), null);
    assert.equal(parseRouting({ pulled: 2000 }), null);
    assert.equal(parseRouting([]), null);
  });
});
