import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countSource } from "./count.js";

/** D52 — count: the number, every call, the cost; a paid count waits for a name. Ask Josh. */

function deps(over: Partial<Parameters<typeof countSource>[0]> = {}) {
  const recorded: unknown[] = [];
  const seen: unknown[] = [];
  const prospeoSeen: unknown[] = [];
  const rails = {
    gate: async (req: { approvedCents?: number }) => (req.approvedCents && req.approvedCents > 0 ? { kind: "proceed", worstCaseCents: 5, reason: "approved" } : { kind: "ask", worstCaseCents: 5, reason: "worst case $0.05 is over the $0.00 auto cap; needs an owner tap" }),
    record: async (r: unknown) => {
      recorded.push(r);
    },
  };
  return {
    seen,
    d: {
      getleads: { count: async (f: unknown) => { seen.push(f); return { total_matching: 816, exportable_rows: 816 }; } },
      aiArk: { count: async () => ({ total_matching: 2231 }) },
      prospeo: { count: async (f: unknown) => { prospeoSeen.push(f); return { total_matching: 4812, free: false }; } },
      maps: { scopedBusinesses: async ({ category }: { category: string }) => (category === "roofing" ? 120 : 30) },
      permits: { monthlyTotal: async () => ({ total: 50, months: 1, state: "TX" }) },
      rails,
      db: {
        query: async (text: string) => {
          if (text.includes("information_schema.tables")) return { rows: [{ n: "1" }] };
          if (text.includes("information_schema.columns")) {
            return { rows: ["place_id", "plan_id", "main_category"].map((column_name) => ({ column_name })) };
          }
          if (text.includes("from public.leads")) return { rows: [{ n: "10" }] };
          if (text.startsWith("select count(*)::text as n")) return { rows: [{ n: "18322" }] };
          return { rows: [] };
        },
      },
      ...over,
    } as never,
    recorded,
    prospeoSeen,
  };
}

