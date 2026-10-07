import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countOrSplit, exportOrSplit, exportRowLimit, type GetleadsFilters } from "./getleads.js";

const TIMEOUT = "tool export_contacts failed: Count timed out after 55s. Narrow the query (add a company, industry, or seniority filter) and retry. (count_timeout)";

const wide: GetleadsFilters = {
  job_titles: ["CIO", "IT Director"],
  company_size: ["11 to 50", "51 to 200"],
  industries: ["Software", "Information Technology"],
};

describe("getleads count timeout", () => {
  it("exports the plan limit and, on count_timeout, succeeds through one split", async () => {
    assert.equal(exportRowLimit(624), 624);
    const seen: GetleadsFilters[] = [];
    const started = await exportOrSplit(wide, { max_rows: 624 }, async (filters, opts) => {
      seen.push(filters);
      if ((filters.company_size ?? []).length > 1) throw new Error(TIMEOUT);
      assert.equal(opts.max_rows, 312);
      return { export_id: filters.company_size[0]!.replace(/\s+/g, "-") };
    });
    assert.equal(seen.filter((filters) => (filters.company_size ?? []).length > 1).length, 1);
    assert.deepEqual(started.export_ids, ["11-to-50", "51-to-200"]);
  });

  it("sums the slices of a timed-out count and does not send the wide query twice", async () => {
    let wideCalls = 0;
    const total = await countOrSplit(wide, async (filters) => {
      if ((filters.company_size ?? []).length > 1) {
        wideCalls += 1;
        throw new Error(TIMEOUT);
      }
      return { total_matching: 10, exportable_rows: 4 };
    });
    assert.equal(wideCalls, 1);
    assert.equal(total.total_matching, 20);
    assert.equal(total.exportable_rows, 8);
  });

  it("exports 137 cities in 3 or 4 chunks when a count over 45 cities times out", async () => {
    const cities = Array.from({ length: 137 }, (_, i) => `City ${i}`);
    const filters: GetleadsFilters = {
      job_titles: ["Property Manager"],
      cities,
      states: ["California"],
      email_status: ["VALID"],
    };
    const seen: number[] = [];
    const timeout = `tool export_contacts failed: ${JSON.stringify({ ok: false, message: "Count timed out after 55s. Narrow the query (add a company, industry, or seniority filter) and retry.", error: "count_timeout" })}`;
    const started = await exportOrSplit(filters, { max_rows: 1445 }, async (slice) => {
      const n = slice.cities?.length ?? 0;
      seen.push(n);
      if (n > 45) throw new Error(timeout);
      return { export_id: `chunk-${seen.length}` };
    });
    assert.ok(started.export_ids.length >= 3 && started.export_ids.length <= 4);
    assert.ok(seen.every((n) => n <= 45));
    assert.equal(seen.filter((n) => n > 45).length, 0);
    assert.equal(seen.reduce((sum, n) => sum + n, 0), 137);
  });

  it("does not retry a query that cannot be split", async () => {
    const single: GetleadsFilters = { job_titles: ["CIO"], company_size: ["11 to 50"] };
    await assert.rejects(
      () => exportOrSplit(single, { max_rows: 100 }, async () => {
        throw new Error(TIMEOUT);
      }),
      /count_timeout/,
    );
  });
});
