import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D34 — QA regexes and the Parlay recipe must not ship the August/September
 * failure modes (bare `federal`, unanchored Target, numeric headcount).
 */

const root = new URL("../../", import.meta.url);

describe("D34 — review fixtures", () => {
  it("regulated_gift_hold does not match the bare word federal", async () => {
    const sql = [
      await readFile(new URL("supabase/migrations/0003_seed_reference_and_qa.sql", root), "utf8"),
      await readFile(new URL("supabase/migrations/0012_d34_prior_contact_and_dedupe.sql", root), "utf8"),
    ].join("\n");
    assert.match(sql, /federal credit union\|federal savings\|federal reserve/);
    assert.doesNotMatch(sql, /\|federal\|/);
    assert.doesNotMatch(sql, /\\bfederal\\b/);
    assert.doesNotMatch(sql, /\\yfederal\\y/);
  });

  it("retail_school_purge anchors Target to inc/corp/stores/pharmacy", async () => {
    const sql = [
      await readFile(new URL("supabase/migrations/0003_seed_reference_and_qa.sql", root), "utf8"),
      await readFile(new URL("supabase/migrations/0012_d34_prior_contact_and_dedupe.sql", root), "utf8"),
    ].join("\n");
    assert.match(sql, /target \(inc\|corp\|stores\?\|pharmacy\)/);
  });

  it("Parlay recipe has no numeric employee bound", async () => {
    const recipe = await readFile(new URL("recipes/parlay/it_dm.json", root), "utf8");
    assert.doesNotMatch(recipe, /employee_profiles_on_linkedin/);
  });
});
