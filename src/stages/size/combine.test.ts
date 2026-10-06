import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { combineSegmentTotals, combineSizeLine } from "./combine.js";

describe("size each segment list, then combine", () => {
  it("adds every counted list", () => {
    const sums = combineSegmentTotals([
      { label: "general contractor", counted: true, total: 1200, reason: null },
      { label: "commercial construction", counted: true, total: 800, reason: null },
    ]);
    assert.equal(sums.allCounted, true);
    assert.equal(sums.total, 2000);
    assert.equal(combineSizeLine([
      { label: "general contractor", counted: true, total: 1200, reason: null },
      { label: "commercial construction", counted: true, total: 800, reason: null },
    ]).kind, "total");
  });

  it("does not treat a partial sum as the TAM", () => {
    const line = combineSizeLine([
      { label: "general contractor", counted: false, total: 0, reason: "maps counter is not wired" },
      { label: "property managers", counted: true, total: 400, reason: null },
    ]);
    assert.equal(line.kind, "incomplete");
    if (line.kind === "incomplete") {
      assert.match(line.text, /400 matching/);
      assert.match(line.text, /not combined into one TAM/);
      assert.match(line.text, /maps counter is not wired/);
    }
  });

  it("a list that was not counted adds nothing", () => {
    const sums = combineSegmentTotals([
      { label: "a", counted: true, total: 10, reason: null },
      { label: "b", counted: false, total: 99, reason: "parked" },
    ]);
    assert.equal(sums.total, 10);
    assert.equal(sums.allCounted, false);
  });
});
