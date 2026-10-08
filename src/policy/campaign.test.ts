import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateCampaign, replyBarPasses } from "./campaign.js";
import { isRetiredCampaign, isSuspectFilter, marketCapFor, MIN_NET_NEW, spendAudience, loadAllowed } from "./index.js";

const base = { client_tag: "bcp", lane: "it_dm_airpods", status: "ACTIVE", sends: 4000, positives: 6 };

describe("D46 — one policy layer, one verdict per campaign", () => {
  it("the never-top-up list wins over everything", () => {
    assert.equal(evaluateCampaign({ ...base, campaign_id: 4085158 }).gate, "excluded");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 3122546 }).gate, "excluded");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 1, campaign_name: "SG Cayden Calls" }).gate, "excluded");
  });

  it("goliath is ignored, retired Parlay ids and lanes outside the Sept 29 range never qualify", () => {
    assert.equal(evaluateCampaign({ ...base, client_tag: "goliath", campaign_id: 7 }).gate, "ignored_client");
    assert.equal(evaluateCampaign({ ...base, client_tag: "parlay", campaign_id: 3847840 }).gate, "retired");
    assert.equal(evaluateCampaign({ ...base, client_tag: "parlay", campaign_id: 3929974 }).gate, "retired");
    assert.equal(evaluateCampaign({ ...base, client_tag: "parlay", campaign_id: 4049050 }).gate, "ok");
    assert.equal(isRetiredCampaign("parlay", 4000000), true);
    assert.equal(isRetiredCampaign("bcp", 4000000), false);
  });

  it("paused and dropped labels never start, and only ACTIVE campaigns are targets", () => {
    assert.equal(evaluateCampaign({ ...base, campaign_id: 2, campaign_name: "Insight OEM Channel Reps" }).gate, "paused");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 3, campaign_name: "Insight Google SADA" }).gate, "dropped");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 4, lane: "oem_channel_reps" }).gate, "paused");
    for (const status of ["COMPLETED", "DRAFTED", "PAUSED", "ARCHIVED"]) {
      assert.equal(evaluateCampaign({ ...base, campaign_id: 5, status }).gate, "not_active", status);
    }
    assert.equal(evaluateCampaign({ ...base, campaign_id: 5, status: null }).gate, "ok", "a blank mirror status is not a refusal");
  });

  it("a lane only targets its own client's campaigns", () => {
    const v = evaluateCampaign({ ...base, campaign_id: 6, smartlead_client_id: 10, campaign_client_id: 11 });
    assert.equal(v.gate, "foreign_client");
    assert.equal(evaluateCampaign({ ...base, campaign_id: 6, smartlead_client_id: 10, campaign_client_id: 10 }).gate, "ok");
  });

  it("the reply bar: 1 per 2,000, zero positives fails, too early fails, the owner override wins", () => {
    assert.equal(replyBarPasses({ sends: 120, positives: 0 }).ok, false, "zero positives never qualifies");
    assert.equal(replyBarPasses({ sends: 120, positives: 1 }).ok, true, "one reply under 2,000 sends is acceptable (D44)");
    assert.equal(replyBarPasses({ sends: 4000, positives: 1 }).ok, false, "0.5 per 2,000 is under the bar");
    assert.equal(replyBarPasses({ sends: 4000, positives: 2 }).ok, true);
    assert.equal(replyBarPasses({ sends: 9000, positives: 0, working_override: true }).ok, true);
    assert.equal(replyBarPasses({ sends: 9000, positives: 40, working_override: false }).ok, false);
    const v = evaluateCampaign({ ...base, campaign_id: 8, sends: 300, positives: 0 });
    assert.equal(v.gate, "under_reply_bar");
    assert.match(v.reason, /0 interested in 300 sends/);
    assert.equal(v.qualifies, false);
  });

  it("without sizing facts the verdict is ok with sizing pending; sized false is not_sized", () => {
    const v = evaluateCampaign({ ...base, campaign_id: 9 });
    assert.equal(v.gate, "ok");
    assert.equal(v.sizing_pending, true);
    assert.equal(v.reply_rate_per_2000, 3);
    assert.equal(evaluateCampaign({ ...base, campaign_id: 9, sized: false }).gate, "not_sized");
  });

  it("titles alone never size a pool", () => {
    assert.equal(evaluateCampaign({ ...base, campaign_id: 10, has_company_filter: false }).gate, "no_company_filter");
  });

  it("sizing rules in order: pilot, suspect filter, TAM source, cross-check, then the 1,000 minimum", () => {
    const sized = { ...base, campaign_id: 11, sized: true, tam_total: 5000, tam_left: 4200 };
    assert.equal(evaluateCampaign({ ...sized, pilot: { gate: "pilot_mismatch", failed: ["title"], rows_scored: 250 } }).gate, "pilot_mismatch");
    assert.equal(evaluateCampaign({ ...sized, tam_total: 1_080_000, tam_left: 1_080_000, rows_found_last_build: 1400 }).gate, "suspect_filter");
    assert.equal(evaluateCampaign({ ...sized, tam_check: "tam_source_missing" }).gate, "tam_source_missing");
    assert.equal(evaluateCampaign({ ...sized, tam_check: "tam_mismatch" }).gate, "tam_mismatch");
    assert.equal(evaluateCampaign({ ...sized, tam_check: "single_source" }).gate, "ok", "a missing second count is not a mismatch");
    assert.equal(evaluateCampaign({ ...sized, tam_left: MIN_NET_NEW - 1 }).gate, "tam_filled");
    assert.equal(evaluateCampaign({ ...sized, tam_left: MIN_NET_NEW }).gate, "ok");
    const ok = evaluateCampaign({ ...sized, tam_check: "ok", pilot: { gate: "ok", failed: [], rows_scored: 250 } });
    assert.equal(ok.qualifies, true);
    assert.equal(ok.sizing_pending, false);
  });

  it("the MSP market cap: above 40,000 or in the low hundreds is suspect", () => {
    const cap = marketCapFor("msp_owners", "getleads people search, managed service provider");
    assert.equal(cap, 40_000);
    assert.equal(isSuspectFilter(1_080_000, 1400, cap), true);
    assert.equal(isSuspectFilter(71, null, cap), true);
    assert.equal(isSuspectFilter(2400, 1362, cap), false);
    assert.equal(marketCapFor("it_dm", "getleads"), null);
  });

  it("spend: free proceeds, under $5 is Cayden, $5 or above is Josh, and over the $25 day is Josh too", () => {
    assert.equal(spendAudience(0), "proceed");
    assert.equal(spendAudience(499), "operator");
    assert.equal(spendAudience(500), "owner");
    assert.equal(spendAudience(8000), "owner", "the $80 EMCOR pull waits on Josh, it is not refused");
    assert.equal(spendAudience(300, 2300), "owner", "a small ask that crosses the daily cap is Josh's call");
  });

  it("nothing reaches Smartlead while loads are paused or before Josh approves", () => {
    assert.equal(loadAllowed({ loadsPaused: true, ownerApproved: true }).ok, false);
    assert.equal(loadAllowed({ loadsPaused: false, ownerApproved: false }).ok, false);
    assert.equal(loadAllowed({ loadsPaused: false, ownerApproved: true }).ok, true);
  });

  it("reasons carry counts and ids, never an address", () => {
    const facts = [
      { ...base, campaign_id: 12, sends: 0, positives: 0 },
      { ...base, campaign_id: 13, sized: true, tam_total: 500, tam_left: 300 },
      { ...base, campaign_id: 4085158 },
    ];
    for (const f of facts) assert.equal(evaluateCampaign(f).reason.includes("@"), false);
  });
});
