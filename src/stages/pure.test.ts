import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandComplement } from "../clients/getleads.js";
import { SMARTLEAD_ALLOWED } from "../clients/smartlead.js";
import { parseRecipe } from "../recipes/schema.js";
import { importMatched, parseJobs } from "./import/index.js";
import { sourceLabel, titlePattern } from "./ingest/index.js";
import { QA_FIELD_COLUMN, scopeSql } from "./qa/index.js";
import { bandSegment, cellLabel, mailClassSegment, matchRule } from "./route/index.js";
import { classifyPuzzle } from "./puzzle/classify.js";
import { routePull, routeSize } from "./pull/route.js";
import { partitionCheck, rowsNeeded, sourcesAgree } from "./size/index.js";
import { sizeReport } from "./size/report.js";
import { recentClientSendSql, recycleDays } from "./suppress/recycle.js";
import { dedupeKeySql } from "./stage/index.js";

function campaignRecipe(
  base: Record<string, unknown>,
  icp: { kind: "linkedin_native" | "physical"; persona: string },
  source: Record<string, unknown>,
) {
  return parseRecipe({
    ...base,
    source,
    segments: { band: ["11_50"] },
    routing: [{ when: { band: "11_50" }, campaign_id: 1, icp }],
  });
}

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
      { when: { gift: "airpods", band: "11_50" }, campaign_id: 3929973, icp: { kind: "linkedin_native", persona: "it_dm" } },
      { when: { band: "11_50", mail_class: "OTHER" }, campaign_id: 3847839, icp: { kind: "linkedin_native", persona: "it_dm" } },
      { when: { band: "11_50", mail_class: "SEG" }, campaign_id: 3847846, icp: { kind: "linkedin_native", persona: "it_dm" } },
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

describe("D29 — puzzle pieces", () => {
  it("classifies name/domain/email gaps the skills name", () => {
    assert.equal(classifyPuzzle({ first_name: "Ada", last_name: "Lovelace", company_domain: "analyticengine.com", email: "ada@analyticengine.com" }), "ready");
    assert.equal(classifyPuzzle({ first_name: "Ada", last_name: "Lovelace", company_name: "Analytic Engine" }), "needs_domain");
    assert.equal(classifyPuzzle({ company_domain: "rooftop.com" }), "needs_person");
    assert.equal(classifyPuzzle({ first_name: "Ada", last_name: "Lovelace", company_domain: "analyticengine.com" }), "needs_email");
    assert.equal(classifyPuzzle({ company_name: "Nobody" }), "empty");
  });
});

describe("D29 — pull and size routing", () => {
  const base = {
    recipe_id: "parlay.it_dm.v3",
    client_tag: "parlay",
    lane: "it_dm",
    smartlead_client_id: 418274,
    supabase_project: "azpapwtnrbzywlnxxecz",
    suppression: { response_based: true, same_offer_any_client: true },
    email_finding: { enabled: false },
    verify: { seg_split: true },
    normalize: {},
    runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
    working: { interested_per_2000_sends: 1, variant_min_sends: 300 },
    spend: { auto_cap_usd: 5 },
  };

  it("LinkedIn-native + getleads runs; physical + getleads parks; maps/permits park until wired", () => {
    const linkedin = campaignRecipe(base, { kind: "linkedin_native", persona: "it_dm" }, { kind: "getleads", params: { job_titles: ["CIO"], company_size: ["11 to 50"], email_status: ["VALID"] } });
    assert.equal(routePull(linkedin).kind, "run");
    assert.equal(routeSize(linkedin).kind, "getleads");

    const rooftop = campaignRecipe(
      { ...base, recipe_id: "peterson.roof.v1", client_tag: "peterson", lane: "roof" },
      { kind: "physical", persona: "owner" },
      { kind: "getleads", params: { job_titles: ["Owner"], company_size: ["1 to 10"], email_status: ["VALID"] } },
    );
    assert.equal(routePull(rooftop).kind, "park");
    assert.match((routePull(rooftop) as { reason: string }).reason, /do not fall back/);
    assert.equal(routeSize(rooftop).kind, "park");

    const maps = campaignRecipe(
      { ...base, recipe_id: "peterson.roof.v1", client_tag: "peterson", lane: "roof" },
      { kind: "physical", persona: "owner" },
      { kind: "maps", params: { categories: ["roofing contractor"] } },
    );
    assert.equal(routePull(maps).kind, "park");
    assert.match((routePull(maps) as { reason: string }).reason, /not wired/);
  });

  it("D30 — mixed campaign ICPs in one run park; same persona unions bands", () => {
    const mixed = parseRecipe({
      ...base,
      source: { kind: "getleads", params: { job_titles: ["CIO"], company_size: ["11 to 50", "1 to 10"], email_status: ["VALID"] } },
      segments: { band: ["11_50", "1_10"] },
      routing: [
        { when: { band: "11_50" }, campaign_id: 1, icp: { kind: "linkedin_native", persona: "it_dm" } },
        { when: { band: "1_10" }, campaign_id: 2, icp: { kind: "physical", persona: "owner" } },
      ],
    });
    assert.equal(routeSize(mixed).kind, "park");
    assert.match((routeSize(mixed) as { reason: string }).reason, /mixed campaign ICPs/);
    assert.equal(routePull(mixed, [1]).kind, "run", "one campaign of the pair still pulls");

    const same = parseRecipe({
      ...base,
      source: { kind: "getleads", params: { job_titles: ["CIO"], company_size: ["11 to 50", "51 to 200"], email_status: ["VALID"] } },
      segments: { band: ["11_50", "51_200"] },
      routing: [
        { when: { band: "11_50" }, campaign_id: 1, icp: { kind: "linkedin_native", persona: "it_dm" } },
        { when: { band: "51_200" }, campaign_id: 2, icp: { kind: "linkedin_native", persona: "it_dm" } },
      ],
    });
    const sized = routeSize(same);
    assert.equal(sized.kind, "getleads");
    if (sized.kind === "getleads") assert.deepEqual(sized.source.params.company_size, ["11 to 50", "51 to 200"]);
  });

  it("the tam-sizing report is five lines in order", () => {
    const text = sizeReport({
      number: 16940,
      filter: "getleads count_contacts; bands 11 to 50",
      partition: { bands: 400, others: 600, all: 1000, diff: 0, ok: true },
      secondVendor: "AI Ark People Preview is not wired",
      agree: null,
      netNew: 12000,
      held: 4940,
      costUsd: "$0.00",
    });
    const lines = text.split("\n");
    assert.equal(lines.length, 5);
    assert.match(lines[0], /^1\. Number:/);
    assert.match(lines[1], /^2\. Partition:/);
    assert.match(lines[2], /^3\. Second vendor:/);
    assert.match(lines[3], /^4\. Net-new:/);
    assert.match(lines[4], /^5\. Cost of sizing:/);
  });
});

describe("D29 — recycle window", () => {
  it("defaults to 90 days and keys prior contact off a recent send, not lifetime leads", () => {
    assert.equal(recycleDays(undefined), 90);
    assert.equal(recycleDays(90), 90);
    const sql = recentClientSendSql("$10");
    assert.match(sql, /public\.sends/);
    assert.match(sql, /s\.sent/);
    assert.match(sql, /s\.sent_at/);
    assert.match(sql, /smartlead_client_id = \$6/);
    assert.doesNotMatch(sql, /leads_staging/);
  });
});
