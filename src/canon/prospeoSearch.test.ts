import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GetleadsFilters } from "../clients/getleads.js";
import { PROSPEO_API_KEY_MISSING, ProspeoSearchClient, searchPersonBody } from "./prospeoSearch.js";

/** D83 — search-person page 1, mocked HTTP only. Ask Josh. */

const icp = {
  job_titles: ["Owner"],
  countries: ["United States"],
  industries: ["Truck Transportation", "Outpatient Care Centers", "Hospitals and Health Care"],
  company_size: ["51 to 200"],
} as GetleadsFilters;

describe("D83 — Prospeo search-person body", () => {
  it("sends page-1 filters with exact titles and flagged industry mappings", () => {
    const built = searchPersonBody(icp, ["Truck Transportation", "Outpatient Care Centers", "Hospitals and Health Care"]);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual((built.filters.person_job_title as { include: string[]; match_mode: string }).include, ["Owner"]);
    assert.equal((built.filters.person_job_title as { match_mode: string }).match_mode, "EXACT");
    assert.deepEqual((built.filters.company_industry as { include: string[] }).include, [
      "Truck and Railroad Transportation",
      "Hospitals and Health Care",
    ]);
    assert.deepEqual(built.filters.company_headcount_range, ["51-100", "101-200"]);
    assert.deepEqual((built.filters.person_location_search as { include: string[] }).include, ["United States"]);
    assert.equal(JSON.stringify(built.filters).includes("email"), false);
    const kinds = Object.fromEntries(built.industry_mappings.map((m) => [m.input, m.match]));
    assert.equal(kinds["Truck Transportation"], "inexact");
    assert.equal(kinds["Outpatient Care Centers"], "none");
    assert.equal(kinds["Hospitals and Health Care"], "exact");
  });

  it("refuses when every industry is unmatched so the filter is not dropped", () => {
    const built = searchPersonBody({ job_titles: ["Owner"] } as GetleadsFilters, ["Outpatient Care Centers"]);
    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.match(built.reason, /none of the industries map/);
    assert.equal(built.industry_mappings[0]?.match, "none");
  });

  it("reads pagination.total_count, treats NO_RESULTS as a free zero, and never returns the page", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify({
          error: false,
          free: false,
          results: [{ person: { first_name: "x" } }],
          pagination: { current_page: 1, per_page: 25, total_count: 4812 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const client = new ProspeoSearchClient("secret-key", "https://example.test/search-person", fetchImpl);
    const counted = await client.count({ job_titles: ["Owner"], countries: ["United States"] } as GetleadsFilters);
    assert.deepEqual(counted, { total_matching: 4812, free: false });
    assert.equal(JSON.stringify(counted).includes("first_name"), false);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["X-KEY"], "secret-key");
    const body = JSON.parse(String(calls[0]?.init.body)) as { page: number; filters: { person_job_title: { match_mode: string } } };
    assert.equal(body.page, 1);
    assert.equal(body.filters.person_job_title.match_mode, "EXACT");

    const empty = (async () =>
      new Response(JSON.stringify({ error: true, error_code: "NO_RESULTS" }), { status: 400 })) as typeof fetch;
    const miss = new ProspeoSearchClient("secret-key", "https://example.test/search-person", empty);
    assert.deepEqual(await miss.count({ job_titles: ["Owner"] } as GetleadsFilters), { total_matching: 0, free: true });
  });

  it("names the missing key and does not send", async () => {
    assert.match(PROSPEO_API_KEY_MISSING, /PROSPEO_API_KEY is not set/);
    assert.match(PROSPEO_API_KEY_MISSING, /No request was sent/);
    assert.match(PROSPEO_API_KEY_MISSING, /search-person/);
    const client = new ProspeoSearchClient("", "https://example.test/search-person", (async () => {
      throw new Error("fetch must not run");
    }) as typeof fetch);
    await assert.rejects(() => client.count({ job_titles: ["Owner"] } as GetleadsFilters), /PROSPEO_API_KEY is not set/);
  });
});
