import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parseRecipe } from "../recipes/schema.js";
import { BANNED_VENDORS } from "../spend/prices.js";
import { DEFAULT_RECYCLE_DAYS, recycleDays } from "../stages/suppress/recycle.js";

/** D35 — Josh's merged list. Live-campaign default and the six taps moved to D36. */

const root = new URL("../../", import.meta.url);

describe("D35 — merged list", () => {
  it("recycle defaults to 90 days", async () => {
    assert.equal(DEFAULT_RECYCLE_DAYS, 90);
    assert.equal(recycleDays(undefined), 90);
    const r = parseRecipe(JSON.parse(await readFile(new URL("recipes/parlay/it_dm.json", root), "utf8")));
    assert.equal(r.suppression.recycle_after_days, 90);
  });

  it("Hunter is banned; variant bar is 1,000 sends; Parlay omits email_status", async () => {
    assert.ok(BANNED_VENDORS.includes("hunter"));
    const raw = JSON.parse(await readFile(new URL("recipes/parlay/it_dm.json", root), "utf8")) as {
      working: { variant_min_sends: number };
      source: { params: Record<string, unknown> };
    };
    assert.equal(raw.working.variant_min_sends, 1000);
    assert.equal("email_status" in raw.source.params, false);
  });

  it("regulated_gift_hold names insurance and stays a hold", async () => {
    const sql = [
      await readFile(new URL("supabase/migrations/0003_seed_reference_and_qa.sql", root), "utf8"),
      await readFile(new URL("supabase/migrations/0013_d35_insurance_hold.sql", root), "utf8"),
    ].join("\n");
    assert.match(sql, /insurance/);
    assert.match(sql, /regulated_gift_hold/);
    assert.match(sql, /'hold'/);
  });

  it("the skill still lists the six items D36 later decided", async () => {
    const skill = await readFile(new URL("skills/merged-list/SKILL.md", root), "utf8");
    assert.match(skill, /two live campaigns/);
    assert.match(skill, /New York and New Jersey/);
    assert.match(skill, /Florida IT DM is statewide/);
    assert.match(skill, /3,958 operators/);
    assert.match(skill, /Gateway catch alls dropped/);
    assert.match(skill, /Name to Email is paused/);
  });
});
