import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { heldRead } from "./held.js";

/** D80 / D95 — held is an exact full-list join. Never a sample or a lane total. Ask Josh. */

const POOL_CSV = "email\na@example.com\nb@example.com\nc@example.com\n";

function deps(over: Record<string, unknown> = {}) {
  return {
    db: {
      query: async (sql: string) => {
        if (sql.includes("from public.campaigns")) return { rows: [{ name: "North Alpha IT" }] };
        if (sql.includes("to_regclass")) return { rows: [{ leads: true, sends: true, suppression: true }] };
        if (sql.includes("information_schema.columns")) return { rows: [{ n: "1" }] };
        if (sql.includes("select distinct e")) return { rows: [{ e: "a@example.com" }, { e: "z@example.com" }] };
        return { rows: [] };
      },
    },
    getleads: {
      startExport: async () => ({ export_id: "x" }),
      checkExport: async () => ({ job_status: "completed", export_url: "https://example.test/pool.csv", rows_exported: 3, rows_available: 3, cap_reason: null, cap_message: null }),
    },
    rails: { record: async () => undefined },
    fetchText: async () => POOL_CSV,
    sleep: async () => undefined,
    now: () => 1,
    ...over,
  } as never;
}

describe("D95 — held exact full-list join", () => {
  it("joins the exported pool to the full held set and never scales", async () => {
    const r = await heldRead(deps(), {
      client_tag: "acme",
      smartlead_client_id: 1,
      campaign_ids: [7],
      filters: { job_titles: ["Partner"], company_description: "private equity" },
      tam: 3,
    });
    assert.ok(!("error" in r), (r as { error?: string }).error);
    assert.equal(r.held, 1);
    assert.equal(r.net_new, 2);
    assert.equal(r.filters_applied.company_description, "private equity");
    assert.deepEqual(r.filters_applied.job_titles, ["Partner"]);
    assert.match(r.note, /exact full-list join/);
    assert.doesNotMatch(r.note, /sampled|lane total|scaled/);
    assert.ok(!("sampled" in r) && !("method" in r));
  });

  it("refuses a sample or lane-total fallback when the pool cannot be exported", async () => {
    const r = await heldRead(
      deps({
        getleads: {
          startExport: async () => ({ export_id: "x" }),
          checkExport: async () => ({ job_status: "failed", export_url: null, rows_exported: null, rows_available: null, cap_reason: null, cap_message: null }),
        },
      }),
      {
        client_tag: "acme",
        smartlead_client_id: 1,
        campaign_ids: [7],
        filters: { job_titles: ["Partner"], company_description: "private equity" },
        tam: 18223,
      },
    );
    assert.ok("error" in r);
    assert.match(r.error, /exact full-list join/);
    assert.doesNotMatch(r.error, /lane total|sampled/);
  });

  it("D92 — receipt meta parses; a bucket key without a name fails with the stored keys", async () => {
    const pe = await heldRead(deps({
      db: {
        query: async (sql: string) => {
          if (sql.includes("from public.campaigns")) return { rows: [{ name: "PE Firms (With Team)" }] };
          if (sql.includes("to_regclass")) return { rows: [{ leads: true, sends: false, suppression: false }] };
          if (sql.includes("information_schema.columns")) return { rows: [{ n: "0" }] };
          if (sql.includes("select distinct e")) return { rows: [] };
          return { rows: [] };
        },
      },
    }), {
      client_tag: "acme",
      smartlead_client_id: 1,
      campaign_ids: [3763808],
      filters: {
        job_titles: ["Partner"],
        company_description: "private equity",
        icp_gate: { required: true, cut_labels: ["venture_capital_firm"] },
      },
      tam: 3,
    });
    assert.ok(!("error" in pe), (pe as { error?: string }).error);

    const it = await heldRead(
      deps({
        db: { query: async () => ({ rows: [{ name: null }] }) },
      }),
      {
        client_tag: "acme",
        smartlead_client_id: 1,
        campaign_ids: [3921852],
        filters: {
          job_titles: ["CIO"],
          industries_by_campaign: {
            alpha: ["Transportation, Logistics, Supply Chain and Storage"],
            omega: ["Hospitals and Health Care"],
          },
        },
        tam: 1000,
      },
    );
    assert.ok("error" in it);
    assert.match(it.error, /Stored keys: alpha, omega/);

    const named = await heldRead(deps(), {
      client_tag: "acme",
      smartlead_client_id: 1,
      campaign_ids: [3921852],
      filters: {
        job_titles: ["CIO"],
        industries_by_campaign: {
          alpha: ["Transportation, Logistics, Supply Chain and Storage"],
          omega: ["Hospitals and Health Care"],
        },
      },
      tam: 3,
    });
    assert.ok(!("error" in named), (named as { error?: string }).error);
    assert.ok(Array.isArray(named.filters_applied.industries));
    assert.ok(named.filters_applied.industries_by_campaign);
  });
});
