import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jobRecipe, type JobSpec } from "./recipe.js";

/** D52 — a job recipe is Grok's inputs plus the service defaults; nothing inferred from a lane or a client. Ask Josh. */

const base: JobSpec = { client_tag: "bcp", smartlead_client_id: 542838, lane: "it_dm_airpods", campaign_id: 3921850, source: "getleads", filters: { job_titles: ["CIO"], industries: ["Hospitals"], company_size: ["51 to 200"], countries: ["United States"] }, max_rows: 1200 };

describe("D52 — job recipe", () => {
  it("builds a one-campaign getleads recipe with the rows as the cap, no auto spend, and the default email ceiling", () => {
    const r = jobRecipe(base, 1700000000000);
    assert.equal(r.recipe_id, "bcp.job_3921850_1700000000000.v1", "D52: a job recipe id names its own lane, so findRecipe never returns it for a real lane");
    assert.equal(r.source.kind, "getleads");
    if (r.source.kind === "getleads") assert.deepEqual(r.source.params.job_titles, ["CIO"]);
    assert.deepEqual(r.routing.map((x) => x.campaign_id), [3921850]);
    assert.equal(r.routing[0]?.icp.kind, "linkedin_native");
    assert.equal(r.runway.max_per_run, 1200);
    assert.equal(r.spend.auto_cap_usd, 0);
    assert.equal(r.email_finding.max_tier, "leadmagic");
    assert.equal(r.suppression.response_based, true);
  });

  it("maps, permits and a table become their sources; physical by default", () => {
    const maps = jobRecipe({ ...base, source: "maps", filters: { maps: "roofing, hvac", states: ["TX"] } });
    assert.equal(maps.source.kind, "maps");
    if (maps.source.kind === "maps") assert.deepEqual(maps.source.params.categories, ["roofing", "hvac"]);
    assert.equal(maps.routing[0]?.icp.kind, "physical");
    const permits = jobRecipe({ ...base, source: "permits", filters: { permit_types: ["roof"], states: ["TX"] } });
    assert.equal(permits.source.kind, "permits");
    const table = jobRecipe({ ...base, source: "table", filters: { table: "client_vasco.dealers", where: "wf_email is not null" } });
    assert.equal(table.source.kind, "supabase_table");
  });

  it("refuses what it cannot build instead of guessing", () => {
    assert.throws(() => jobRecipe({ ...base, filters: { industries: ["Hospitals"] } }), /job_titles/);
    assert.throws(() => jobRecipe({ ...base, source: "maps", filters: {} }), /categories/);
    assert.throws(() => jobRecipe({ ...base, max_rows: 0 }), /max_rows/);
    assert.throws(() => jobRecipe({ ...base, max_rows: 2001 }), /max_rows/, "D53: a job pulls 1 to 2,000 rows");
  });
});
