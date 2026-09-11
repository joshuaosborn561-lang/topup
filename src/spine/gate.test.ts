import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gateUnmet, mergeFieldsGate, sendableGate } from "./gate.js";

describe("spine gates — D24", () => {
  it("step 6: zero sendable out of any verified rows fails the sendable rule; a small list does not", () => {
    const g = sendableGate({ sendable: 0, rejected: 380, stalled: 20 });
    assert.ok(g);
    assert.equal(g.step, 6);
    assert.equal(g.gate, "sendable rule and stall runbook");
    assert.match(g.why, /0 sendable of 400 verified/);
    assert.equal(sendableGate({ sendable: 1, rejected: 399, stalled: 0 }), null);
    assert.equal(sendableGate({ sendable: 0, rejected: 0, stalled: 0 }), null, "nothing verified is 'nothing', not a failed gate");
  });

  it("step 7: an empty required merge field fails 'every merge field populated' with counts per field, never rows", () => {
    const g = mergeFieldsGate({ normalized: 400, rows_with_empty: 3, empty_by_field: { first_name_n: 2, company_n: 1 } });
    assert.ok(g);
    assert.equal(g.step, 7);
    assert.equal(g.gate, "every merge field populated");
    assert.match(g.why, /3 of 400 normalized rows have an empty merge field \(first_name_n 2, company_n 1\)/);
    assert.deepEqual(g.counts, { normalized: 400, rows_with_empty: 3, empty_first_name_n: 2, empty_company_n: 1 });
    assert.equal(mergeFieldsGate({ normalized: 400, rows_with_empty: 0, empty_by_field: { first_name_n: 0, company_n: 0 } }), null);
  });

  it("a stage the spine has not placed cannot fail a gate", () => {
    assert.throws(() => gateUnmet("stage", "x"), /not placed on a spine step/);
  });
});
