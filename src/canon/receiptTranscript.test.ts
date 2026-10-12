import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractFiltersFromSource,
  extractOfficialBands,
  extractOfficialIndustries,
  namesForBuckets,
  placeIndustries,
  planReceiptCorrection,
  planReceiptTranscript,
} from "./receiptTranscript.js";

/** D96 — transcript / narrative is the source of truth. Generic fixtures only. Ask Josh or Cayden. */

describe("D96 — extract official names from a build source", () => {
  it("picks official industries and does not take a short name out of a longer one", () => {
    const found = extractOfficialIndustries("Repeat Hospitals and Health Care plus Medical Practices. Also Hospitals.");
    assert.ok(found.includes("Hospitals and Health Care"));
    assert.ok(found.includes("Medical Practices"));
    assert.ok(found.includes("Hospitals"));
    const onlyLong = extractOfficialIndustries("Only Hospitals and Health Care this time.");
    assert.deepEqual(onlyLong, ["Hospitals and Health Care"]);
  });

  it("maps a LinkedIn comma industry and reads size bands including and-up", () => {
    const industries = extractOfficialIndustries("Transportation, Logistics, Supply Chain and Storage and Warehousing and Storage");
    assert.ok(industries.includes("Transportation; Logistics; Supply Chain and Storage"));
    assert.ok(industries.includes("Warehousing and Storage"));
    const { bands, over_1k } = extractOfficialBands("sizes 1-10, 11 to 50, 51 to 200, 201 to 500 and up");
    assert.ok(bands.includes("1 to 10"));
    assert.ok(bands.includes("11 to 50"));
    assert.ok(bands.includes("201 to 500"));
    assert.ok(bands.includes("1001 to 5000"));
    assert.equal(over_1k, true);
  });

  it("reads an explicit title list as the include set and a purge list separately", () => {
    const text = "personas: Partner, Investor, CEO, Founder, COO, Small Business Owner\npurged_titles: Associate, Analyst";
    const got = extractFiltersFromSource(text, ["Managing Partner", "Partner"]);
    assert.equal(got.explicit_titles, true);
    assert.deepEqual(got.job_titles, ["Partner", "Investor", "CEO", "Founder", "COO", "Small Business Owner"]);
    assert.equal(got.explicit_purge, true);
    assert.deepEqual(got.purged_titles, ["Associate", "Analyst"]);
  });

  it("adds a named C-level and Director of phrase when the list is not explicit", () => {
    const got = extractFiltersFromSource("IT titles also mention CTO and Director of IT and Security.", ["CIO", "IT Director"]);
    assert.equal(got.explicit_titles, false);
    assert.ok(got.job_titles.includes("CIO"));
    assert.ok(got.job_titles.includes("CTO"));
    assert.ok(got.job_titles.includes("Director of IT and Security"));
  });
});

describe("D96 — place industries on stored buckets", () => {
  it("puts a new industry inside a bucket's parentheses on that bucket", () => {
    const { buckets, unplaced } = placeIndustries(
      ["Hospitals", "Warehousing and Storage", "Transportation; Logistics; Supply Chain and Storage"],
      { healthcare: ["Hospitals and Health Care"], logistics: ["Truck Transportation"] },
      "industries Healthcare (Hospitals and Health Care, Medical Practices, Hospitals), Logistics (Transportation, Logistics, Supply Chain and Storage, Warehousing and Storage)",
    );
    assert.ok(buckets.healthcare!.includes("Hospitals"));
    assert.ok(buckets.logistics!.includes("Warehousing and Storage"));
    assert.ok(buckets.logistics!.includes("Transportation; Logistics; Supply Chain and Storage"));
    assert.deepEqual(unplaced, []);
  });

  it("puts a new industry on the bucket whose key or campaign name sits next to it", () => {
    const { buckets, unplaced } = placeIndustries(
      ["Hospitals", "Warehousing and Storage"],
      { alpha: ["Hospitals and Health Care"], omega: ["Truck Transportation"] },
      "Alpha also includes Hospitals. Omega adds Warehousing and Storage.",
      { alpha: "North Alpha", omega: "South Omega" },
    );
    assert.ok(buckets.alpha!.includes("Hospitals"));
    assert.ok(buckets.omega!.includes("Warehousing and Storage"));
    assert.deepEqual(unplaced, []);
  });

  it("maps a campaign id name onto a bucket word so the industry can sit next to it", () => {
    const names = namesForBuckets(["alpha"], { "8": "North Alpha" });
    assert.equal(names.alpha, "North Alpha");
    const { buckets, unplaced } = placeIndustries(
      ["Hospitals"],
      { alpha: ["Hospitals and Health Care"] },
      "North Alpha also includes Hospitals.",
      names,
    );
    assert.ok(buckets.alpha!.includes("Hospitals"));
    assert.deepEqual(unplaced, []);
  });

  it("leaves an industry unplaced when no bucket key sits next to it", () => {
    const { unplaced } = placeIndustries(
      ["Hospitals"],
      { alpha: ["Medical Practices"], omega: ["Truck Transportation"] },
      "Hospitals showed up with no bucket nearby.",
    );
    assert.deepEqual(unplaced, ["Hospitals"]);
  });
});

