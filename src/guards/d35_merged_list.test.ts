import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parseRecipe } from "../recipes/schema.js";
import { BANNED_VENDORS } from "../spend/prices.js";
import { DEFAULT_RECYCLE_DAYS, recycleDays } from "../stages/suppress/recycle.js";

/** D35 — Josh's merged list. Pending taps stay questions. */

const root = new URL("../../", import.meta.url);

describe("D35 — merged list", () => {
  it("recycle defaults to 90 days; live-campaign exclude is off until Josh taps", async () => {
    assert.equal(DEFAULT_RECYCLE_DAYS, 90);
    assert.equal(recycleDays(undefined), 90);
    const r = parseRecipe(JSON.parse(await readFile(new URL("recipes/parlay/it_dm.json", root), "utf8")));
    assert.equal(r.suppression.recycle_after_days, 90);
    assert.equal(r.suppression.exclude_other_live_campaigns, false);
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

  it("the skill lists every pending tap and does not treat them as decided", async () => {
    const skill = await readFile(new URL("skills/merged-list/SKILL.md", root), "utf8");
    for (const needle of ["2's addition", "26", "27", "53", "58", "71"]) {
      assert.match(skill, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(skill, /Pending Josh's tap/);
    assert.match(skill, /Do not encode those as decided/);
  });
});
