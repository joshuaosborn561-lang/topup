import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BCP_HEALTHCARE_DESCRIPTION, BCP_HEALTHCARE_INDUSTRIES, BCP_SENIOR_IT_TITLES, BCP_BANDS } from "../../recipes/bcp.js";
import { MSP_OWNER_BANDS, MSP_OWNER_TITLES } from "../../recipes/powergryd.js";
import { pilotAllowsSize, pilotExpectFor, pilotRowsFromCsv, scorePilot, type PilotRow } from "./pilot.js";

function row(patch: Partial<PilotRow> & Record<string, unknown>): PilotRow {
  return {
    title: patch.title ?? "",
    industry: patch.industry ?? "",
    description: patch.description ?? "",
    company_size: patch.company_size ?? "",
    employees: patch.employees ?? null,
    country: patch.country ?? "",
    state: patch.state ?? "",
    city: patch.city ?? "",
  };
}

describe("pilot before size", () => {
  it("scores a BCP healthcare IT sample and returns no rows and no ingest job", () => {
    const expect = pilotExpectFor("bcp", "it_dm_airpods", {
      job_titles: [...BCP_SENIOR_IT_TITLES],
      industries: [...BCP_HEALTHCARE_INDUSTRIES],
      company_description: BCP_HEALTHCARE_DESCRIPTION.join(", "),
      company_size: [...BCP_BANDS],
      countries: ["United States"],
    });
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({
        title: BCP_SENIOR_IT_TITLES[i % BCP_SENIOR_IT_TITLES.length] ?? "CIO",
        industry: i % 2 === 0 ? "Hospitals and Health Care" : "Medical Practices",
        description: "Regional hospital and clinic",
        company_size: "51 to 200",
        country: "United States",
        email: "cio@hospital.example",
        company: "Acme Health",
      }),
    );
    const score = scorePilot(rows, expect);
    assert.equal(score.gate, "ok");
    assert.equal(pilotAllowsSize(score), true);
    assert.equal(score.title_match, 100);
    assert.equal(score.industry_match, 100);
    assert.ok((score.description_match ?? 0) >= 80);
    assert.equal(score.headcount_match, 100);
    assert.equal(score.geography_match, 100);
    assert.ok(score.top_titles.length <= 10);
    assert.ok(score.top_titles.some((item) => item.name === "CIO" && item.count > 0));
    assert.ok(score.top_industries.some((item) => item.name === "Hospitals and Health Care"));
    const text = JSON.stringify(score);
    assert.equal(text.includes("@"), false);
    assert.equal(text.includes("Acme"), false);
    assert.equal("rows" in score, false);
    assert.equal("ingest" in score, false);
  });

  it("scores PowerGRYD MSP owners and parks when the description is not an MSP", () => {
    const expect = pilotExpectFor("powergryd", "msp_owners", {
      job_titles: [...MSP_OWNER_TITLES],
      industries: ["IT Services and IT Consulting"],
      company_description: "managed service provider, IT support",
      company_size: [...MSP_OWNER_BANDS],
      countries: ["United States"],
    });
    const good = Array.from({ length: 10 }, () =>
      row({
        title: "Owner",
        industry: "IT Services and IT Consulting",
        description: "A managed service provider for local clinics",
        company_size: "11 to 50",
        employees: 40,
        country: "US",
      }),
    );
    const passed = scorePilot(good, expect);
    assert.equal(passed.gate, "ok");
    assert.equal(passed.description_match, 100);
    assert.ok(passed.top_titles[0]?.name === "Owner");
    assert.equal(JSON.stringify(passed).includes("@"), false);

    const weak = good.map((item, i) => (i < 8 ? { ...item, description: "IT support and help desk" } : item));
    const failed = scorePilot(weak, expect);
    assert.equal(failed.gate, "pilot_mismatch");
    assert.equal(pilotAllowsSize(failed), false);
    assert.ok((failed.description_match ?? 100) < 80);
    assert.equal("rows" in failed, false);
    assert.equal(JSON.stringify(failed).includes("ingest"), false);
  });

  it("drops email and company columns when a vendor CSV is scored", () => {
    const csv = "job_title,industry,company_description,company_size,country,email,company_name\nCIO,Hospitals and Health Care,hospital,51 to 200,United States,cio@hospital.example,Acme Health\n";
    const rows = pilotRowsFromCsv(csv);
    assert.equal(rows.length, 1);
    assert.equal(JSON.stringify(rows).includes("@"), false);
    assert.equal(JSON.stringify(rows).includes("Acme"), false);
    assert.equal(rows[0]?.title, "CIO");
  });
});
