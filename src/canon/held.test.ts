import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { heldRead, scaleOverlap } from "./held.js";

/** D74 — net_new is the pool minus held; the note says so. Ask Josh. */

describe("D74 — held net_new", () => {
  it("scaleOverlap is pool minus the matched share, capped at the pool", () => {
    assert.deepEqual(scaleOverlap(1000, 1000, 200), { held: 200, method: "overlap" });
    assert.deepEqual(scaleOverlap(10_000, 100, 25), { held: 2500, method: "sample" });
    assert.equal(Math.max(0, 10_000 - 2500), 7500);
    assert.deepEqual(scaleOverlap(100, 200, 150), { held: 100, method: "overlap" });
  });

  it("the note names the subtraction and never says the client total was not subtracted", async () => {
    const r = await heldRead(
      {
        db: { query: async () => ({ rows: [{ n: "0" }] }) },
        getleads: {
          startExport: async () => ({ export_id: "x" }),
          checkExport: async () => ({ job_status: "failed", export_url: null, rows_exported: null, rows_available: null, cap_reason: null, cap_message: null }),
        },
        rails: { record: async () => undefined },
        fetchText: async () => "",
        sleep: async () => undefined,
        now: () => 0,
      } as never,
      { client_tag: "bcp", smartlead_client_id: 1, campaign_ids: [7], filters: { job_titles: ["Partner"], company_description: "private equity" }, tam: 453838 },
    );
    assert.ok(!("error" in r), (r as { error?: string }).error);
    assert.equal(r.net_new, Math.max(0, r.tam - r.held));
    assert.match(r.note, /net_new is the pool minus/);
    assert.doesNotMatch(r.note, /was not subtracted/);
    assert.equal(r.filters_used.company_description, "private equity");
  });

  it("D92 — PE icp_gate is receipt meta; held parses. IT buckets without a name fail with the stored keys", async () => {
    const deps = {
      db: { query: async (sql: string) => {
        if (sql.includes("from public.campaigns")) return { rows: [{ name: "BCP PE Firms (With Team)" }] };
        return { rows: [{ n: "0" }] };
      } },
      getleads: {
        startExport: async () => ({ export_id: "x" }),
        checkExport: async () => ({ job_status: "failed", export_url: null, rows_exported: null, rows_available: null, cap_reason: null, cap_message: null }),
      },
      rails: { record: async () => undefined },
      fetchText: async () => "",
      sleep: async () => undefined,
      now: () => 0,
    } as never;
    const pe = await heldRead(deps, {
      client_tag: "bcp",
      smartlead_client_id: 542838,
      campaign_ids: [3763808],
      filters: {
        job_titles: ["Partner"],
        company_description: "private equity",
        icp_gate: { required: true, cut_labels: ["venture_capital_firm"] },
      },
      tam: 10000,
    });
    assert.ok(!("error" in pe), (pe as { error?: string }).error);

    const it = await heldRead(
      {
        ...deps,
        db: { query: async () => ({ rows: [{ name: null }] }) },
      } as never,
      {
        client_tag: "bcp",
        smartlead_client_id: 542838,
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

    const named = await heldRead(
      {
        ...deps,
        db: { query: async (sql: string) => {
          if (sql.includes("from public.campaigns")) return { rows: [{ name: "North Alpha IT" }] };
          return { rows: [{ n: "0" }] };
        } },
      } as never,
      {
        client_tag: "bcp",
        smartlead_client_id: 542838,
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
    assert.ok(!("error" in named), (named as { error?: string }).error);
  });
});
