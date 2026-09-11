import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandComplement } from "../clients/getleads.js";
import { SMARTLEAD_ALLOWED } from "../clients/smartlead.js";
import { parseRecipe } from "../recipes/schema.js";
import { importMatched, parseJobs } from "./import/index.js";
import { sourceLabel, titlePattern } from "./ingest/index.js";
import { QA_FIELD_COLUMN, scopeSql } from "./qa/index.js";
import { bandSegment, cellLabel, mailClassSegment, matchRule } from "./route/index.js";
import { partitionCheck, rowsNeeded, sourcesAgree } from "./size/index.js";
import { dedupeKeySql } from "./stage/index.js";

/** The pure halves of steps 2–11. Vendor calls are never made here; the stages that make them are exercised against fakes. */
describe("step 2 — size (skill tam-sizing)", () => {
  it("partition check: bands + other bands == no band filter, within tolerance", () => {
    assert.equal(partitionCheck(400, 600, 1000, 0.01).ok, true);
    assert.equal(partitionCheck(400, 600, 1012, 0.01).ok, false, "12 off on 1000 is over 1%");
    assert.equal(partitionCheck(400, 600, 1009, 0.01).ok, true, "9 off on 1000 is within ceil(1%)");
    assert.equal(partitionCheck(0, 0, 0, 0.01).ok, true);
    assert.equal(partitionCheck(5, 0, 0, 0.01).ok, false);
  });

  it("two sources agree within a quarter of the larger", () => {
    assert.equal(sourcesAgree(1000, 800), true);
    assert.equal(sourcesAgree(1000, 700), false);
    assert.equal(sourcesAgree(0, 0), true);
  });

  it("rows needed reaches target days of runway from the mirror's sends; null when the mirror has no sends", () => {
    // 700 sends in 7 days = 100/day; 30 days needs 3000; 500 untouched → 2500
    assert.equal(rowsNeeded([{ untouched: 500, sends_window: 700 }], 30, 7), 2500);
    assert.equal(rowsNeeded([{ untouched: 5000, sends_window: 700 }], 30, 7), 0);
    assert.equal(rowsNeeded([{ untouched: 500, sends_window: 0 }], 30, 7), null);
  });

  it("the other-bands complement is every getleads band label not in the recipe", () => {
    assert.deepEqual(bandComplement(["11 to 50", "51 to 200"]), ["1 to 10", "201 to 500", "501 to 1000", "1001 to 5000", "5001 to 10000", "10001+"]);
  });
});

describe("step 4 — ingest", () => {
  it("source_label names the lane and the run; the title audit matches the recipe's titles as phrases", () => {
    const run = { client_tag: "parlay", lane: "it_dm", run_id: "0123456789abcdef-0000" } as never;
    assert.equal(sourceLabel(run), "topup_parlay_it_dm_01234567");
    const re = new RegExp(titlePattern(["IT Director", "CIO"]), "i");
    assert.ok(re.test("Senior IT Director"));
    assert.ok(re.test("CIO"));
    assert.ok(!re.test("Marketing Director"));
    assert.ok(!re.test("Sociology Professor"), "the phrase must be a whole word, not a substring");
  });
});

describe("step 8 — QA rules as data", () => {
  it("scope: null or the client is every row; gift:<tier> is the normalizer's tier; another client is not this lane", () => {
    assert.deepEqual(scopeSql(null, "parlay"), { sql: "true", params: [] });
    assert.deepEqual(scopeSql("parlay", "parlay"), { sql: "true", params: [] });
    const gift = scopeSql("gift:team", "parlay")!;
    assert.match(gift.sql, /gift_tier/);
    assert.deepEqual(gift.params, ["team"]);
    assert.equal(scopeSql("pe", "parlay"), null);
  });

  it("the copy says job_title; the lane table says title", () => {
    assert.equal(QA_FIELD_COLUMN.job_title, "title");
    assert.equal(QA_FIELD_COLUMN.title, "title");
  });
});

