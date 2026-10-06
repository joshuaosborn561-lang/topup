import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { mapsSyncRows } from "../clients/mapsStats.js";
import { openRunBlocksLane } from "../mcp/queue.js";
import { aliasLanes, dedupeAliasLanes } from "../recipes/dedupe.js";
import { PETERSON_LANES, petersonLaneCaseSql, repairedClient, repairedLane, routingFromRegistry } from "../recipes/registry.js";
import { parseRecipe, type Recipe } from "../recipes/schema.js";
import { resumeEffect } from "../runs/resume.js";
import { mapsPermitAsk } from "../spend/audience.js";
import { worstCaseCents } from "../spend/prices.js";
import { sourceLabel } from "./ingest/index.js";
import { credentialGap, pricePlans, shareRows } from "./pull/index.js";
import { pullPlans, routeSize } from "./pull/route.js";
import { campaignIdFromSourceLabel } from "./route/index.js";
import { bandMismatchReason, partitionCheck } from "./size/index.js";

const base = {
  client_tag: "emcor",
  lane: "a_property_facilities",
  smartlead_client_id: 1,
  supabase_project: "azpapwtnrbzywlnxxecz",
  suppression: { response_based: true, same_offer_any_client: true },
  email_finding: { enabled: false },
  verify: { seg_split: true },
  normalize: {},
  runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
  working: { interested_per_2000_sends: 1, variant_min_sends: 300 },
  spend: { auto_cap_usd: 5 },
};

function linkedin(recipeId: string, lane: string, campaigns: number[], source: Record<string, unknown> = { kind: "getleads", params: { job_titles: ["Facilities Manager"], company_size: ["11 to 50", "51 to 200"], email_status: ["VALID"] } }): Recipe {
  return parseRecipe({
    ...base,
    recipe_id: recipeId,
    lane,
    source,
    segments: { slot: campaigns.map(String) },
    routing: campaigns.map((id) => ({
      when: { slot: String(id) },
      campaign_id: id,
      icp: { kind: "linkedin_native", persona: "property_facilities_dm" },
    })),
  });
}

