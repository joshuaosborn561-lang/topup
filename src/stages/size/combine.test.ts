import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { combineByUnit, combineSizeLine } from "./combine.js";

const people = (label: string, total: number, counted = true, reason: string | null = null) => ({
  label,
  unit: "people" as const,
  counted,
  total,
  detail: null,
  reason,
});

describe("size each segment list, then combine", () => {
  it("adds every counted list of the same unit", () => {
    const sums = combineByUnit([people("general contractor", 1200), people("commercial construction", 800)]);
    assert.equal(sums.allCounted, true);
    assert.equal(sums.units[0]?.total, 2000);
    assert.equal(combineSizeLine([people("general contractor", 1200), people("commercial construction", 800)]).kind, "total");
  });

  it("does not treat a partial sum as the TAM", () => {
    const line = combineSizeLine([
      people("general contractor", 0, false, "maps counter is not wired"),
      people("property managers", 400),
    ]);
    assert.equal(line.kind, "incomplete");
    if (line.kind === "incomplete") {
      assert.match(line.text, /400 matching/);
      assert.match(line.text, /not combined into one TAM/);
      assert.match(line.text, /maps counter is not wired/);
    }
  });

  it("a list that was not counted adds nothing", () => {
    const sums = combineByUnit([people("a", 10), people("b", 99, false, "parked")]);
    assert.equal(sums.units[0]?.total, 10);
    assert.equal(sums.allCounted, false);
  });

  it("does not add businesses and permits into one total", () => {
    const sums = combineByUnit([
      { label: "general contractor", unit: "businesses", counted: true, total: 2178, detail: "in TX", reason: null },
      { label: "ROOFING", unit: "permits", counted: true, total: 52317, detail: "in TX over 24 months", reason: null },
    ]);
    assert.equal(sums.allCounted, true);
    assert.deepEqual(
      sums.units.map((unit) => [unit.unit, unit.total]),
      [
        ["businesses", 2178],
        ["permits", 52317],
      ],
    );
  });
});
