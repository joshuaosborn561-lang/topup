import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INTERESTED_CATEGORY_IDS, isWorking, ratePer2000 } from "./working.js";

/** D11 — one interested reply per 2,000 sends, from interested categories only. */

const base = { interestedPer2000: 1, variantMinSends: 300, override: null as boolean | null };

describe("working (D11)", () => {
  it("counts only the interested categories", () => {
    assert.deepEqual([...INTERESTED_CATEGORY_IDS], [1, 2, 131482]);
  });

  it("rate is per 2,000 sends", () => {
    assert.equal(ratePer2000(4000, 2), 1);
    assert.equal(ratePer2000(0, 0), 0);
  });

  it("campaign at or above the bar is working", () => {
    const v = isWorking({ ...base, sends: 4000, interested: 2, variants: [] });
    assert.equal(v.working, true);
  });

  it("campaign below the bar but one variant with volume clears it: working, dead variant named", () => {
    const v = isWorking({
      ...base,
      sends: 6000,
      interested: 2,
      variants: [
        { label: "A", step_number: 1, subject_line: null, sends: 2000, interested: 2 },
        { label: "B", step_number: 1, subject_line: null, sends: 4000, interested: 0 },
      ],
    });
    assert.equal(v.working, true);
    assert.deepEqual(v.liveVariants, ["A"]);
    assert.deepEqual(v.deadVariants, ["B"]);
  });

  it("variants under 300 sends are too early to judge", () => {
    const v = isWorking({ ...base, sends: 200, interested: 0, variants: [{ label: "A", step_number: 1, subject_line: null, sends: 200, interested: 0 }] });
    assert.equal(v.working, true);
    assert.match(v.reason, /too early/);
  });

  it("nothing clears the bar with real volume: not working", () => {
    const v = isWorking({ ...base, sends: 5000, interested: 1, variants: [{ label: "A", step_number: 1, subject_line: null, sends: 5000, interested: 1 }] });
    assert.equal(v.working, false);
  });

  it("an owner override wins either way", () => {
    assert.equal(isWorking({ ...base, sends: 5000, interested: 0, variants: [], override: true }).working, true);
    assert.equal(isWorking({ ...base, sends: 5000, interested: 50, variants: [], override: false }).working, false);
  });
});
