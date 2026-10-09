import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ICP_CATEGORY, parseIcpCategory } from "./parse.js";

/** D64 — Jev's category is a token, never the raw sentence. Ask Josh. */

describe("D64 — parseIcpCategory", () => {
  it("keeps a snake_case choice", () => {
    assert.deepEqual(parseIcpCategory("electrical_contractor", "a long sentence"), { label: "electrical_contractor", unparseable: false });
    assert.ok(ICP_CATEGORY.test("electrical_contractor"));
  });

  it("accepts a token reason when choice is missing", () => {
    assert.deepEqual(parseIcpCategory(null, "hvac"), { label: "hvac", unparseable: false });
  });

  it("never stores the raw sentence", () => {
    const r = parseIcpCategory(null, "This looks like a commercial electrical contractor based on the about page.");
    assert.equal(r.label, null);
    assert.equal(r.unparseable, true);
  });
});