describe("step 9 — route to campaign", () => {
  const recipe = parseRecipe({
    recipe_id: "parlay.it_dm.v3",
    client_tag: "parlay",
    lane: "it_dm",
    smartlead_client_id: 418274,
    supabase_project: "azpapwtnrbzywlnxxecz",
    source: { kind: "getleads", params: { job_titles: ["CIO"], company_size: ["11 to 50", "51 to 200"], email_status: ["VALID"] } },
    suppression: { response_based: true, same_offer_any_client: true },
    email_finding: { enabled: false },
    verify: { seg_split: true },
    normalize: {},
    segments: { band: ["11_50", "51_200"], mail_class: ["SEG", "OTHER"], gift: ["team", "airpods"] },
    routing: [
      { when: { gift: "airpods", band: "11_50" }, campaign_id: 3929973 },
      { when: { band: "11_50", mail_class: "OTHER" }, campaign_id: 3847839 },
      { when: { band: "11_50", mail_class: "SEG" }, campaign_id: 3847846 },
    ],
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 300 },
    spend: { auto_cap_usd: 5 },
  });

  it("band labels become segment names; mail class is SEG or OTHER", () => {
    assert.equal(bandSegment("11 to 50"), "11_50");
    assert.equal(bandSegment("201 to 500"), "201_500");
    assert.equal(bandSegment("10001+"), "10001_plus");
    assert.equal(bandSegment(null), null);
    assert.equal(mailClassSegment("seg"), "SEG");
    assert.equal(mailClassSegment("direct"), "OTHER");
    assert.equal(mailClassSegment(null), "OTHER");
  });

  it("the first rule whose every `when` matches wins; no match is pending_campaign", () => {
    assert.equal(matchRule({ band: "11_50", mail_class: "SEG", gift: "airpods" }, recipe.routing)?.campaign_id, 3929973, "airpods rule is first");
    assert.equal(matchRule({ band: "11_50", mail_class: "SEG", gift: "team" }, recipe.routing)?.campaign_id, 3847846);
    assert.equal(matchRule({ band: "11_50", mail_class: "OTHER", gift: "team" }, recipe.routing)?.campaign_id, 3847839);
    assert.equal(matchRule({ band: "51_200", mail_class: "SEG", gift: "team" }, recipe.routing), null);
    assert.equal(cellLabel({ band: "51_200", mail_class: "SEG", gift: null }, ["band", "mail_class", "gift"]), "band=51_200 · mail_class=SEG · gift=?");
  });
});

describe("step 10 — stage", () => {
  it("the dedupe key is the skill's: md5(campaign_id || '|' || lower(email))", () => {
    assert.equal(dedupeKeySql("t.routed_campaign_id", "t.email"), "md5(t.routed_campaign_id::text || '|' || lower(t.email))");
  });
});

describe("step 11 — import", () => {
  it("the only success test is imported equals submitted", () => {
    const s = { status: "completed", total_leads: 100, imported_count: 100, duplicate_count: 0, invalid_count: 0, error_message: null };
    assert.equal(importMatched(100, s), true);
    assert.equal(importMatched(100, { ...s, imported_count: 98, duplicate_count: 2 }), false, "duplicates Smartlead already had are a mismatch to report, not to wave through");
    assert.equal(importMatched(100, { ...s, imported_count: null }), false);
  });

  it("one Smartlead job per campaign survives a restart on run_steps.vendor_job_id", () => {
    assert.deepEqual(parseJobs(JSON.stringify({ 3847839: "run-a", 3847846: "run-b" })), { 3847839: "run-a", 3847846: "run-b" });
    assert.deepEqual(parseJobs(null), {});
    assert.deepEqual(parseJobs("legacy-single-id"), {});
  });

  it("the Smartlead client can reach exactly five read-or-import tools (D6)", () => {
    assert.deepEqual([...SMARTLEAD_ALLOWED], ["start_lead_import", "get_lead_import_status", "get_sequences", "get_campaign", "list_campaign_mailboxes"]);
  });
});
