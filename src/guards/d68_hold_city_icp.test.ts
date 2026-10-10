import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { icpCategoryClause, isLaneEIcp, LANE_E_SCHOOL_CATEGORIES, LANE_E_SCHOOL_NAME_RE, schoolExcludeClause } from "../canon/icpFilter.js";
import { mapsCitySql, mapsStateSql } from "../canon/mapsPool.js";
import { STEP_RULES } from "../jobs/rules.js";
import { conversationalLocation } from "../stages/normalize/location.js";
import { normalizeCity } from "../stages/normalize/names.js";
import { emptyMergeFields, MERGE_FIELD_COLUMN, mergeFieldColumn } from "../spine/gate.js";
import { cityKey, type CityCoords } from "../stages/normalize/geo.js";

/**
 * D68 — job 46b1c941 after #45. Ask Josh before any of this changes.
 */

const root = new URL("../../", import.meta.url);
const coords: CityCoords = new Map([[cityKey("Naperville", "IL"), { lat: 41.7508, lon: -88.1535 }]]);

describe("D68 — hold column, city parse, ICP categories + schools", () => {
  it("hold and fill share company_n; company_name maps to it", async () => {
    assert.equal(mergeFieldColumn("company_name"), "company_n", "D68: the copy's company_name is company_n after normalize. Ask Josh.");
    assert.equal(mergeFieldColumn("company_n"), "company_n");
    assert.equal(mergeFieldColumn("first_name"), "first_name_n");
    assert.equal(MERGE_FIELD_COLUMN.company_name, "company_n");
    assert.deepEqual(
      emptyMergeFields({ company_n: "Acme", company_name: "", first_name_n: "Jane" }, ["company_name", "first_name_n"]),
      [],
      "D68: an empty raw company_name must not hold when company_n is filled. Ask Josh.",
    );
    assert.deepEqual(
      emptyMergeFields({ company_n: "", company_name: "Acme" }, ["company_n"]),
      [],
      "D68: company_n is canonical; a filled company_name still passes. Ask Josh.",
    );
    const norm = await readFile(new URL("src/stages/normalize/index.ts", root), "utf8");
    assert.match(norm, /company_name = coalesce\(nullif\(btrim\(t\.company_name\), ''\), v\.company_n\)/, "D68: empty company_name is filled from company_n. Ask Josh.");
    assert.match(norm, /coalesce\(nullif\(btrim\(company_n::text\), ''\), nullif\(btrim\(company_name::text\), ''\)\)/, "D68: the hold reads company_n first. Ask Josh.");
    const qa = await readFile(new URL("src/stages/qa/index.ts", root), "utf8");
    assert.match(qa, /company_name: "company_n"/, "D68: QA maps company_name to company_n. Ask Josh.");
    assert.equal(STEP_RULES.normalize, "d68:hold-city-icp", "D68: normalize hash must change so the 147 reopen. Ask Josh.");
  });

  it("City, ST in city geocodes after the split; ingest SQL takes the city token", () => {
    const city = normalizeCity("Naperville, IL");
    assert.equal(city.city, "Naperville");
    assert.ok(city.flags.includes("city_state_split"));
    const loc = conversationalLocation("Naperville, IL", "IL", coords);
    assert.equal(loc.source, "metro");
    const cols = new Set(["city", "state"]);
    assert.match(mapsCitySql("s", cols) ?? "", /split_part/);
    assert.match(mapsStateSql("s", cols) ?? "", /coalesce/);
  });

  it("lane E ICP matches main_category and excludes preschool–high school, not lane D", () => {
    assert.equal(isLaneEIcp("v_lane_e_final"), true);
    assert.equal(isLaneEIcp("v_lane_d_final"), false);
    assert.equal(isLaneEIcp("v_lane_e_scored2"), true);
    const cols = new Set(["main_category", "source_category", "name"]);
    const cat = icpCategoryClause("m", cols, ["church", "hotel"], "$2");
    assert.match(cat, /main_category/, "D68: ICP categories are main_category. Ask Josh.");
    assert.doesNotMatch(cat, /source_category/, "D68: source_category is the scrape bucket and does not filter. Ask Josh.");
    const school = schoolExcludeClause("m", cols);
    assert.match(school, /private school/, "D68: private school is a lane D category. Ask Josh.");
    assert.match(school, /high school/);
    assert.match(school, LANE_E_SCHOOL_NAME_RE);
    assert.ok(LANE_E_SCHOOL_CATEGORIES.includes("elementary school"));
    assert.ok(!LANE_E_SCHOOL_CATEGORIES.includes("university"), "D68: college stays off the lane E school list. Ask Josh.");
  });

  it("CANON names the hold column, the city split, and the ICP category + school rule", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D68\*\*/, "D68: fold into CANON. Ask Josh.");
    assert.match(canon, /company_n/, "D68: the hold reads company_n. Ask Josh.");
    assert.match(canon, /main_category/, "D68: ICP categories are main_category. Ask Josh.");
    assert.match(canon, /lane D/, "D68: schools belong to lane D. Ask Josh.");
    const pool = await readFile(new URL("src/canon/mapsPool.ts", root), "utf8");
    assert.match(pool, /icpCategoryClause/, "D68: ICP count/pull use main_category. Ask Josh.");
    assert.match(pool, /schoolExcludeClause/, "D68: lane E drops schools. Ask Josh.");
    assert.match(pool, /mapsCitySql/, "D68: ingest parses City, ST. Ask Josh.");
  });
});
