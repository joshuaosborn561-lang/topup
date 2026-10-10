import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getleadsParamsFromFilters } from "./filters.js";

/** D74 — stored getleads keys map or the parse fails. Ask Josh. */

describe("D74 — getleads filter mapping", () => {
  it("keeps the comma LinkedIn industry as the getleads semicolon name", () => {
    const r = getleadsParamsFromFilters({
      job_titles: ["Fleet Manager"],
      industries: ["Truck Transportation", "Transportation, Logistics, Supply Chain and Storage"],
      company_description: "3PL, freight",
      purged_titles: ["Dispatcher"],
      max_per_company: 2,
    });
    assert.ok(r.ok);
    assert.deepEqual(r.params.industries, ["Truck Transportation", "Transportation; Logistics; Supply Chain and Storage"]);
    assert.equal(r.params.company_description, "3PL, freight");
    assert.deepEqual(r.params.exclude_job_titles, ["Dispatcher"]);
    assert.equal(r.params.max_per_company, 2);
  });

  it("fails loud on an unmapped key or an unknown industry", () => {
    const parent = getleadsParamsFromFilters({
      job_titles: ["Partner"],
      industries_by_campaign: { "3763801": ["Hospitals"] },
    });
    assert.equal(parent.ok, false);
    if (!parent.ok) assert.match(parent.error, /industries_by_campaign/);
    const meta = getleadsParamsFromFilters({ job_titles: ["Partner"], icp_gate: "yes", over_1k_campaign: true });
    assert.equal(meta.ok, false);
    if (!meta.ok) assert.match(meta.error, /icp_gate/);
    const unknown = getleadsParamsFromFilters({ job_titles: ["Partner"], industries: ["Not A Real Industry"] });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /not a getleads industry/);
  });
});