describe("D96 — plan a correction", () => {
  it("replaces a thinner backfill title set when the narrative lists personas", () => {
    const planned = planReceiptCorrection(
      {
        receipt_id: "11111111-1111-1111-1111-111111111111",
        client_tag: "acme",
        lane: "lane_a",
        campaign_ids: [7],
        company_filters: {
          job_titles: ["Partner", "Managing Partner"],
          purged_titles: ["Associate"],
        },
        written_by: "claude_backfill",
      },
      {
        id: 1,
        narrative: "personas: Partner, Investor, CEO, Founder, COO\npurged_titles: Associate, Analyst",
        campaign_ids: [7],
        receipt_ids: ["11111111-1111-1111-1111-111111111111"],
      },
    );
    assert.ok(!("skip" in planned));
    if ("skip" in planned) return;
    const titles = planned.patches.find((p) => p.key === "job_titles");
    assert.equal(titles?.reason, "disagrees");
    assert.deepEqual(titles?.after, ["Partner", "Investor", "CEO", "Founder", "COO"]);
  });

  it("does not copy a for-the-other-lane title onto a receipt", () => {
    const planned = planReceiptCorrection(
      {
        receipt_id: "44444444-4444-4444-4444-444444444444",
        client_tag: "acme",
        lane: "lane_a",
        campaign_ids: [10],
        company_filters: { job_titles: ["Partner", "Managing Partner"] },
        written_by: "claude_backfill",
      },
      {
        id: 3,
        narrative:
          "personas Partner, Investor, CEO, Founder, COO, Small Business Owner, and for the lane_b lane CIO, CTO, Director of IT and Security. lane_a keeps operating partner titles.",
        campaign_ids: [10],
        receipt_ids: null,
        lanes: ["lane_a", "lane_b"],
      },
    );
    assert.ok(!("skip" in planned));
    if ("skip" in planned) return;
    const titles = planned.patches.find((p) => p.key === "job_titles");
    assert.ok(titles);
    const after = titles?.after as string[];
    assert.ok(after.includes("CEO"));
    assert.ok(after.includes("Investor"));
    assert.ok(after.includes("Small Business Owner"));
    assert.ok(!after.includes("CTO"));
    assert.ok(!after.includes("Director of IT and Security"));
  });

  it("adds missing industries, bands and a CTO without inventing a client list", () => {
    const planned = planReceiptCorrection(
      {
        receipt_id: "22222222-2222-2222-2222-222222222222",
        client_tag: "acme",
        lane: "lane_b",
        campaign_ids: [8],
        company_filters: {
          job_titles: ["CIO", "IT Director"],
          industries_by_campaign: {
            alpha: ["Hospitals and Health Care", "Medical Practices"],
            omega: ["Transportation; Logistics; Supply Chain and Storage", "Truck Transportation"],
          },
          company_size: ["51 to 200", "201 to 500", "501 to 1000"],
        },
        written_by: "claude_backfill",
      },
      {
        id: 2,
        narrative:
          "Alpha (North Alpha) also includes Hospitals. Omega (South Omega) adds Warehousing and Storage and Freight and Package Transportation. Sizes 1 to 10, 11 to 50, 51 to 200, 201 to 500 and up. Titles also mention CTO and Director of IT and Security.",
        campaign_ids: [8],
        receipt_ids: null,
      },
      { alpha: "North Alpha", omega: "South Omega" },
    );
    assert.ok(!("skip" in planned));
    if ("skip" in planned) return;
    const titles = planned.patches.find((p) => p.key === "job_titles");
    assert.equal(titles?.reason, "thinner");
    assert.ok((titles?.after as string[]).includes("CTO"));
    const industries = planned.patches.find((p) => p.key === "industries_by_campaign");
    assert.ok(((industries?.after as Record<string, string[]>).alpha ?? []).includes("Hospitals"));
    assert.ok(((industries?.after as Record<string, string[]>).omega ?? []).includes("Warehousing and Storage"));
    const size = planned.patches.find((p) => p.key === "company_size");
    assert.ok((size?.after as string[]).includes("1 to 10"));
    assert.ok((size?.after as string[]).includes("1001 to 5000"));
    assert.equal(planned.patches.find((p) => p.key === "over_1k_campaign"), undefined);
  });

  it("skips when there is no build and scans many receipts", () => {
    const none = planReceiptCorrection(
      {
        receipt_id: "33333333-3333-3333-3333-333333333333",
        client_tag: "acme",
        lane: "lane_a",
        campaign_ids: [9],
        company_filters: { job_titles: ["Owner"] },
        written_by: "claude_backfill",
      },
      null,
    );
    assert.ok("skip" in none);
    const plan = planReceiptTranscript(
      [
        {
          receipt_id: "33333333-3333-3333-3333-333333333333",
          client_tag: "acme",
          lane: "lane_a",
          campaign_ids: [9],
          company_filters: { job_titles: ["Owner"] },
          written_by: null,
        },
      ],
      [],
    );
    assert.equal(plan.receipts_scanned, 1);
    assert.equal(plan.corrections.length, 0);
    assert.equal(plan.skipped[0]?.reason, "no matching list_build_records row");
  });
});
