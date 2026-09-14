import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertGetleadsFilters, outboundFilters, type GetleadsFilters } from "./getleads.js";

/** D34 — band labels plus a numeric employee bound is the August overlap. */

function bands(extra: Record<string, unknown> = {}): GetleadsFilters {
  return {
    job_titles: ["IT Director"],
    company_size: ["11 to 50"],
    email_status: ["VALID"],
    ...extra,
  } as GetleadsFilters;
}

describe("getleads filters — D34", () => {
  it("accepts band labels alone", () => {
    assert.doesNotThrow(() => assertGetleadsFilters(bands()));
  });

  it("refuses company_size together with employee_profiles_on_linkedin", () => {
    assert.throws(
      () => assertGetleadsFilters(bands({ employee_profiles_on_linkedin: { min: 11, max: 200 } })),
      /band overlap/,
    );
  });

  it("refuses company_size together with employee_count_min", () => {
    assert.throws(() => assertGetleadsFilters(bands({ employee_count_min: 11 })), /band overlap/);
  });

  it("D35 item 15 — omits empty email_status so getleads returns every status", () => {
    const out = outboundFilters({ job_titles: ["IT Director"], company_size: ["11 to 50"] } as GetleadsFilters);
    assert.equal("email_status" in out, false);
    assert.deepEqual(outboundFilters(bands()).email_status, ["VALID"]);
  });
});
