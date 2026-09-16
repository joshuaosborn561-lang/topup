import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandFromHeadcount, bandFromUnknownSize, inferBands, normalizeDomain } from "./bands.js";
import { BACKFILL_PAID_CAP_CENTS, canAffordBackfill } from "./elsewhereSize.js";
import { backfillCompanySizes, classifyDomainBand } from "./backfillSize.js";

describe("D38 company_size backfill", () => {
  it("maps raw headcounts and range labels onto getleads bands", () => {
    assert.equal(bandFromHeadcount(8), "1 to 10");
    assert.equal(bandFromHeadcount(51), "51 to 200");
    assert.equal(bandFromHeadcount(12000), "10001+");
    assert.equal(bandFromUnknownSize("51 to 200"), "51 to 200");
    assert.equal(bandFromUnknownSize("201-500"), "201 to 500");
    assert.equal(bandFromUnknownSize("10001+"), "10001+");
    assert.deepEqual(inferBands([{ value: "11-50 employees", n: 4 }]), ["11 to 50"]);
  });

  it("skips free-mail domains", () => {
    assert.equal(normalizeDomain("gmail.com"), null);
    assert.equal(normalizeDomain("https://www.acme.io"), "acme.io");
  });

  it("classifies a domain from getleads band counts", async () => {
    const band = await classifyDomainBand(async (f) => {
      const sizes = f.company_size as string[];
      return { total_matching: sizes?.includes("51 to 200") && f.domains ? 12 : 0 };
    }, "acme.io");
    assert.equal(band, "51 to 200");
  });

  it("the $5 cap is for the whole backfill, not per lead", () => {
    assert.equal(BACKFILL_PAID_CAP_CENTS, 500);
    assert.equal(canAffordBackfill(0, 500), true);
    assert.equal(canAffordBackfill(495, 5), true);
    assert.equal(canAffordBackfill(496, 5), false);
    assert.equal(canAffordBackfill(500, 1), false);
  });

  it("uses getleads first, free elsewhere next, then paid leftovers until $5 is gone", async () => {
    const remembered: string[] = [];
    const applied: string[] = [];
    const counts: string[] = [];
    let paidCalls = 0;
    const progress = await backfillCompanySizes(
      {
        listUnsizedDomains: async () => ["known.io", "wiki.io", "paid1.io", "paid2.io", "paid3.io"],
        cachedBand: async () => null,
        rememberBand: async (d) => {
          remembered.push(d);
        },
        applyBand: async (_ids, d) => {
          applied.push(d);
          return 2;
        },
        count: async (f) => {
          counts.push(String((f.domains as string[] | undefined)?.[0] ?? f.email_domain ?? ""));
          const host = (f.domains as string[] | undefined)?.[0];
          const sizes = f.company_size as string[];
          if (host === "known.io" && sizes?.includes("11 to 50")) return { total_matching: 9 };
          return { total_matching: 0 };
        },
        fetchImpl: async (url) => {
          const decoded = decodeURIComponent(url);
          const ok = decoded.includes("wikidata") && decoded.includes("wiki.io");
          return {
            ok: true,
            status: 200,
            json: async () =>
              ok ? { results: { bindings: [{ employees: { value: "180" } }] } } : { results: { bindings: [] } },
            text: async () => "",
          };
        },
        paidWorstCaseCents: 200,
        paidLookup: async (domain) => {
          paidCalls += 1;
          return { band: "51 to 200", cents: 200, source: "paid_test" };
        },
      },
      [1],
    );
    assert.ok(remembered.includes("known.io"));
    assert.ok(remembered.includes("wiki.io"));
    assert.equal(progress.classified, 1);
    assert.equal(progress.elsewhere, 1);
    assert.equal(progress.paid, 2, "only two paid hits fit in $5 at $2.00 each");
    assert.equal(progress.paid_cents, 400);
    assert.equal(progress.unknown, 1);
    assert.ok(paidCalls >= 2);
    assert.ok(counts.some((c) => c === "known.io"));
  });
});
