import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planSlices, sumSlices } from "./chunk.js";

describe("D48 — queries are planned under the vendor timeout, not retried into it", () => {
  it("cuts a 137-city fence into slices of at most 45 before any call", () => {
    const cities = Array.from({ length: 137 }, (_, i) => `City ${i}`);
    const plan = planSlices({ job_titles: ["Owner"], cities });
    assert.equal(plan.by, "cities");
    assert.equal(plan.slices.length, 4);
    assert.deepEqual(plan.slices.map((s) => s.cities?.length), [45, 45, 45, 2]);
    assert.equal(plan.slices.flatMap((s) => s.cities ?? []).length, 137);
    for (const s of plan.slices) assert.deepEqual(s.job_titles, ["Owner"]);
  });

  it("cuts a long industry list the same way and leaves short queries alone", () => {
    const industries = Array.from({ length: 25 }, (_, i) => `Industry ${i}`);
    const plan = planSlices({ job_titles: ["CIO"], industries });
    assert.equal(plan.by, "industries");
    assert.equal(plan.slices.length, 3);
    const same = planSlices({ job_titles: ["CIO"], industries: ["A", "B"] });
    assert.equal(same.by, "none");
    assert.equal(same.slices.length, 1);
  });

  it("disjoint slices add up", () => {
    assert.equal(sumSlices([10, 20, 5]), 35);
    assert.equal(sumSlices([]), 0);
  });
});
