import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getleadsParamsFromFilters, honorReceiptCountKeys, OVER_1K_BANDS } from "./filters.js";

/** D74 — stored getleads keys map or the parse fails. Ask Josh. */

describe("D74 — getleads filter mapping", () => {
  it("keeps the comma LinkedIn industry as the getleads semicolon name", () => {
    const r = getleadsParamsFromFilters({
      job_titles: ["Fleet Manager"],
      industries: ["Truck Transportation", "Transportation, Logistics, Supply Chain and Storage"],
      company_description: "3PL, freight",
      purged_titles: ["Dispatcher"],
      max_per_company: 2,
    });
    assert.ok(r.ok);
    assert.deepEqual(r.params.industries, ["Truck Transportation", "Transportation; Logistics; Supply Chain and Storage"]);
    assert.equal(r.params.company_description, "3PL, freight");
    assert.deepEqual(r.params.exclude_job_titles, ["Dispatcher"]);
    assert.equal(r.params.max_per_company, 2);
  });

  it("fails loud on an unmapped key or an unknown industry", () => {
    const meta = getleadsParamsFromFilters({ job_titles: ["Partner"], icp_gate: "yes", over_1k_campaign: true });
    assert.ok(meta.ok, "D92: icp_gate is receipt meta and is stripped");
    const extra = getleadsParamsFromFilters({ job_titles: ["Partner"], mystery_key: 1 });
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.match(extra.error, /mystery_key/);
    const unknown = getleadsParamsFromFilters({ job_titles: ["Partner"], industries: ["Not A Real Industry"] });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.error, /not a getleads industry/);
  });

  it("D84 — honors industries_by_campaign, over_1k_campaign and max_per_company", () => {
    const one = getleadsParamsFromFilters({
      job_titles: ["Partner"],
      industries_by_campaign: { "3763801": ["Hospitals"] },
      max_per_company: 3,
    });
    assert.ok(one.ok);
    if (one.ok) {
      assert.deepEqual(one.params.industries, ["Hospitals"]);
      assert.equal(one.params.max_per_company, 3);
    }
    const picked = getleadsParamsFromFilters(
      {
        job_titles: ["Partner"],
        industries_by_campaign: { "3763801": ["Hospitals"], "3763802": ["Truck Transportation"] },
      },
      3763802,
    );
    assert.ok(picked.ok);
    if (picked.ok) assert.deepEqual(picked.params.industries, ["Truck Transportation"]);
    const needId = getleadsParamsFromFilters({
      job_titles: ["Partner"],
      industries_by_campaign: { "3763801": ["Hospitals"], "3763802": ["Truck Transportation"] },
    });
    assert.equal(needId.ok, false);
    if (!needId.ok) assert.match(needId.error, /pass campaign_id/);
    const bucketMiss = getleadsParamsFromFilters(
      {
        job_titles: ["CIO"],
        industries_by_campaign: {
          alpha: ["Transportation, Logistics, Supply Chain and Storage", "Truck Transportation"],
          omega: ["Hospitals and Health Care", "Medical Practices"],
        },
      },
      3921852,
    );
    assert.equal(bucketMiss.ok, false);
    if (!bucketMiss.ok) {
      assert.match(bucketMiss.error, /no list for campaign 3921852/);
      assert.match(bucketMiss.error, /Stored keys: alpha, omega/);
    }
    const alpha = getleadsParamsFromFilters(
      {
        job_titles: ["CIO"],
        industries_by_campaign: {
          alpha: ["Transportation, Logistics, Supply Chain and Storage", "Truck Transportation"],
          omega: ["Hospitals and Health Care", "Medical Practices"],
        },
      },
      3921852,
      "North Alpha IT",
    );
    assert.ok(alpha.ok, (alpha as { error?: string }).error);
    if (alpha.ok) {
      assert.deepEqual(alpha.params.industries, ["Transportation; Logistics; Supply Chain and Storage", "Truck Transportation"]);
    }
    const omega = getleadsParamsFromFilters(
      {
        job_titles: ["CIO"],
        industries_by_campaign: {
          alpha: ["Transportation, Logistics, Supply Chain and Storage", "Truck Transportation"],
          omega: ["Hospitals and Health Care", "Medical Practices"],
        },
      },
      3921850,
      "North Omega IT",
    );
    assert.ok(omega.ok);
    if (omega.ok) assert.deepEqual(omega.params.industries, ["Hospitals and Health Care", "Medical Practices"]);
    const peMeta = getleadsParamsFromFilters(
      {
        job_titles: ["Partner"],
        company_description: "private equity",
        icp_gate: { required: true, cut_labels: ["venture_capital_firm"] },
      },
      3763808,
      "BCP PE Firms (With Team)",
    );
    assert.ok(peMeta.ok, (peMeta as { error?: string }).error);
    if (peMeta.ok) assert.equal(peMeta.params.company_description, "private equity");
    const over = honorReceiptCountKeys({ job_titles: ["Partner"], over_1k_campaign: true });
    assert.ok(over.ok);
    if (over.ok) {
      assert.deepEqual(over.filters.company_size, [...OVER_1K_BANDS]);
      assert.equal(over.honored.over_1k_campaign, true);
    }
    const under = honorReceiptCountKeys({
      job_titles: ["Partner"],
      company_size: ["51 to 200", "1001 to 5000"],
      over_1k_campaign: false,
    });
    assert.ok(under.ok);
    if (under.ok) assert.deepEqual(under.filters.company_size, ["51 to 200"]);
  });

  it("D82 — title_match defaults to exact and refuses an unknown mode", () => {
    const def = getleadsParamsFromFilters({ job_titles: ["Partner"] });
    assert.ok(def.ok);
    if (def.ok) assert.equal(def.params.title_match, "exact");
    const sub = getleadsParamsFromFilters({ job_titles: ["Partner"], title_match: "substring" });
    assert.ok(sub.ok);
    if (sub.ok) assert.equal(sub.params.title_match, "substring");
    const alias = getleadsParamsFromFilters({ job_titles: ["Partner"], exact_title: false });
    assert.ok(alias.ok);
    if (alias.ok) assert.equal(alias.params.title_match, "substring");
    const bad = getleadsParamsFromFilters({ job_titles: ["Partner"], title_match: "fuzzy" });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.error, /D82/);
  });
});
