import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyMergeFields, gateUnmet, mergeFieldsToHold, rejectRate, rejectRateGate } from "./gate.js";

describe("spine gates — D24/D25", () => {
  it("step 6: zero sendable out of any verified rows fails the gate whatever the norm; a small list does not", () => {
    const g = rejectRateGate({ sendable: 0, rejected: 380, stalled: 20 }, null);
    assert.ok(g);
    assert.equal(g.step, 6);
    assert.match(g.gate, /^sendable count and reject rate reported/);
    assert.match(g.why, /0 sendable of 400 verified/);
    assert.match(g.why, /reject rate 100\.0%/);
    assert.equal(rejectRateGate({ sendable: 1, rejected: 399, stalled: 0 }, null), null, "no norm on the recipe: only the unarguable case fires");
    assert.equal(rejectRateGate({ sendable: 0, rejected: 0, stalled: 0 }, null), null, "nothing verified is 'nothing', not a failed gate");
  });

  it("step 6: a reject rate far above the lane's norm stops the run and says the source is bad", () => {
    // norm 20%: stop line is max(40%, 30%) = 40%
    const bad = rejectRateGate({ sendable: 500, rejected: 500, stalled: 0 }, 0.2);
    assert.ok(bad);
    assert.match(bad.why, /reject rate 50\.0% is far above the lane's norm 20\.0% \(stop line 40\.0%\)/);
    assert.match(bad.why, /The source is bad/);
    assert.equal(bad.counts.norm_bp, 2000);
    assert.equal(rejectRateGate({ sendable: 700, rejected: 300, stalled: 0 }, 0.2), null, "30% on a 20% norm is above, not far above");
    // norm 2%: the ten point floor keeps a 3.9% run from stopping; 13% does
    assert.equal(rejectRateGate({ sendable: 961, rejected: 39, stalled: 0 }, 0.02), null);
    assert.ok(rejectRateGate({ sendable: 870, rejected: 130, stalled: 0 }, 0.02));
  });

  it("step 6: under fifty verdicts the norm comparison does not fire, and stalled rows are not verdicts", () => {
    assert.equal(rejectRateGate({ sendable: 10, rejected: 30, stalled: 0 }, 0.05), null, "40 verdicts is too few to call a source bad");
    assert.equal(rejectRate({ sendable: 50, rejected: 50, stalled: 900 }), 0.5, "stalled rows stay out of the ratio");
    assert.equal(rejectRate({ sendable: 0, rejected: 0, stalled: 5 }), null);
  });

  it("step 7: the fields the copy uses are the recipe's required fields, minus the team (no team routes to AirPods, it is not a hold)", () => {
    assert.deepEqual(mergeFieldsToHold(["first_name_n", "company_n", "location", "local_sports_team", "job_title", "company_size", "vertical"]), [
      "first_name_n",
      "company_n",
      "location",
      "job_title",
      "company_size",
      "vertical",
    ]);
    assert.throws(() => mergeFieldsToHold(["first_name_n; drop table x"]), /not a column the step 7 hold can test/);
  });

  it("step 7: an empty or blank required field holds the row; the team does not", () => {
    const fields = mergeFieldsToHold(["first_name_n", "company_n", "location", "local_sports_team"]);
    assert.deepEqual(emptyMergeFields({ first_name_n: "Jane", company_n: "Acme", location: "Chicagoland", local_sports_team: null }, fields), []);
    assert.deepEqual(emptyMergeFields({ first_name_n: null, company_n: "  ", location: "Chicagoland" }, fields), ["first_name_n", "company_n"]);
    assert.deepEqual(emptyMergeFields({ first_name_n: "Jane", company_n: "Acme", location: "" }, fields), ["location"], "NO_GEOCODE leaves location blank, and a blank merge field is a hold, never a broken sentence");
  });

  it("a stage the spine has not placed cannot fail a gate", () => {
    assert.throws(() => gateUnmet("nowhere" as never, "x"), /not placed on a spine step/);
  });
});
