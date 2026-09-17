import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "./config.js";
import { REQUIRED_TOPUP_TABLES, buildHealth } from "./health.js";

/** D34 — /health is not ok while required topup tables are missing. */

describe("health — D34 required tables", () => {
  it("names the tables a run needs before the first unattended pull", () => {
    for (const t of [
      "topup.qa_rules",
      "topup.ref_cities",
      "topup.ref_acronyms",
      "topup.campaign_registry",
      "topup.client_domain_blocklist",
      "topup.client_domain_list_state",
      "topup.mx_class",
      "topup.lane_state",
      "topup.runs",
      "topup.spend_ledger",
      "topup.pull_receipts",
      "topup.company_size_cache",
      "topup.lane_exclusions",
      "topup.run_reasoning",
    ]) {
      assert.ok(REQUIRED_TOPUP_TABLES.includes(t as (typeof REQUIRED_TOPUP_TABLES)[number]), t);
    }
  });

  it("returns ok:false and missing_tables when the repo reports a gap", async () => {
    const cfg = loadConfig({});
    const body = await buildHealth({
      cfg,
      repo: {
        raw: () => ({ ping: async () => true }),
        missingTopupTables: async () => ["topup.qa_rules", "topup.campaign_registry"],
      } as never,
      rails: null,
      recipes: ["parlay.it_dm.v3"],
    });
    assert.equal(body.ok, false);
    assert.deepEqual(body.missing_tables, ["topup.qa_rules", "topup.campaign_registry"]);
  });
});
