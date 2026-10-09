import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countSource } from "./count.js";

/** D52 — count: the number, every call, the cost; a paid count waits for a name. Ask Josh. */

function deps(over: Partial<Parameters<typeof countSource>[0]> = {}) {
  const recorded: unknown[] = [];
  const rails = {
    gate: async (req: { approvedCents?: number }) => (req.approvedCents && req.approvedCents > 0 ? { kind: "proceed", worstCaseCents: 5, reason: "approved" } : { kind: "ask", worstCaseCents: 5, reason: "worst case $0.05 is over the $0.00 auto cap; needs an owner tap" }),
    record: async (r: unknown) => {
      recorded.push(r);
    },
  };
  return {
    d: {
      getleads: { count: async () => ({ total_matching: 816, exportable_rows: 816 }) },
      aiArk: { count: async () => ({ total_matching: 2231 }) },
      maps: { scopedBusinesses: async ({ category }: { category: string }) => (category === "roofing" ? 120 : 30) },
      permits: { monthlyTotal: async () => ({ total: 50, months: 1, state: "TX" }) },
      rails,
      ...over,
    } as never,
    recorded,
  };
}

describe("D52 — count", () => {
  it("getleads counts for free with the record's filters and drops the export cap", async () => {
    const { d } = deps();
    const r = await countSource(d, { client_tag: "bcp", source: "getleads", filters: { job_titles: ["CIO"], industries: ["Hospitals"], max_per_company: 2 } });
    assert.equal(r.count, 816);
    assert.equal(r.cost_cents, 0);
    assert.ok(!("max_per_company" in r.filters_used));
    assert.match(r.rule, /TAM for this campaign is exhausted/);
  });

  it("an AI Ark count is not sent without a name, and is sent and recorded with one", async () => {
    const { d, recorded } = deps();
    const no = await countSource(d, { client_tag: "bcp", source: "ai_ark", filters: { job_titles: ["CIO"] } });
    assert.equal(no.count, null);
    assert.match(no.note ?? "", /approved_by/);
    const yes = await countSource(d, { client_tag: "bcp", source: "ai_ark", filters: { job_titles: ["CIO"] }, approved_by: "Cayden" });
    assert.equal(yes.count, 2231);
    assert.equal(yes.cost_cents, 5);
    assert.equal((recorded[0] as { approvedBy: string }).approvedBy, "Cayden");
  });

  it("maps and permits sum the stored pools per category and state, and bad filters say what is missing", async () => {
    const { d } = deps();
    const maps = await countSource(d, { client_tag: "vasco", source: "maps", filters: { categories: ["roofing", "hvac"], states: ["TX"] } });
    assert.equal(maps.count, 150);
    const permits = await countSource(d, { client_tag: "peterson", source: "permits", filters: { permit_types: ["roof"], states: ["TX", "FL"] } });
    assert.equal(permits.count, 100);
    const bad = await countSource(d, { client_tag: "bcp", source: "getleads", filters: { industries: ["Hospitals"] } });
    assert.equal(bad.count, null);
    assert.match(bad.note ?? "", /job_titles/);
  });
});
