import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { permitTotal } from "./permits.js";

describe("permit metrics_monthly parser", () => {
  it("reads total_permits and the window the API applied", () => {
    const parsed = permitTotal({
      total_permits: 52317,
      undated: 14,
      series: [{ month: "2026-01", permits: 1, total_value: 0 }],
      filters: { state: "TX", city: null, category: "ROOFING", categories_matched: ["ROOFING"], months: 24 },
    });
    assert.equal(parsed.total, 52317);
    assert.equal(parsed.months, 24);
    assert.equal(parsed.state, "TX");
  });

  it("counts a real zero and refuses a payload with no total", () => {
    assert.equal(permitTotal({ total_permits: 0, filters: { state: "TX", months: 24 } }).total, 0);
    assert.throws(() => permitTotal({ series: [], filters: { months: 24 } }), /total_permits/);
  });
});
