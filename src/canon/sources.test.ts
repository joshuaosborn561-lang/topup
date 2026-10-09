import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeSources, SOURCE_LINES, sourceLine } from "./sources.js";

/** D52 — the source vocabulary: one line per value, nothing guessed for the rest. Ask Josh. */
describe("D52 — sources", () => {
  it("every line names a leg, a meaning, how to repeat it and a cost", () => {
    for (const l of SOURCE_LINES) {
      assert.ok(["company", "domain", "person", "email"].includes(l.leg));
      for (const k of ["value", "means", "repeat_with", "cost"] as const) assert.ok(l[k].length > 3, `${l.leg}/${l.value} ${k}`);
    }
    assert.ok(sourceLine("company", "GetLeads")?.repeat_with.includes("count("));
    assert.equal(sourceLine("company", null), null);
  });

  it("describes the values seen and names the unknown ones instead of inventing a line", () => {
    const d = describeSources({ company: ["getleads", "maps", "made_up_source", null], email: ["email_waterfall", "already"], person: [""] });
    assert.deepEqual(d.lines.map((l) => `${l.leg}:${l.value}`), ["company:getleads", "company:maps", "email:email_waterfall", "email:already"]);
    assert.deepEqual(d.unknown, [{ leg: "company", value: "made_up_source" }]);
  });
});
