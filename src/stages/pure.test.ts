import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandComplement } from "../clients/getleads.js";
import { SMARTLEAD_ALLOWED } from "../clients/smartlead.js";
import { parseRecipe } from "../recipes/schema.js";
import { importMatched, parseJobs } from "./import/index.js";
import { sourceLabel, titlePattern } from "./ingest/index.js";
import { QA_FIELD_COLUMN, scopeSql } from "./qa/index.js";
import { bandSegment, cellLabel, excludedInboxesOf, mailClassSegment, matchRule } from "./route/index.js";
import { classifyPuzzle } from "./puzzle/classify.js";
import { pullPlans, routePull, routeSize } from "./pull/route.js";
import {
  classifySeats,
  clientPriorContactSql,
  expiredEligibleSql,
  hardBounceSql,
  otherPod,
  positiveReplySql,
  recycleDays,
  recycleRouteOk,
} from "./suppress/recycle.js";
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

/** The pure halves of steps 3–11. Vendor calls are never made here; the stages that make them are exercised against fakes. */
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

  it("LinkedIn-native + getleads runs; physical + getleads parks; maps and permits pull", () => {
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
    assert.equal(routePull(maps).kind, "run");
    assert.equal(routeSize(maps).kind, "maps");
  });

  it("D30 — size counts each segment list; a physical campaign is named; each campaign keeps its own bands", () => {
    const mixed = parseRecipe({
      ...base,
      source: { kind: "getleads", params: { job_titles: ["CIO"], company_size: ["11 to 50", "1 to 10"], email_status: ["VALID"] } },
      segments: { band: ["11_50", "1_10"] },
      routing: [
        { when: { band: "11_50" }, campaign_id: 1, icp: { kind: "linkedin_native", persona: "it_dm" } },
        { when: { band: "1_10" }, campaign_id: 2, icp: { kind: "physical", persona: "owner" } },
      ],
    });
    const sized = routeSize(mixed);
    assert.equal(sized.kind, "combine");
    if (sized.kind === "combine") {
      assert.equal(sized.segments.length, 2);
      assert.equal(sized.segments[0]?.route.kind, "getleads");
      assert.equal(sized.segments[1]?.route.kind, "park");
    }
    const mixedPull = routePull(mixed);
    assert.equal(mixedPull.kind, "park");
    assert.match((mixedPull as { reason: string }).reason, /#2/);
    assert.doesNotMatch((mixedPull as { reason: string }).reason, /route each campaign separately/);
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
    const separate = routeSize(same);
    assert.equal(separate.kind, "combine");
    if (separate.kind === "combine") {
      assert.equal(separate.segments.length, 2);
      assert.deepEqual(separate.segments.map((seg) => seg.campaignIds), [[1], [2]]);
    }
  });

  it("a maps_and_permits source is one list per category and permit type", () => {
    const recipe = parseRecipe({
      ...base,
      recipe_id: "peterson.c1_general_contractors.v0",
      client_tag: "peterson",
      lane: "c1_general_contractors",
      source: {
        kind: "mixed",
        note: "maps and permits",
        parts: [
          {
            label: "maps",
            icp_kind: "physical",
            source: { kind: "maps", params: { categories: ["general contractor", "commercial construction"] } },
          },
          { label: "permits", icp_kind: "physical", source: { kind: "permits", params: { permit_types: ["ROOFING"] } } },
        ],
      },
      segments: { slot: ["3798227"] },
      routing: [{ when: { slot: "3798227" }, campaign_id: 3798227, icp: { kind: "physical", persona: "gc_owner_pm" } }],
    });
    const sized = routeSize(recipe);
    assert.equal(sized.kind, "combine");
    if (sized.kind === "combine") {
      assert.deepEqual(
        sized.segments.map((s) => s.label),
        ["general contractor", "commercial construction", "ROOFING"],
      );
      assert.deepEqual(
        sized.segments.map((s) => s.route.kind),
        ["maps", "maps", "permits"],
      );
    }
    const pulled = pullPlans(recipe);
    assert.equal(pulled.kind, "run");
    if (pulled.kind === "run") {
      assert.deepEqual(
        pulled.plans.map((plan) => plan.source),
        ["maps", "maps", "permits"],
      );
      assert.ok(pulled.plans.every((plan) => plan.campaignId === 3798227));
    }
  });
});

describe("D63 — prior contact is a 6-month send window, this client only", () => {
  it("recycle defaults to 180 days (6 months)", () => {
    assert.equal(recycleDays(undefined), 180);
    assert.equal(recycleDays(null), 180);
    assert.equal(recycleDays(0), 180);
    assert.equal(recycleDays(60), 60);
  });

  it("client_prior_contact is a send by this client inside the window", () => {
    const sql = clientPriorContactSql(false);
    assert.match(sql, /public\.sends/);
    assert.match(sql, /smartlead_client_id = \$6/);
    assert.match(sql, /interval '6 months'/);
    assert.doesNotMatch(sql, /leads_staging/);
  });

  it("live-campaign exclusion SQL is used when the flag is on", () => {
    const sql = clientPriorContactSql(true);
    assert.match(sql, /leads_staging/);
    assert.match(sql, /STOPPED/);
    assert.match(sql, /COMPLETED/);
  });
});

describe("D63 — positives expire after 6 months, this client only", () => {
  it("positive SQL is dated against replied_at and scoped to this client", () => {
    const sql = positiveReplySql();
    assert.match(sql, /replied_at/);
    assert.match(sql, /positive_reply/);
    assert.match(sql, /interval '6 months'/);
    assert.match(sql, /smartlead_client_id = \$6/);
    assert.match(sql, /not exists/);
    assert.doesNotMatch(sql, /confirmed_empty/);
  });
});

describe("D63 — hard bounce forever; POD route; expired-eligible", () => {
  it("hard bounce SQL has no recycle window", () => {
    const sql = hardBounceSql();
    assert.match(sql, /s\.bounced/);
    assert.match(sql, /smartlead_client_id = \$6/);
    assert.doesNotMatch(sql, /interval /);
  });

  it("expired-eligible is an old send on this client that is not a hard bounce", () => {
    const sql = expiredEligibleSql();
    assert.match(sql, /sent_at < now\(\) - interval '6 months'/);
    assert.match(sql, /smartlead_client_id = \$6/);
  });

  it("recycleRouteOk keys named seats on the other POD and holds generics", () => {
    assert.equal(otherPod("A"), "B");
    assert.equal(recycleRouteOk({ excluded_inboxes: [], excluded_pods: [], excluded_generic_inboxes: [] }, null), true);
    assert.equal(recycleRouteOk({ excluded_inboxes: ["a@x.com"], excluded_pods: ["A"], excluded_generic_inboxes: [] }, "B"), true);
    assert.equal(recycleRouteOk({ excluded_inboxes: ["a@x.com"], excluded_pods: ["A"], excluded_generic_inboxes: [] }, "A"), false);
    assert.equal(recycleRouteOk({ excluded_inboxes: ["g@x.com"], excluded_pods: [], excluded_generic_inboxes: ["g@x.com"] }, "B"), false);
    const seats = new Map([["a@x.com", { kind: "named" as const, pod: "A" as const }]]);
    assert.deepEqual(classifySeats(["a@x.com"], seats).excluded_pods, ["A"]);
  });

  it("excludedInboxesOf reads the qa_flags list", () => {
    assert.deepEqual(excludedInboxesOf({ excluded_inboxes: ["a@x.com"] }), ["a@x.com"]);
    assert.deepEqual(excludedInboxesOf(null), []);
  });
});
