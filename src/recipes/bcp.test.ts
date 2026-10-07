import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Recipe } from "./schema.js";
import { BCP_SENIOR_IT_TITLES, BCP_STOPPED_CAMPAIGNS, keepBcpPeople, routeBcpPeople, shapeBcpRecipe } from "./bcp.js";

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
    assert.deepEqual(shaped.source.params.job_titles.slice(0, BCP_SENIOR_IT_TITLES.length), [...BCP_SENIOR_IT_TITLES]);
    assert.equal(shaped.source.params.job_titles.includes("CEO"), false);
    assert.equal(shaped.source.params.job_titles.includes("COO"), true);
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
});
