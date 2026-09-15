import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parseRecipe } from "../recipes/schema.js";
import { EMAIL_SOURCES } from "../recipes/receipt.js";
import { isGatewayCatchallDrop } from "../stages/verify/sendable.js";
import { clientPriorContactSql } from "../stages/suppress/recycle.js";

/** D36 — Josh said yes to every tap D35 left pending. */

const root = new URL("../../", import.meta.url);

describe("D36 — pending taps are yes", () => {
  it("live-campaign exclude is on; Name to Email is paused; Insight drop is off on Parlay", async () => {
    const r = parseRecipe(JSON.parse(await readFile(new URL("recipes/parlay/it_dm.json", root), "utf8")));
    assert.equal(r.suppression.exclude_other_live_campaigns, true);
    assert.equal(r.email_finding.name_to_email, false);
    assert.equal(r.verify.drop_gateway_catchalls, false);
    const sql = clientPriorContactSql("$10", true);
    assert.match(sql, /leads_staging/);
    assert.match(sql, /STOPPED/);
  });

  it("TechEvo NE includes NY/NJ; Florida IT DM is statewide; SFL owners stay metro", async () => {
    const skill = await readFile(new URL("skills/techevo-lead-pulls/SKILL.md", root), "utf8");
    assert.match(skill, /New York/);
    assert.match(skill, /New Jersey/);
    assert.match(skill, /statewide/);
    assert.match(skill, /metro/);
    assert.doesNotMatch(skill, /Pending Josh's tap/);
  });

  it("Earthworks 2+ parcels and 3,958 operators are decided", async () => {
    const skill = await readFile(new URL("skills/earthworks-lead-pulls/SKILL.md", root), "utf8");
    assert.match(skill, /2 plus parcels/);
    assert.match(skill, /3,958/);
    assert.match(skill, /Do not use it/);
  });

  it("Insight drops gateway catch-alls; the helper only fires on SEG + catch-all when the flag is on", () => {
    assert.equal(isGatewayCatchallDrop({ drop: false, mailClass: "seg", mvStatus: "catch_all", verifyPath: "catch_all_n2b" }), false);
    assert.equal(isGatewayCatchallDrop({ drop: true, mailClass: "seg", mvStatus: "catch_all", verifyPath: null }), true);
    assert.equal(isGatewayCatchallDrop({ drop: true, mailClass: "seg", mvStatus: "ok", verifyPath: "catch_all_n2b" }), true);
    assert.equal(isGatewayCatchallDrop({ drop: true, mailClass: "direct", mvStatus: "catch_all", verifyPath: "catch_all_n2b" }), false);
    assert.equal(isGatewayCatchallDrop({ drop: true, mailClass: "seg", mvStatus: "ok", verifyPath: "mv_ok" }), false);
  });

  it("receipts may name discolike as an email source; Name to Email stays a historical value", () => {
    assert.ok(EMAIL_SOURCES.includes("discolike"));
    assert.ok(EMAIL_SOURCES.includes("name_to_email"));
  });

  it("the merged-list skill records the six taps as decided", async () => {
    const skill = await readFile(new URL("skills/merged-list/SKILL.md", root), "utf8");
    assert.match(skill, /decided yes as of D36/);
    assert.doesNotMatch(skill, /Do not encode those as decided/);
  });
});
