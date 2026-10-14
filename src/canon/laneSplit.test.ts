import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLaneSegmentation, routingFromRecord, type LaneRecord } from "./laneSplit.js";
import type { RegistryCampaign } from "./registry.js";

/** D105 — a lane splits only the way its list_build_records already did. STOPPED is never a target. Ask Josh. */

function member(id: number, extra: Partial<RegistryCampaign> = {}): RegistryCampaign {
  return { campaign_id: id, client_tag: "aa", smartlead_client_id: 1, lane: "pe", ...extra };
}

function rec(campaign_ids: number[], extra: Partial<LaneRecord> = {}): LaneRecord {
  return { campaign_ids, lanes: ["pe"], ...extra };
}

describe("D105 — lane split from the recorded build", () => {
  it("uses routing stored on the list_build_record and drops STOPPED targets", () => {
    const routing = [
      { when: { mail_class: "SEG" }, campaign_id: 10 },
      { when: { mail_class: "OTHER" }, campaign_id: 11 },
      { when: { mail_class: "OTHER", gift: "air" }, campaign_id: 12 },
    ];
    const out = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10), member(11), member(12), member(13)],
      statuses: new Map([
        [10, "ACTIVE"],
        [11, "PAUSED"],
        [12, "STOPPED"],
        [13, "ACTIVE"],
      ]),
      records: [rec([10, 11, 12, 13], { yield_by_step: { routing, segments: { mail_class: ["SEG", "OTHER"] }, confirmed_by: "Josh" } })],
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.campaign_ids, [10, 11]);
    assert.deepEqual(out.stopped_ids, [12]);
    assert.equal(out.source, "record_routing");
    assert.ok(!out.routing.some((r) => r.campaign_id === 12), "D105: STOPPED is never in the split");
    assert.equal(out.routing.some((r) => r.campaign_id === 11), true, "D105: PAUSED may still be refilled");
  });

  it("builds routing from unique stored cells when the record names the campaigns but carries no routing", () => {
    const out = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10, { band: "11_50", mail_class: "OTHER" }), member(11, { band: "51_200", mail_class: "OTHER" }), member(99, { lane: "other" })],
      statuses: new Map([
        [10, "ACTIVE"],
        [11, "ACTIVE"],
      ]),
      records: [rec([10, 11])],
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.source, "registry_cells");
    assert.deepEqual(out.campaign_ids, [10, 11]);
    assert.deepEqual(
      out.routing.map((r) => r.campaign_id),
      [10, 11],
    );
  });

  it("one named refillable campaign is a catch-all; STOPPED siblings are excluded", () => {
    const out = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10), member(11)],
      statuses: new Map([
        [10, "ACTIVE"],
        [11, "STOPPED"],
      ]),
      records: [rec([10, 11])],
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.source, "single_campaign");
    assert.deepEqual(out.routing, [{ when: {}, campaign_id: 10 }]);
    assert.deepEqual(out.stopped_ids, [11]);
  });

  it("refuses to guess when several named campaigns share no unique cell and no recorded routing", () => {
    const out = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10), member(11)],
      statuses: new Map([
        [10, "ACTIVE"],
        [11, "PAUSED"],
      ]),
      records: [rec([10, 11])],
    });
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.match(out.reason, /cannot be determined/);
    assert.deepEqual(out.campaign_ids, [10, 11]);
    assert.doesNotMatch(out.reason, /@/);
  });

  it("refuses a lane whose every campaign is STOPPED, and a lane with no records", () => {
    const stopped = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10), member(11)],
      statuses: new Map([
        [10, "STOPPED"],
        [11, "STOPPED"],
      ]),
      records: [rec([10, 11])],
    });
    assert.equal(stopped.ok, false);
    if (!stopped.ok) assert.match(stopped.reason, /STOPPED/);
    const none = resolveLaneSegmentation({
      lane: "pe",
      members: [member(10)],
      statuses: new Map([[10, "ACTIVE"]]),
      records: [],
    });
    assert.equal(none.ok, false);
    if (!none.ok) assert.match(none.reason, /no list_build_records/);
  });

  it("a split read from the recorded build quotes on its own (D107); an unknown or unreadable dimension is refused, never guessed (D106)", () => {
    const routing = [{ when: { greeting: "team", mail_class: "SEG" }, campaign_id: 10 }, { when: {}, campaign_id: 11 }];
    const base = { lane: "pe", members: [member(10), member(11)], statuses: new Map([[10, "ACTIVE"], [11, "ACTIVE"]]) as ReadonlyMap<number, string | null> };
    const dims = [{ name: "greeting", kind: "present", column: "first_name_n", present: "named", absent: "team" }];
    const unsigned = resolveLaneSegmentation({ ...base, records: [rec([10, 11], { yield_by_step: { routing, dimensions: dims } })] });
    assert.equal(unsigned.ok, true, "D107: the split read from the transcript is the truth, like the build; nobody has to confirm it");
    if (unsigned.ok) assert.equal(unsigned.confirmed_by, null);
    const unknown = resolveLaneSegmentation({ ...base, records: [rec([10, 11], { yield_by_step: { routing } })] });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.reason, /dimension "greeting"/);
    const bad = resolveLaneSegmentation({ ...base, records: [rec([10, 11], { yield_by_step: { routing, dimensions: [{ name: "greeting", kind: "present", column: "email", present: "a", absent: "b" }], confirmed_by: "Josh" } })] });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.reason, /cannot read/);
    const ok = resolveLaneSegmentation({ ...base, records: [rec([10, 11], { yield_by_step: { routing, dimensions: dims, confirmed_by: "Josh", split_rule: "Team copy when no first name; SEG by mail class." } })] });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.confirmed_by, "Josh");
    assert.equal(ok.dimensions.length, 1);
    assert.deepEqual(ok.segments.greeting, ["named", "team"]);
    assert.match(ok.split_rule ?? "", /Team copy/);
  });

  it("routingFromRecord reads only a well-formed array; junk is not a split", () => {
    assert.deepEqual(routingFromRecord({ routing: [{ when: { band: "11_50" }, campaign_id: 10 }] }), [{ when: { band: "11_50" }, campaign_id: 10 }]);
    assert.equal(routingFromRecord({ routing: [{ campaign_id: 10 }] }), null);
    assert.equal(routingFromRecord({ pulled: 2000 }), null);
  });
});
