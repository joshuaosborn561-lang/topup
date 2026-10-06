import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapsScopedCount } from "./mapsStats.js";

describe("maps pipeline_stats parser", () => {
  it("reads scoped_businesses and does not read the global businesses total", () => {
    assert.equal(mapsScopedCount({ businesses: 294566, scoped_businesses: 2178 }), 2178);
    assert.equal(mapsScopedCount({ scoped_businesses: 0, businesses: 294566 }), 0);
  });

  it("unwraps the JSON string the live tool returns and still ignores the global total", () => {
    const wrapped = { result: JSON.stringify({ businesses: 294566, scoped_businesses: 2178, scope: { state: "TX" } }) };
    assert.equal(mapsScopedCount(wrapped), 2178);
    assert.throws(() => mapsScopedCount({ result: JSON.stringify({ businesses: 294566 }) }), /scoped_businesses/);
  });

  it("refuses a payload that only has the global total", () => {
    assert.throws(() => mapsScopedCount({ businesses: 294566 }), /scoped_businesses/);
    assert.throws(() => mapsScopedCount({ scoped_businesses: -1 }), /not a count/);
    assert.throws(() => mapsScopedCount(null), /scoped_businesses/);
  });
});
