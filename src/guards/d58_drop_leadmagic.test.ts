import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { jobRecipe } from "../jobs/recipe.js";
import {
  isLegacyEmailMaxTier,
  isLegacyPersonSource,
  mapEmailMaxTier,
  mapPersonSource,
  PEOPLE_DEFAULT_ORDER,
} from "../recipes/legacyLeadmagic.js";
import { EMAIL_TIERS } from "../recipes/schema.js";
import { PRICES, VENDORS, peopleWaterfallWorstCaseCents } from "../spend/prices.js";

/**
 * D58 — Josh dropped LeadMagic on 2026-10-08. leadtopup never calls it.
 * Old receipts still parse; replay maps the names and warns. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D58 — LeadMagic is dropped", () => {
  it("live recipes and the price table have no LeadMagic vendor", () => {
    assert.ok(!(EMAIL_TIERS as readonly string[]).includes("leadmagic"), "D58: a new recipe cannot store max_tier=leadmagic");
    assert.ok(!(VENDORS as readonly string[]).includes("leadmagic"), "D58: prices.ts dropped the leadmagic row");
    assert.ok(!("leadmagic" in PRICES), "D58: no leadmagic unit price");
    assert.ok(VENDORS.includes("aiark_people"), "D58: puzzle gates on the AI Ark people price");
    assert.ok(VENDORS.includes("prospeo_search"), "D58: puzzle gates on the Prospeo search price");
    assert.ok(peopleWaterfallWorstCaseCents(10) > 0, "D58: the people quote is paid");
  });

  it("replaying a stored leadmagic ceiling or person source maps and warns; the row is not rewritten", () => {
    const email = mapEmailMaxTier("leadmagic");
    assert.equal(email.tier, "aiark");
    assert.equal(email.legacy, true);
    assert.match(email.warning ?? "", /not rewritten/);
    const person = mapPersonSource("leadmagic_employee_finder");
    assert.equal(person.source, "people_waterfall");
    assert.deepEqual(person.order, PEOPLE_DEFAULT_ORDER);
    assert.match(person.warning ?? "", /not rewritten/);
    assert.ok(isLegacyEmailMaxTier("lm"));
    assert.ok(isLegacyPersonSource("leadmagic_employee"));
    const recipe = jobRecipe(
      {
        client_tag: "vasco",
        smartlead_client_id: 1,
        lane: "signal_warranty_admin_hiring",
        campaign_id: 1,
        source: "table",
        filters: { table: "client_vasco.dealers", where: "true" },
        max_rows: 100,
        email_max_tier: "leadmagic",
      },
      1,
    );
    assert.equal(recipe.email_finding.max_tier, "aiark", "D58: the job that replays the vasco receipt stops at aiark");
  });

  it("puzzle and find_emails never send a LeadMagic tier, and the people client does not skip_tiers", async () => {
    const puzzle = await readFile(new URL("src/stages/puzzle/index.ts", root), "utf8");
    assert.match(puzzle, /PEOPLE_DEFAULT_ORDER/, "D58: the people step names the live Find Named Person order");
    assert.doesNotMatch(puzzle, /skip_tiers|leadmagic/, "D58: puzzle does not pass skip_tiers or a LeadMagic name");
    const people = await readFile(new URL("src/clients/peopleWaterfall.ts", root), "utf8");
    assert.doesNotMatch(people, /skip_tiers|leadmagic/, "D58: the people client does not mention LeadMagic");
    const emails = await readFile(new URL("src/stages/find_emails/index.ts", root), "utf8");
    assert.match(emails, /liveEmailMaxTier/, "D58: find_emails maps a stored ceiling before the call");
    assert.doesNotMatch(emails, /leadmagic/, "D58: find_emails has no leadmagic vendor branch");
    const schema = await readFile(new URL("src/recipes/schema.ts", root), "utf8");
    assert.doesNotMatch(schema, /vendor === "leadmagic"/, "D58: puzzle no longer authorises a leadmagic vendor");
  });

  it("the vasco recipe SQL is review-only and never touches dl_status, sg_exclude, or skip_*", async () => {
    const sql = await readFile(new URL("docs/drop-leadmagic.sql", root), "utf8");
    assert.match(sql, /vasco/, "D58: the SQL names the live lane");
    assert.match(sql, /signal_warranty_admin_hiring/, "D58: the SQL names the live recipe");
    assert.match(sql, /aiark/, "D58: the SQL maps the ceiling to aiark");
    assert.match(sql, /Do NOT run/i, "D58: the SQL is not applied from this PR");
    const updates = [...sql.matchAll(/^\s*update\s+(\S+)/gim)].map((m) => m[1]);
    assert.deepEqual(updates, ["topup.lane_recipes"], "D58: the only write is the live lane recipe; never pull_receipts, never a lead table");
    assert.doesNotMatch(sql, /set\s+[\s\S]*\bdl_status\b/i, "D58: never touch dl_status — ask Josh");
    assert.doesNotMatch(sql, /set\s+[\s\S]*\bsg_exclude\b/i, "D58: never touch sg_exclude — ask Josh");
    assert.doesNotMatch(sql, /set\s+[\s\S]*\bskip_[a-z]+/i, "D58: never touch skip_* — ask Josh");
  });

  it("CANON names D58 and the skills no longer send work to LeadMagic", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /LeadMagic is dropped/, "D58: CANON.md says LeadMagic is dropped");
    assert.match(canon, /Never call LeadMagic \(D58\)/, "D58: CANON.md cites D58; the header names the newest decision");
    for (const f of [
      "skills/MCP_SERVERS.md",
      "skills/people-waterfall/SKILL.md",
      "skills/leadgen-mcp-routing/SKILL.md",
      "skills/first-pull-receipt/SKILL.md",
    ]) {
      const src = await readFile(new URL(f, root), "utf8");
      assert.match(src, /D58|dropped|legacy/i, `D58: ${f} must say LeadMagic is dropped or legacy, not a live vendor to call`);
    }
  });
});
