import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cellLabel, ruleCoversCell, segmentCells, uncoveredCells } from "./cells.js";

/** D28 — step 1 reuses the saved ICP; every cell still needs a campaign. */

describe("step 1 cells", () => {
  const segments = {
    band: ["11_50", "51_200"],
    mail_class: ["SEG", "OTHER"],
    gift: ["team", "airpods"],
  };

  it("builds the cartesian product of the recipe's segments", () => {
    assert.equal(segmentCells(segments).length, 8);
    assert.deepEqual(segmentCells({}), []);
  });

  it("a rule that omits a dimension covers every value of it (AirPods, no mail_class)", () => {
    assert.equal(ruleCoversCell({ gift: "airpods", band: "11_50" }, { gift: "airpods", band: "11_50", mail_class: "SEG" }), true);
    assert.equal(ruleCoversCell({ gift: "airpods", band: "11_50" }, { gift: "airpods", band: "11_50", mail_class: "OTHER" }), true);
    assert.equal(ruleCoversCell({ gift: "airpods", band: "11_50" }, { gift: "team", band: "11_50", mail_class: "SEG" }), false);
  });

  it("Parlay-shaped routing covers all eight cells", () => {
    const routing = [
      { when: { gift: "airpods", band: "11_50" } },
      { when: { gift: "airpods", band: "51_200" } },
      { when: { band: "11_50", mail_class: "OTHER" } },
      { when: { band: "11_50", mail_class: "SEG" } },
      { when: { band: "51_200", mail_class: "OTHER" } },
      { when: { band: "51_200", mail_class: "SEG" } },
    ];
    assert.deepEqual(uncoveredCells(segments, routing), []);
  });

  it("a missing 201_500 band is an uncovered cell, not a silent skip", () => {
    const missing = uncoveredCells({ ...segments, band: ["11_50", "51_200", "201_500"] }, [
      { when: { gift: "airpods", band: "11_50" } },
      { when: { gift: "airpods", band: "51_200" } },
      { when: { band: "11_50", mail_class: "OTHER" } },
      { when: { band: "11_50", mail_class: "SEG" } },
      { when: { band: "51_200", mail_class: "OTHER" } },
      { when: { band: "51_200", mail_class: "SEG" } },
    ]);
    assert.ok(missing.some((c) => c.band === "201_500"));
    assert.match(cellLabel(missing[0]), /band=/);
  });
});
