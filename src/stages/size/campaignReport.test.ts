import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCampaignReport,
  COMPANY_FILTER_REASON,
  formatCampaignReport,
  isPausedLabel,
  isSuspectFilter,
  marketCapFor,
  reportFieldsFilled,
  TAM_LEFT_FLOOR,
} from "./campaignReport.js";

const fields = {
  campaign_id: 4005218,
  campaign_name: "PowerGRYD MSP Owners Tix",
  found: 1362,
  to_add: 1362,
  source: "getleads people search, managed service provider",
  titles: "Owner, Founder, CEO",
  filters: "industries IT Services and IT Consulting; company size 11 to 50, 51 to 200; geography United States",
  tam_total: 2400,
  tam_left: 2100,
  sends: 4000,
  interested: 8,
  too_early: false,
  paused: false,
  rows_found: 1362,
  market_cap: 40_000,
  strategy: "Repeats powergryd_msp_owner_lane_20260922. Same MSP wording as that build.",
};

describe("per-campaign report", () => {
  it("fills every field for each target and contains no lead rows", () => {
    const [row] = buildCampaignReport([fields]);
    assert.ok(row);
    assert.equal(reportFieldsFilled(row), true);
    assert.equal(row.gate, "ok");
    assert.equal(row.tam_left, 2100);
    assert.match(row.reply_rate, /4\.0 per 2,000/);
    const text = JSON.stringify(buildCampaignReport([fields, { ...fields, campaign_id: 4005219, campaign_name: "PowerGRYD MSP Owners Tix SEG" }]));
    assert.equal(text.includes("@"), false);
    assert.equal(formatCampaignReport(buildCampaignReport([fields])).includes("@"), false);
  });

  it("a parked pilot is pilot_mismatch with found and tam null", () => {
    const parked = buildCampaignReport([
      {
        ...fields,
        found: null,
        tam_total: null,
        tam_left: null,
        to_add: 0,
        not_sized: true,
        pilot_failed: true,
      },
    ]);
    assert.equal(parked[0]?.gate, "pilot_mismatch");
    assert.equal(parked[0]?.found, null);
    assert.equal(parked[0]?.tam_total, null);
    assert.equal(parked[0]?.tam_left, null);
    assert.equal(reportFieldsFilled(parked[0]!), true);
    const unread = buildCampaignReport([{ ...fields, found: null, tam_total: null, tam_left: null, not_sized: true }]);
    assert.equal(unread[0]?.gate, "not_sized");
    assert.match(formatCampaignReport(unread), /found not sized/);
    assert.match(formatCampaignReport(unread), /gate not_sized/);
  });

  it("a missing AI Ark count is single_source and is not a park line", () => {
    const [row] = buildCampaignReport([
      {
        ...fields,
        tam_total: 1262,
        tam_left: 1219,
        found: 1262,
        tam_check: "single_source",
        getleads_count: 1262,
        ai_ark_count: null,
        pool_note: "Industry-only count 271. COO fallback pool 400.",
      },
    ]);
    assert.equal(row?.tam_check, "single_source");
    assert.equal(row?.ai_ark_count, null);
    const text = formatCampaignReport([row!]);
    assert.match(text, /tam_check single_source/);
    assert.match(text, /getleads 1262/);
    assert.match(text, /AI Ark count not available/);
    assert.match(text, /COO fallback pool 400/);
    assert.equal(text.includes("not wired"), false);
    assert.equal(text.includes("tam_mismatch"), false);
  });

  it("flags tam_filled under 1,000 left and does not treat too early as a pass", () => {
    const filled = buildCampaignReport([{ ...fields, tam_total: 800, tam_left: 700, found: 800, to_add: 700, market_cap: null }]);
    assert.equal(filled[0]?.gate, "tam_filled");
    const thinMsp = buildCampaignReport([{ ...fields, tam_total: 800, tam_left: 700, found: 800, to_add: 700 }]);
    assert.equal(thinMsp[0]?.gate, "suspect_filter");
    assert.ok(700 < TAM_LEFT_FLOOR);
    const early = buildCampaignReport([{ ...fields, sends: 120, interested: 1, too_early: true }]);
    assert.equal(early[0]?.gate, "under_reply_bar");
    assert.match(early[0]?.reply_rate ?? "", /too early to judge/);
  });

  it("parks a TAM that is 20× the build or above the MSP cap", () => {
    assert.equal(isSuspectFilter(1_080_000, 1400, marketCapFor("msp_owners", "managed service provider")), true);
    assert.equal(isSuspectFilter(2400, 1362, 40_000), false);
    const row = buildCampaignReport([{ ...fields, tam_total: 1_080_000, tam_left: 1_080_000, found: 1_080_000, rows_found: 1400 }]);
    assert.equal(row[0]?.gate, "suspect_filter");
  });

  it("keeps paused lanes paused and does not start them", () => {
    assert.equal(isPausedLabel("Insight OEM Channel Reps"), true);
    assert.equal(isPausedLabel("Insight Google SADA"), true);
    assert.equal(isPausedLabel("oem_channel_reps"), true);
    assert.equal(isPausedLabel("google_sada"), true);
    assert.equal(isPausedLabel("msp_owners"), false);
    const row = buildCampaignReport([{ ...fields, paused: true, campaign_name: "Insight OEM Channel Reps" }]);
    assert.equal(row[0]?.gate, "paused");
  });

  it("names an empty mixed source as a missing company filter", () => {
    assert.equal(COMPANY_FILTER_REASON, "recipe has no company filter");
  });
});
