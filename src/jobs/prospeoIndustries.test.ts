import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapProspeoIndustry, PROSPEO_INDUSTRIES } from "./prospeoIndustries.js";

/** D83 — ICP industries map onto Prospeo's official list. Ask Josh. */

describe("D83 — Prospeo industry map", () => {
  it("has 256 official names including Truck and Railroad Transportation", () => {
    assert.equal(PROSPEO_INDUSTRIES.length, 256);
    assert.ok(PROSPEO_INDUSTRIES.includes("Truck and Railroad Transportation"));
    assert.ok(PROSPEO_INDUSTRIES.includes("Hospitals and Health Care"));
    assert.ok(!PROSPEO_INDUSTRIES.includes("Truck Transportation"));
    assert.ok(!PROSPEO_INDUSTRIES.includes("Outpatient Care Centers"));
  });

  it("maps Truck Transportation inexactly and leaves Outpatient Care Centers unmatched", () => {
    const truck = mapProspeoIndustry("Truck Transportation");
    assert.equal(truck.match, "inexact");
    assert.equal(truck.prospeo, "Truck and Railroad Transportation");
    const none = mapProspeoIndustry("Outpatient Care Centers");
    assert.equal(none.match, "none");
    assert.equal(none.prospeo, null);
    const exact = mapProspeoIndustry("Hospitals and Health Care");
    assert.equal(exact.match, "exact");
    assert.equal(exact.prospeo, "Hospitals and Health Care");
    const punct = mapProspeoIndustry("Transportation; Logistics; Supply Chain and Storage");
    assert.equal(punct.match, "inexact");
    assert.equal(punct.prospeo, "Transportation, Logistics, Supply Chain and Storage");
  });
});
