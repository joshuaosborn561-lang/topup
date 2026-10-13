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
    const files = { kind: "file_url" as const, urls: ["https://example.invalid/a.csv", "https://example.invalid/b.csv"] };
    const table = { kind: "table" as const, table: "scratch.bcp_pool", where: "state = 'CO'" };
    assert.equal(sourceWords(files), "2 file(s) handed over by Grokbot");
    assert.equal(sourceWords(table), "table scratch.bcp_pool");
    assert.equal(titlesWords(files, "it_dm"), "it_dm");
    assert.equal(titlesWords(files, ""), "as the transcript says");
    assert.equal(filtersWords(table), "where state = 'CO'");
    assert.equal(filtersWords({ ...table, where: "true" }), "the whole table");
    assert.equal(replyRateText(10, 1, true), "too early to judge (1 interested in 10 sends)");
  });
});
