import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GETLEADS_COUNT_KEYS } from "../clients/getleads.js";
import { GETLEADS_INDUSTRIES, mapGetleadsIndustry } from "../jobs/getleadsIndustries.js";
import { GETLEADS_STORED_KEYS } from "../jobs/filters.js";

/**
 * D74 — getleads count maps every stored key; stamps are this campaign.
 * Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D74 — getleads count maps; stamps are this campaign", () => {
  it("maps the LinkedIn comma industry and sends description and purged titles", async () => {
    const mapped = mapGetleadsIndustry("Transportation, Logistics, Supply Chain and Storage");
    assert.ok(mapped.ok);
    if (mapped.ok) {
      assert.equal(mapped.value, "Transportation; Logistics; Supply Chain and Storage");
      assert.ok(GETLEADS_INDUSTRIES.includes(mapped.value));
    }
    const countKeys = GETLEADS_COUNT_KEYS as readonly string[];
    assert.ok(countKeys.includes("company_description"));
    assert.ok(countKeys.includes("exclude_job_titles"));
    assert.ok(!countKeys.includes("max_per_company"), "D43/D74: the export cap is not a count filter");
    assert.ok(GETLEADS_STORED_KEYS.includes("purged_titles"));
    assert.ok(GETLEADS_STORED_KEYS.includes("company_description"));
    const filters = await readFile(new URL("src/jobs/filters.ts", root), "utf8");
    assert.match(filters, /unmapped getleads filter keys/, "D74: an unknown key fails. Ask Josh.");
    assert.doesNotMatch(filters, /!s\.includes\(", "\)/, "D74: a comma industry is mapped, not dropped");
  });

  it("campaign_record scopes stamps to this campaign and held subtracts the pool overlap", async () => {
    const record = await readFile(new URL("src/canon/record.ts", root), "utf8");
    assert.match(record, /smartlead_campaign_id/, "D74: leads_by_label / leads_by_leg are this campaign");
    assert.match(record, /this campaign only/, "D74: how_to_read says the stamps are this campaign");
    const tags = await readFile(new URL("src/builds/tags.ts", root), "utf8");
    assert.match(tags, /campaignId/, "D74: provenanceCounts takes the campaign");
    const held = await readFile(new URL("src/canon/held.ts", root), "utf8");
    assert.match(held, /net_new is the pool minus/, "D74: the note names the subtraction");
    assert.doesNotMatch(held, /was not subtracted/, "D74: the old client-total line is gone");
    assert.match(held, /public\.suppression/, "D74: held includes suppression on the sample");
    const count = await readFile(new URL("src/canon/count.ts", root), "utf8");
    assert.match(count, /outboundFilters/, "D74: filters_used is what count_contacts received");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D74\*\*/, "D74: fold into CANON. Ask Josh.");
    assert.match(canon, /unmapped or unknown key fails/, "D74: CANON names the fail-loud rule");
  });
});