describe("finish the open runs", () => {
  it("sizes and pulls each campaign on a lane instead of one TAM for two stacks", () => {
    const recipe = linkedin("emcor.a_property_facilities.v0", "a_property_facilities", [4036499, 4036504, 4037526, 4037540]);
    const sized = routeSize(recipe);
    assert.equal(sized.kind, "combine");
    if (sized.kind === "combine") {
      assert.deepEqual(
        sized.segments.map((seg) => seg.campaignIds[0]),
        [4036499, 4036504, 4037526, 4037540],
      );
    }
    const reason = sized.kind === "park" ? sized.reason : "";
    assert.doesNotMatch(reason, /one TAM for two stacks/);
    const planned = pullPlans(recipe);
    assert.equal(planned.kind, "run");
    if (planned.kind === "run") {
      assert.deepEqual(
        planned.plans.map((plan) => plan.campaignId),
        [4036499, 4036504, 4037526, 4037540],
      );
    }
    const shares = shareRows(planned.kind === "run" ? planned.plans : [], { plan_rows_4036499: 40, plan_rows_4036504: 10 }, 10000);
    assert.equal(shares.get("4036499:getleads:getleads"), 40);
    assert.equal(campaignIdFromSourceLabel(sourceLabel({ client_tag: "emcor", lane: "a_property_facilities", run_id: "0123456789abcdef" } as never, 4036499), [4036499, 4036504]), 4036499);
  });

  it("pulls each segment of one campaign instead of refusing a mixed recipe", () => {
    const recipe = parseRecipe({
      ...base,
      recipe_id: "peterson.c1_general_contractors.v0",
      client_tag: "peterson",
      lane: "c1_general_contractors",
      source: {
        kind: "mixed",
        note: "maps and permits",
        parts: [
          { label: "maps", icp_kind: "physical", source: { kind: "maps", params: { categories: ["general contractor", "church"] } } },
          { label: "permits", icp_kind: "physical", source: { kind: "permits", params: { permit_types: ["ROOFING", "NEW_CONSTRUCTION"], states: ["TX"] } } },
        ],
      },
      segments: { slot: ["3798227"] },
      routing: [{ when: { slot: "3798227" }, campaign_id: 3798227, icp: { kind: "physical", persona: "gc_owner_pm" } }],
    });
    const planned = pullPlans(recipe);
    assert.equal(planned.kind, "run");
    if (planned.kind === "run") {
      assert.equal(planned.plans.length, 4);
      assert.ok(planned.plans.every((plan) => plan.campaignId === 3798227));
      assert.deepEqual(
        [...new Set(planned.plans.map((plan) => plan.source))],
        ["maps", "permits"],
      );
    }
    const text = planned.kind === "park" ? planned.reason : planned.plans.map((plan) => plan.segment).join(" ");
    assert.doesNotMatch(text, /route each campaign separately/);
  });

  it("counts an unknown headcount band so the three buckets add up, and does not ask Josh", () => {
    const examples: Array<[number, number, number]> = [
      [54780, 68982, 176769],
      [13118, 12941, 41230],
      [69614, 115182, 305387],
      [54139, 62021, 190482],
    ];
    for (const [bands, others, all] of examples) {
      const partition = partitionCheck(bands, others, all, 0.01);
      assert.equal(partition.unknown, all - bands - others);
      assert.equal(bands + others + partition.unknown, all);
      assert.equal(partition.ok, true);
      assert.equal(bandMismatchReason(partition), null);
    }
    const overlap = partitionCheck(120, 50, 100, 0.01);
    assert.equal(overlap.ok, false);
    const reason = bandMismatchReason(overlap);
    assert.match(reason ?? "", /cannot be trusted/);
    assert.doesNotMatch(reason ?? "", /Josh/);
  });

  it("prices maps and permitstack through the spend card and names a missing credential", () => {
    assert.equal(mapsPermitAsk(0, 500), "proceed");
    assert.equal(mapsPermitAsk(499, 500), "operator");
    assert.equal(mapsPermitAsk(500, 500), "owner");
    assert.equal(worstCaseCents("maps", "sync", 5000), 500);
    assert.equal(worstCaseCents("permitstack", "metrics_monthly", 200000), 0);
    assert.equal(mapsSyncRows({ rows_synced: 2178 }), 2178);
    const plans = [
      { campaignId: 1, segment: "roofing", source: "maps" as const, filters: { kind: "maps" as const, params: { categories: ["roofing contractor"] } } },
    ];
    assert.equal(credentialGap(plans, null, null), "missing credentials for maps");
    const priced = pricePlans(plans, new Map([["1:maps:roofing", 2178]]));
    assert.equal(mapsPermitAsk(priced.worst, 500), "operator");
    assert.equal(credentialGap([{ ...plans[0]!, source: "permits" }], {} as never, null), "missing credentials for permitstack");
  });

  it("resume re-runs a parked step and alias lanes collapse to one recipe", () => {
    assert.equal(resumeEffect("resume", "parked"), "reset_parked");
    assert.equal(resumeEffect("resume", "gate"), "reset_parked");
    assert.equal(resumeEffect("resume_run", "parked"), "reset_parked");
    assert.equal(resumeEffect("resume", "stall"), "continue");
    assert.equal(resumeEffect("approve_spend", "spend_approval"), "continue");
    assert.equal(resumeEffect("topup_anyway", "not_working"), "topup_anyway");
    const owner = linkedin("powergryd.msp_owner.v0", "msp_owner", [4005218, 4005220, 4005229, 4005231]);
    const owners = linkedin("powergryd.msp_owners.v0", "msp_owners", [4005218, 4005220, 4005229, 4005231], { kind: "mixed", note: "empty", parts: [] });
    assert.equal(aliasLanes("msp_owner", "msp_owners"), true);
    const kept = dedupeAliasLanes([owner, owners]);
    assert.deepEqual(kept.map((recipe) => recipe.lane), ["msp_owner"]);
  });

  it("locks a lane only against its own open run and rebuilds the ICP from this client", () => {
    const open = [{ client_tag: "insight", lane: "broad", campaign_ids: [4049062, 3921850] }];
    assert.equal(openRunBlocksLane(open, "parlay", "it_dm"), false);
    assert.equal(openRunBlocksLane([{ client_tag: "parlay", lane: "adjacent_dm" }], "parlay", "it_dm"), false);
    assert.equal(openRunBlocksLane([{ client_tag: "parlay", lane: "it_dm" }], "parlay", "it_dm"), true);
    assert.equal(repairedLane(3798227, "schools", "schools"), "c1_general_contractors");
    assert.equal(repairedLane(3798230, "schools", "schools"), "c2_property_managers");
    assert.equal(repairedLane(3798231, "schools", "schools"), PETERSON_LANES[3798231]);
    assert.deepEqual(repairedClient({ client_tag: "peterson", smartlead_client_id: 1 }, { client_tag: "bcp", smartlead_client_id: 42 }), {
      client_tag: "bcp",
      smartlead_client_id: 42,
    });
    const { caseSql } = petersonLaneCaseSql();
    assert.match(caseSql, /when 3798227 then 'c1_general_contractors'/);
    const recipe = linkedin("techevo.saved.v0", "owners", [111, 222, 999]);
    const rebuilt = routingFromRegistry(
      { ...recipe, client_tag: "techevo", smartlead_client_id: 7 },
      [
        { campaign_id: 111, client_tag: "techevo", smartlead_client_id: 7, lane: "owners" },
        { campaign_id: 999, client_tag: "bcp", smartlead_client_id: 8, lane: "owners" },
        { campaign_id: 222, client_tag: "techevo", smartlead_client_id: 7, lane: "other" },
      ],
    );
    assert.deepEqual(rebuilt.routing.map((rule) => rule.campaign_id), [111]);
  });

  it("does not call a maps scrape or a permit row export", async () => {
    const maps = await readFile(new URL("./pull/maps.ts", import.meta.url), "utf8");
    const permits = await readFile(new URL("./pull/permits.ts", import.meta.url), "utf8");
    assert.doesNotMatch(maps, /["']run_leads["']|["']plan_leads["']/);
    assert.match(maps, /syncExisting/);
    assert.doesNotMatch(permits, /["']search_permits["']|["']export_permits["']|["']sync_permits["']/);
    assert.match(permits, /monthlyTotal/);
  });
});
