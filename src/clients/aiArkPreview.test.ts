import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GetleadsFilters } from "./getleads.js";
import { AI_ARK_TOKEN_MISSING, AiArkPreviewClient, peoplePreviewBody } from "./aiArkPreview.js";

const titles = {
  job_titles: ["CIO", "Director of IT"],
  company_size: ["51 to 200", "201 to 500"],
  countries: ["United States"],
  industries: ["Hospitals and Health Care", "Transportation, Logistics, Supply Chain and Storage"],
  company_description: "hospital, clinic, health system",
  email_status: ["VALID"],
} as GetleadsFilters;

describe("AI Ark People Preview", () => {
  it("maps titles, headcount, US, industries, and description, and does not send email status", () => {
    const built = peoplePreviewBody(titles);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.body.size, 1);
    assert.equal(built.body.page, 0);
    assert.equal(JSON.stringify(built.body).includes("email"), false);
    assert.equal(JSON.stringify(built.body).includes("metric"), false);
    const account = built.body.account as {
      employeeSize: { type: string; range: Array<{ start: number; end: number }> };
      location: { any: { include: string[] } };
      industries: { any: { include: { mode: string; content: string[] } } };
      keyword: { any: { include: { sources: Array<{ mode: string; source: string }>; content: string[] } } };
    };
    assert.equal(account.employeeSize.type, "RANGE");
    assert.deepEqual(account.employeeSize.range, [
      { start: 51, end: 200 },
      { start: 201, end: 500 },
    ]);
    assert.deepEqual(account.location.any.include, ["United States"]);
    assert.equal(account.industries.any.include.mode, "WORD");
    assert.deepEqual(account.industries.any.include.content, [
      "hospitals and health care",
      "transportation, logistics, supply chain and storage",
    ]);
    assert.deepEqual(account.keyword.any.include.sources, [{ mode: "WORD", source: "DESCRIPTION" }]);
    assert.deepEqual(account.keyword.any.include.content, ["hospital", "clinic", "health system"]);
    const contact = built.body.contact as { experience: { latest: { title: { any: { include: { mode: string; content: string[] } } } } } };
    assert.equal(contact.experience.latest.title.any.include.mode, "STRICT");
    assert.deepEqual(contact.experience.latest.title.any.include.content, ["CIO", "Director of IT"]);
  });

  it("maps Operations and Information Technology, and refuses an unmapped function", () => {
    const ops = peoplePreviewBody({ job_function: "Operations", seniority: ["C-Team", "VP", "Director"] } as GetleadsFilters);
    assert.equal(ops.ok, true);
    if (!ops.ok) return;
    const contact = ops.body.contact as {
      departmentAndFunction: { any: { include: string[] } };
      seniority: { any: { include: string[] } };
    };
    assert.deepEqual(contact.departmentAndFunction.any.include, ["operations"]);
    assert.deepEqual(contact.seniority.any.include, ["c_suite", "vp", "director"]);
    const it = peoplePreviewBody({ job_function: "Information Technology", seniority: ["Manager"] } as GetleadsFilters);
    assert.equal(it.ok, true);
    if (!it.ok) return;
    assert.deepEqual((it.body.contact as { departmentAndFunction: { any: { include: string[] } } }).departmentAndFunction.any.include, [
      "information_technology",
    ]);
    const finance = peoplePreviewBody({ job_function: "Finance", seniority: ["Director"] } as GetleadsFilters);
    assert.equal(finance.ok, false);
  });

  it("reads totalElements and does not return the preview page", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ totalElements: 1262, content: [{ id: "person-row" }] }), { status: 200 });
    }) as typeof fetch;
    const client = new AiArkPreviewClient("secret-token", "https://api.ai-ark.com/api/developer-portal/v1/people/preview", fetchImpl);
    const counted = await client.count({ job_titles: ["Owner"], countries: ["United States"] } as GetleadsFilters);
    assert.deepEqual(counted, { total_matching: 1262 });
    assert.equal(JSON.stringify(counted).includes("person-row"), false);
    const headers = calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers["X-TOKEN"], "secret-token");
    const body = JSON.parse(String(calls[0]?.init.body));
    assert.equal(body.size, 1);
    assert.equal(body.page, 0);
  });

  it("names the missing key and keeps a failed response out of the count", async () => {
    assert.match(AI_ARK_TOKEN_MISSING, /AI_ARK_TOKEN is not set/);
    assert.match(AI_ARK_TOKEN_MISSING, /No request was sent/);
    assert.match(AI_ARK_TOKEN_MISSING, /people\/preview/);
    const fetchImpl = (async () => new Response(JSON.stringify({ message: "unauthorized", content: [{ id: "person-row" }] }), { status: 401 })) as typeof fetch;
    const client = new AiArkPreviewClient("secret-token", "https://api.ai-ark.com/api/developer-portal/v1/people/preview", fetchImpl);
    await assert.rejects(
      () => client.count({ job_titles: ["Owner"], countries: ["United States"] } as GetleadsFilters),
      (err: Error) => /HTTP 401.*unauthorized/.test(err.message) && !err.message.includes("person-row"),
    );
  });
});
