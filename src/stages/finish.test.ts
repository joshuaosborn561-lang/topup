import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { mapsSyncRows } from "../clients/mapsStats.js";
import { openRunBlocksLane } from "../mcp/queue.js";
import { aliasLanes, dedupeAliasLanes } from "../recipes/dedupe.js";
import { targetCampaignIds, withoutSkipped } from "../recipes/campaigns.js";
import { applyIcpSources } from "../recipes/icpSource.js";
import { PETERSON_LANES, petersonLaneCaseSql, repairedClient, repairedLane, routingFromRegistry } from "../recipes/registry.js";
import { parseRecipe, type Recipe } from "../recipes/schema.js";
import { resumeEffect } from "../runs/resume.js";
import { mapsPermitAsk } from "../spend/audience.js";
import { worstCaseCents } from "../spend/prices.js";
import { sourceLabel } from "./ingest/index.js";
import { credentialGap, pricePlans, shareRows } from "./pull/index.js";
import { pullPlans, routeSize } from "./pull/route.js";
import { campaignIdFromSourceLabel } from "./route/index.js";
import { bandMismatchReason, bandSizeDecision, outsideBandCount, partitionCheck, skippedSizeRoutes } from "./size/index.js";

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

    const nullBand = bandSizeDecision(70, 100, 0.01);
    assert.equal(nullBand.partition.others, 30);
    assert.equal(nullBand.partition.bands + nullBand.partition.others, nullBand.partition.all);
    assert.equal(nullBand.partition.ok, true);
    assert.equal(nullBand.warning, null);
    assert.equal(nullBand.total, 70);

    const live = bandSizeDecision(1_467_223, 2_551_200, 0.01);
    assert.equal(outsideBandCount(2_551_200, 1_467_223), 2_551_200 - 1_467_223);
    assert.equal(live.partition.others, 2_551_200 - 1_467_223);
    assert.equal(live.partition.bands + live.partition.others, live.partition.all);
    assert.equal(live.partition.ok, true);
    assert.equal(live.total, 1_467_223);

    const drift = bandSizeDecision(120, 100, 0.01);
    assert.equal(drift.partition.ok, false);
    assert.equal(drift.total, 120);
    assert.match(drift.warning ?? "", /cannot be trusted/);
  });

  it("sizes a campaign whose receipt names no lists when a file recipe cell does", () => {
    const empty = { kind: "mixed", note: "receipt did not name its lists", parts: [] };
    const receipt = { ...linkedin("parlay.it_dm_airpods.v0", "it_dm_airpods", [3929973], empty), client_tag: "parlay" };
    const file = { ...linkedin("parlay.it_dm.v3", "it_dm", [3929973]), client_tag: "parlay" };
    const applied = applyIcpSources(receipt, [file]);
    assert.equal(applied.used["3929973"], "cell");
    assert.deepEqual(applied.missing, []);
    assert.equal(routeSize(applied.recipe, [3929973]).kind, "getleads");
    assert.equal(pullPlans(applied.recipe, [3929973]).kind, "run");

    const laneOnly = applyIcpSources(
      { ...linkedin("emcor.owners.v0", "owners", [555], empty), client_tag: "emcor" },
      [{ ...linkedin("emcor.owners.v1", "owners", [111]), client_tag: "emcor" }],
    );
    assert.equal(laneOnly.used["555"], "lane");
    assert.equal(routeSize(laneOnly.recipe, [555]).kind, "getleads");

    const fromReceipt = applyIcpSources(linkedin("emcor.owners.v0", "owners", [555]), []);
    assert.equal(fromReceipt.used["555"], "receipt");

    const none = applyIcpSources({ ...linkedin("emcor.a.v0", "a_property_facilities", [1], empty), client_tag: "emcor" }, []);
    assert.deepEqual(none.missing, [1]);
    const parked = routeSize(none.recipe, [1]);
    assert.equal(parked.kind, "park");
    if (parked.kind === "park") assert.match(parked.reason, /No recipe cell, the receipt did not name its lists, and the lane has no ICP/);
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
    const trades = {
      ...linkedin("salesglider.trades.v0", "trades", [111, 333, 3890658, 4085158]),
      client_tag: "salesglider",
      smartlead_client_id: 7,
    };
    const kept = routingFromRegistry(trades, [
      { campaign_id: 111, campaign_name: "Trades", client_tag: "salesglider", smartlead_client_id: 7, lane: "trades", status: "ACTIVE" },
      { campaign_id: 333, campaign_name: "Paused", client_tag: "salesglider", smartlead_client_id: 7, lane: "trades", status: "PAUSED" },
      { campaign_id: 3890658, campaign_name: "Foreign", client_tag: "other", smartlead_client_id: 345263, lane: "trades", status: "ACTIVE" },
      { campaign_id: 4085158, campaign_name: "SG Gabe Calls", client_tag: "salesglider", smartlead_client_id: 7, lane: "trades", status: "ACTIVE" },
      { campaign_id: 777, campaign_name: "Not in the recipe", client_tag: "salesglider", smartlead_client_id: 7, lane: "trades", status: "ACTIVE" },
    ]);
    assert.deepEqual(kept.routing.map((rule) => rule.campaign_id), [111]);
    const targets = targetCampaignIds(kept, {
      campaign_id: null,
      counts_by_status: { target_111: 1, target_3890658: 1, target_4085158: 1, target_3122546: 1 },
    });
    assert.deepEqual(targets, [111]);
    const skipped = skippedSizeRoutes(kept, [111, 3890658]);
    assert.deepEqual(skipped.run, [111]);
    assert.match(skipped.skipped.join(" "), /#3890658/);
    const pullIds = withoutSkipped([111, 3890658], { skipped_3890658: 1, plan_rows_111: 10 });
    assert.deepEqual(pullIds, [111]);
    assert.equal(routeSize(kept, pullIds).kind, "getleads");
    assert.equal(pullPlans(kept, pullIds).kind, "run");
    const cayden = routingFromRegistry(
      { ...linkedin("salesglider.calls.v0", "calls", [42]), client_tag: "salesglider", smartlead_client_id: 7 },
      [{ campaign_id: 42, campaign_name: "SG Cayden Calls", client_tag: "salesglider", smartlead_client_id: 7, lane: "calls", status: "ACTIVE" }],
    );
    assert.deepEqual(cayden.routing.map((rule) => rule.campaign_id), []);
    const nurture = routingFromRegistry({ ...linkedin("salesglider.nurture.v0", "nurture", [3122546, 111]), client_tag: "salesglider", smartlead_client_id: 7 }, []);
    assert.deepEqual(nurture.routing.map((rule) => rule.campaign_id), [111]);
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