describe("D52 — count", () => {
  it("getleads counts for free with the record's filters and honors the receipt cap", async () => {
    const { d } = deps();
    const r = await countSource(d, { client_tag: "bcp", source: "getleads", filters: { job_titles: ["CIO"], industries: ["Hospitals"], max_per_company: 2 } });
    assert.equal(r.count, 816);
    assert.equal(r.cost_cents, 0);
    assert.equal(r.filters_used.max_per_company, 2);
    assert.match(r.note ?? "", /max_per_company 2 honored \(D84\)/);
    assert.match(r.note ?? "", /lower\(current_title\) IN/);
    assert.equal(r.filters_used.where_sql, "lower(current_title) IN ('cio')");
    assert.ok(!("job_titles" in r.filters_used));
    assert.match(r.rule, /TAM for this campaign is exhausted/);
    const sub = await countSource(d, {
      client_tag: "bcp",
      source: "getleads",
      filters: { job_titles: ["CIO"], title_match: "substring" },
    });
    assert.deepEqual(sub.filters_used.job_titles, ["CIO"]);
    assert.ok(!("where_sql" in sub.filters_used));
    assert.match(sub.note ?? "", /substring as the receipt asked/);
  });

  it("D74 — maps stored getleads keys and fails on an unmapped key", async () => {
    const { d, seen } = deps();
    const r = await countSource(d, {
      client_tag: "bcp",
      source: "getleads",
      filters: {
        job_titles: ["Partner"],
        countries: ["United States"],
        industries: ["Truck Transportation", "Transportation, Logistics, Supply Chain and Storage"],
        company_description: "private equity",
        purged_titles: ["Analyst", "Associate"],
        max_per_company: 3,
      },
    });
    assert.equal(r.count, 816);
    assert.deepEqual(r.filters_used.industries, ["Truck Transportation", "Transportation; Logistics; Supply Chain and Storage"]);
    assert.equal(r.filters_used.company_description, "private equity");
    assert.equal(r.filters_used.where_sql, "lower(current_title) IN ('partner') AND lower(current_title) NOT IN ('analyst', 'associate')");
    assert.ok(!("exclude_job_titles" in r.filters_used));
    assert.equal(r.filters_used.max_per_company, 3);
    assert.ok(!("purged_titles" in r.filters_used));
    const sent = seen[0] as { industries: string[]; company_description: string; exclude_job_titles: string[]; max_per_company?: number };
    assert.deepEqual(sent.industries, r.filters_used.industries);
    assert.equal(sent.company_description, "private equity");
    assert.equal(sent.max_per_company, undefined, "D43/D84: count_contacts still cannot take the cap");
    const byCampaign = await countSource(d, {
      client_tag: "bcp",
      source: "getleads",
      filters: { job_titles: ["Partner"], industries_by_campaign: { "3763801": ["Hospitals"] } },
    });
    assert.equal(byCampaign.count, 816);
    assert.deepEqual(byCampaign.filters_used.industries, ["Hospitals"]);
    assert.deepEqual(byCampaign.filters_used.industries_by_campaign, { "3763801": ["Hospitals"] });
    const badIndustry = await countSource(d, {
      client_tag: "bcp",
      source: "getleads",
      filters: { job_titles: ["Partner"], industries: ["Not A Real Industry"] },
    });
    assert.equal(badIndustry.count, null);
    assert.match(badIndustry.note ?? "", /not a getleads industry/);
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
    assert.match(yes.note ?? "", /STRICT/);
    const sub = await countSource(d, { client_tag: "bcp", source: "ai_ark", filters: { job_titles: ["CIO"], title_match: "substring" }, approved_by: "Cayden" });
    assert.match(sub.note ?? "", /WORD/);
  });

  it("D83 — a Prospeo count estimates first, maps industries, and records a named approval", async () => {
    const { d, recorded } = deps();
    const filters = {
      job_titles: ["Owner"],
      industries: ["Truck Transportation", "Outpatient Care Centers", "Hospitals and Health Care"],
      countries: ["United States"],
    };
    const no = await countSource(d, { client_tag: "bcp", source: "prospeo", filters });
    assert.equal(no.count, null);
    assert.match(no.note ?? "", /approved_by/);
    assert.ok((no.estimate_cents ?? 0) > 0);
    const truck = no.industry_mappings?.find((m) => m.input === "Truck Transportation");
    assert.equal(truck?.match, "inexact");
    assert.equal(truck?.prospeo, "Truck and Railroad Transportation");
    const none = no.industry_mappings?.find((m) => m.input === "Outpatient Care Centers");
    assert.equal(none?.match, "none");
    const yes = await countSource(d, { client_tag: "bcp", source: "prospeo", filters, approved_by: "Josh" });
    assert.equal(yes.count, 4812);
    assert.equal((recorded[0] as { approvedBy: string }).approvedBy, "Josh");
    assert.deepEqual(yes.filters_used.industries, ["Truck and Railroad Transportation", "Hospitals and Health Care"]);
    assert.match(yes.note ?? "", /Truck Transportation/);
    const unpaid = await countSource(d, { client_tag: "bcp", source: "prospeo", filters: { job_titles: ["Owner"], industries: ["Outpatient Care Centers"] }, approved_by: "Josh" });
    assert.equal(unpaid.count, null);
    assert.match(unpaid.note ?? "", /none of the industries map/);
  });

  it("maps reads the stored pool by plan_id and is not zero when rows exist; permits still sum by type and state", async () => {
    const { d } = deps();
    const maps = await countSource(d, {
      client_tag: "emcor",
      source: "maps",
      filters: { plan_id: "custom-1789679826", categories: ["church", "hotel"], states: [], zips: ["94107"] },
    });
    assert.equal(maps.count, 18322);
    assert.equal(maps.pool, 18322);
    assert.equal(maps.already_used, 10);
    assert.equal(maps.net_new, 18312);
    assert.equal(maps.filters_used.plan_id, "custom-1789679826");
    assert.ok(!("states" in maps.filters_used) && !("zips" in maps.filters_used), "D57: plan_id scoping must not be dropped for states/zips");
    assert.notEqual(maps.count, 0, "D57: count must not be 0 when the stored pool exists");
    const dropped = await countSource(d, { client_tag: "emcor", source: "maps", filters: { categories: ["church"], states: ["CA"] } });
    assert.equal(dropped.count, null);
    assert.match(dropped.note ?? "", /plan_id/);
    const permits = await countSource(d, { client_tag: "peterson", source: "permits", filters: { permit_types: ["roof"], states: ["TX", "FL"] } });
    assert.equal(permits.count, 100);
    const bad = await countSource(d, { client_tag: "bcp", source: "getleads", filters: { industries: ["Hospitals"] } });
    assert.equal(bad.count, null);
    assert.match(bad.note ?? "", /job_titles/);
  });

  it("D84 — every source honors max_per_company, industries_by_campaign and over_1k_campaign", async () => {
    const { d, seen } = deps();
    const receipt = {
      job_titles: ["Partner"],
      industries_by_campaign: { "3763801": ["Hospitals"], "3763802": ["Truck Transportation"] },
      max_per_company: 2,
      over_1k_campaign: true,
    };
    const gl = await countSource(d, { client_tag: "bcp", source: "getleads", filters: receipt, campaign_id: 3763801 });
    assert.equal(gl.count, 816);
    assert.deepEqual(gl.filters_used.industries, ["Hospitals"]);
    assert.equal(gl.filters_used.max_per_company, 2);
    assert.equal(gl.filters_used.over_1k_campaign, true);
    assert.deepEqual(gl.filters_used.company_size, ["1001 to 5000", "5001 to 10000", "10001+"]);
    assert.ok(!("max_per_company" in (seen[0] as object)), "count_contacts does not receive the cap");
    const ark = await countSource(d, {
      client_tag: "bcp",
      source: "ai_ark",
      filters: receipt,
      campaign_id: 3763801,
      approved_by: "Cayden",
    });
    assert.equal(ark.count, 2231);
    assert.equal(ark.filters_used.max_per_company, 2);
    assert.deepEqual(ark.filters_used.industries, ["Hospitals"]);
    assert.equal(ark.filters_used.over_1k_campaign, true);
    const maps = await countSource(d, {
      client_tag: "emcor",
      source: "maps",
      filters: { plan_id: "custom-1789679826", categories: ["church"], ...receipt },
      campaign_id: 3763801,
    });
    assert.equal(maps.count, 18322);
    assert.equal(maps.filters_used.max_per_company, 2);
    assert.deepEqual(maps.filters_used.industries, ["Hospitals"]);
    assert.equal(maps.filters_used.over_1k_campaign, true);
    const permits = await countSource(d, {
      client_tag: "peterson",
      source: "permits",
      filters: { permit_types: ["roof"], states: ["TX"], ...receipt },
      campaign_id: 3763801,
    });
    assert.equal(permits.count, 50);
    assert.equal(permits.filters_used.max_per_company, 2);
    assert.deepEqual(permits.filters_used.industries, ["Hospitals"]);
    assert.equal(permits.filters_used.over_1k_campaign, true);
    const { d: pd, prospeoSeen } = deps();
    const pro = await countSource(pd, {
      client_tag: "bcp",
      source: "prospeo",
      filters: receipt,
      campaign_id: 3763802,
      approved_by: "Josh",
    });
    assert.equal(pro.count, 4812);
    assert.equal(pro.filters_used.max_per_company, 2);
    assert.deepEqual(pro.filters_used.industries, ["Truck and Railroad Transportation"]);
    assert.deepEqual(pro.filters_used.industries_by_campaign, { "3763802": ["Truck Transportation"] });
    assert.equal(pro.filters_used.over_1k_campaign, true);
    assert.deepEqual(pro.filters_used.company_size, ["1001 to 5000", "5001 to 10000", "10001+"]);
    assert.deepEqual(pro.filters_used.company_headcount_range, ["1001-2000", "2001-5000", "5001-10000", "10000+"]);
    assert.match(pro.note ?? "", /max_per_company 2 honored \(D84\)/);
    assert.match(pro.note ?? "", /count is uncapped/);
    assert.ok(!("max_per_company" in (prospeoSeen[0] as object)), "search-person does not receive the cap");
    const storedBands = await countSource(pd, {
      client_tag: "bcp",
      source: "prospeo",
      filters: {
        job_titles: ["Partner"],
        industries: ["Hospitals and Health Care"],
        company_size: ["1001 to 5000"],
        over_1k_campaign: true,
        max_per_company: 2,
      },
      approved_by: "Josh",
    });
    assert.deepEqual(storedBands.filters_used.company_size, ["1001 to 5000"]);
    assert.deepEqual(storedBands.filters_used.company_headcount_range, ["1001-2000", "2001-5000"]);
  });
});
