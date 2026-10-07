import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Recipe } from "./schema.js";
import {
  BCP_HEALTHCARE_INDUSTRIES,
  BCP_LOGISTICS_INDUSTRIES,
  BCP_SENIOR_IT_TITLES,
  BCP_STOPPED_CAMPAIGNS,
  BCP_UNFILTERED_IT_POOL,
  bcpPoolFilters,
  bcpPoolReport,
  keepBcpPeople,
  routeBcpPeople,
  shapeBcpRecipe,
} from "./bcp.js";

describe("BCP senior IT targeting", () => {
  it("keeps the CIO and drops the COO when both are at the company", () => {
    const kept = keepBcpPeople([
      { company: "Acme Health", title: "CIO" },
      { company: "Acme Health", title: "Chief Operating Officer" },
    ]);
    assert.deepEqual(kept.map((person) => person.title), ["CIO"]);
  });

  it("keeps the COO when the company has no senior IT leader", () => {
    const kept = keepBcpPeople([{ company: "Acme Health", title: "COO" }]);
    assert.deepEqual(kept.map((person) => person.title), ["COO"]);
  });

  it("never routes a CEO to an IT-copy campaign", () => {
    const people = [{ company: "Acme Health", title: "CEO" }];
    const itOnly = routeBcpPeople(people, [{ campaign_id: 3921850, ceo: false }]);
    assert.deepEqual(itOnly, []);
    const both = routeBcpPeople(people, [
      { campaign_id: 3921850, ceo: false },
      { campaign_id: 999, ceo: true },
    ]);
    assert.deepEqual(both.map((row) => row.campaign_id), [999]);
    assert.equal(both.some((row) => row.campaign_id === 3921850), false);
  });

  it("drops CFO, President, Owner, and PE titles", () => {
    const kept = keepBcpPeople([
      { company: "Acme", title: "CFO" },
      { company: "Acme", title: "President" },
      { company: "Acme", title: "Owner" },
      { company: "Firm", title: "Managing Director" },
      { company: "Firm", title: "Principal" },
    ]);
    assert.deepEqual(kept, []);
  });

  it("rewrites a BCP getleads recipe to senior IT, 51 to 1,000, and drops STOPPED campaigns", () => {
    const recipe = {
      recipe_id: "bcp.healthcare_exec.v0",
      client_tag: "bcp",
      lane: "healthcare_exec",
      routing: [
        { when: { slot: "3921850" }, campaign_id: 3921850, icp: { kind: "linkedin_native", persona: "exec" } },
        { when: { slot: "3763797" }, campaign_id: 3763797, icp: { kind: "linkedin_native", persona: "exec" } },
      ],
      source: {
        kind: "getleads",
        params: {
          job_titles: ["CEO", "CFO", "Owner"],
          company_size: ["51 to 200"],
          industries: ["Hospitals and Health Care"],
          countries: ["United States"],
        },
        widening_candidates: [],
      },
    } as Recipe;
    const shaped = shapeBcpRecipe(recipe);
    assert.equal(shaped.source.kind, "getleads");
    if (shaped.source.kind !== "getleads") return;
    assert.deepEqual(shaped.source.params.job_titles, [...BCP_SENIOR_IT_TITLES]);
    assert.equal(shaped.source.params.job_titles.includes("CEO"), false);
    assert.equal(shaped.source.params.job_titles.includes("COO"), false);
    assert.equal(shaped.source.params.job_titles.includes("Chief Operating Officer"), false);
    assert.deepEqual(shaped.source.params.company_size, ["51 to 200", "201 to 500", "501 to 1000"]);
    assert.equal(shaped.source.params.max_per_company, 3);
    assert.deepEqual(shaped.source.params.industries, ["Hospitals and Health Care"]);
    assert.deepEqual(
      shaped.routing.map((rule) => rule.campaign_id),
      [3921850],
    );
    assert.equal(shaped.routing.some((rule) => (BCP_STOPPED_CAMPAIGNS as readonly number[]).includes(rule.campaign_id)), false);
    assert.equal(shaped.routing[0]?.icp.persona, "senior_it");
  });

  it("retires pe_firms instead of pulling partners", () => {
    const recipe = {
      recipe_id: "bcp.pe_firms.v0",
      client_tag: "bcp",
      lane: "pe_firms",
      routing: [{ when: { slot: "1" }, campaign_id: 1, icp: { kind: "linkedin_native", persona: "partner" } }],
      source: { kind: "getleads", params: { job_titles: ["Partner", "Managing Director", "Principal"], countries: ["United States"] }, widening_candidates: [] },
    } as Recipe;
    const shaped = shapeBcpRecipe(recipe);
    assert.deepEqual(shaped.routing, []);
    assert.equal(shaped.source.kind, "mixed");
  });

  it("gives healthcare IT and logistics IT the Sept 3 industry lists, and the pools are not the same", () => {
    const recipe = {
      recipe_id: "bcp.it_dm_airpods.v0",
      client_tag: "bcp",
      lane: "it_dm_airpods",
      routing: [
        { when: { slot: "3921850" }, campaign_id: 3921850, icp: { kind: "linkedin_native", persona: "senior_it" } },
        { when: { slot: "3921852" }, campaign_id: 3921852, icp: { kind: "linkedin_native", persona: "senior_it" } },
        { when: { slot: "3921869" }, campaign_id: 3921869, icp: { kind: "linkedin_native", persona: "senior_it" } },
      ],
      source: {
        kind: "getleads",
        params: { job_titles: ["CIO"], company_size: ["51 to 200"], countries: ["United States"] },
        widening_candidates: [],
      },
    } as Recipe;
    const shaped = shapeBcpRecipe(recipe);
    const healthcare = shaped.routing.find((rule) => rule.campaign_id === 3921850)?.source;
    const logistics = shaped.routing.find((rule) => rule.campaign_id === 3921852)?.source;
    const logisticsSeg = shaped.routing.find((rule) => rule.campaign_id === 3921869)?.source;
    assert.equal(healthcare?.kind, "getleads");
    assert.equal(logistics?.kind, "getleads");
    if (healthcare?.kind !== "getleads" || logistics?.kind !== "getleads" || logisticsSeg?.kind !== "getleads") return;
    assert.deepEqual(healthcare.params.industries, [...BCP_HEALTHCARE_INDUSTRIES]);
    assert.deepEqual(logistics.params.industries, [...BCP_LOGISTICS_INDUSTRIES]);
    assert.deepEqual(logisticsSeg.params.industries, [...BCP_LOGISTICS_INDUSTRIES]);
    assert.notDeepEqual(healthcare.params.industries, logistics.params.industries);
    assert.equal(healthcare.params.company_description, undefined);
    assert.equal(logistics.params.company_description, undefined);
    assert.equal(healthcare.params.job_titles?.includes("COO"), false);
    assert.ok((healthcare.params.industries?.length ?? 0) > 0);
    assert.ok(BCP_UNFILTERED_IT_POOL > 10_000);
    const pools = bcpPoolFilters(healthcare.params, "healthcare");
    assert.deepEqual(pools.industry.industries, [...BCP_HEALTHCARE_INDUSTRIES]);
    assert.equal(pools.industry.company_description, undefined);
    assert.equal(pools.description.industries, undefined);
    assert.match(pools.description.company_description ?? "", /hospital/);
    assert.deepEqual(pools.both.industries, [...BCP_HEALTHCARE_INDUSTRIES]);
    assert.match(pools.both.company_description ?? "", /hospital/);
    assert.deepEqual(pools.coo.job_titles, ["COO", "Chief Operating Officer"]);
    assert.equal(pools.coo.job_titles?.includes("CIO"), false);
    const small = bcpPoolReport({ industry: 271, description: 900, both: 180, coo: 400, rows_found: 3779 });
    assert.match(small, /Industry-only count 271/);
    assert.match(small, /Description-only count 900/);
    assert.match(small, /together 180/);
    assert.match(small, /COO fallback pool 400/);
    assert.match(small, /not in the thousands/);
    assert.match(small, /IT Manager/);
    const wide = bcpPoolReport({ industry: 3779, description: 5000, both: 271, coo: 800, rows_found: 3779 });
    assert.equal(wide.includes("not in the thousands"), false);
  });
});
