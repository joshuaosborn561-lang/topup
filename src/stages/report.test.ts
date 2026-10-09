import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { campaignReportFromCounts, filtersWords, formatCampaignReport, replyRateText, sourceWords, titlesWords } from "./report.js";

/** D53 — the report is counts and words; it carries no verdict and no lead. */
describe("per-campaign report (D53)", () => {
  const row = {
    campaign_id: 4005218,
    campaign_name: "PowerGRYD MSP Owners Tix",
    found: 1362,
    to_add: 1362,
    source: "getleads people search, managed service provider",
    titles: "Owner, Founder, CEO",
    filters: "industries IT Services and IT Consulting; company size 11 to 50",
    tam_total: 2400,
    tam_left: 2100,
    reply_rate: replyRateText(4000, 8),
    gate: "ok",
    strategy: "Repeats the receipt's legs.",
  };

  it("formats one line per campaign with no lead fields", () => {
    const text = formatCampaignReport([row]);
    assert.match(text, /#4005218 PowerGRYD MSP Owners Tix: found 1362/);
    assert.match(text, /4\.0 per 2,000 \(8 interested in 4000 sends\)/);
    assert.doesNotMatch(text, /@/);
  });

  it("reads a report back from step counts and ignores junk", () => {
    assert.deepEqual(campaignReportFromCounts({ campaign_report: [row, { nope: 1 }, null] }), [row]);
    assert.deepEqual(campaignReportFromCounts(null), []);
  });

  it("words a source, its titles and its filters", () => {
    const source = { kind: "getleads" as const, params: { job_titles: ["CIO"], company_size: ["11 to 50" as const], email_status: ["VALID" as const], industries: ["IT Services"] }, widening_candidates: [] };
    assert.equal(sourceWords(source), "getleads people search, IT Services");
    assert.equal(titlesWords(source, "it_dm"), "CIO");
    assert.equal(filtersWords(source), "industries IT Services; company size 11 to 50; email VALID");
    assert.equal(replyRateText(10, 1, true), "too early to judge (1 interested in 10 sends)");
  });
});
