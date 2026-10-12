import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HeldRunner,
  classifyHeldExportError,
  heldExportError,
  heldExportSlices,
  heldRead,
  type HeldExportClass,
} from "./held.js";
import type { GetleadsFilters } from "../clients/getleads.js";

/** D80 / D95 / D97 — held is an exact full-list join. Never a sample or a lane total. Ask Josh. */

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
      checkExport: async () => ({
        job_status: "completed",
        export_url: "https://example.test/pool.csv",
        rows_exported: 3,
        rows_available: 3,
        cap_reason: null,
        cap_message: null,
      }),
    },
    rails: { record: async () => undefined },
    fetchText: async () => POOL_CSV,
    sleep: async () => undefined,
    now: () => 1,
    ...over,
  } as never;
}

describe("D95 / D97 — held exact full-list join", () => {
  it("joins the exported pool to the full held set and never scales", async () => {
    const r = await heldRead(deps(), {
      client_tag: "acme",
      smartlead_client_id: 1,
      campaign_ids: [7],
      filters: { job_titles: ["Partner"], company_description: "private equity" },
      tam: 3,
    });
    assert.equal(r.status, "done", r.last_error ?? r.note);
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
          checkExport: async () => ({
            job_status: "failed",
            export_url: null,
            rows_exported: null,
            rows_available: null,
            cap_reason: null,
            cap_message: null,
          }),
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
    assert.equal(r.status, "failed");
    assert.match(r.last_error ?? "", /exact full-list join/);
    assert.match(r.last_error ?? "", /export_failed/);
    assert.equal(r.error_class, "export_failed");
    assert.doesNotMatch(r.last_error ?? "", /lane total|sampled/);
  });

  it("polls every export_id from a split start", async () => {
    const seen: string[] = [];
    const r = await heldRead(
      deps({
        getleads: {
          startExport: async () => ({ export_id: "a", export_ids: ["a", "b"] }),
          checkExport: async (id: string) => {
            seen.push(id);
            return {
              job_status: "completed",
              export_url: `https://example.test/${id}.csv`,
              rows_exported: 2,
              rows_available: 2,
              cap_reason: null,
              cap_message: null,
            };
          },
        },
        fetchText: async (url: string) =>
          url.includes("/a.") ? "email\na@example.com\nb@example.com\n" : "email\nc@example.com\nd@example.com\n",
      }),
      {
        client_tag: "acme",
        smartlead_client_id: 1,
        campaign_ids: [7],
        filters: { job_titles: ["Partner"] },
        tam: 4,
      },
    );
    assert.equal(r.status, "done", r.last_error ?? r.note);
    assert.deepEqual([...seen].sort(), ["a", "b"]);
    assert.equal(r.held, 1);
    assert.equal(r.net_new, 3);
  });

  it("names a timeout when a slice outruns the per-slice deadline", async () => {
    let t = 0;
    const r = await heldRead(
      deps({
        now: () => {
          t += 200_000;
          return t;
        },
        getleads: {
          startExport: async () => ({ export_id: "slow" }),
          checkExport: async () => ({
            job_status: "running",
            export_url: null,
            rows_exported: null,
            rows_available: null,
            cap_reason: null,
            cap_message: null,
          }),
        },
      }),
      {
        client_tag: "acme",
        smartlead_client_id: 1,
        campaign_ids: [7],
        filters: { job_titles: ["Partner"] },
        tam: 1000,
      },
    );
    assert.equal(r.status, "failed");
    assert.equal(r.error_class, "timeout");
    assert.match(r.last_error ?? "", /timeout/);
    assert.match(r.last_error ?? "", /No fallback/);
  });

  it("returns a held_id at once and finishes in the background", async () => {
    const runner = new HeldRunner(deps());
    const started = await runner.start({
      client_tag: "acme",
      smartlead_client_id: 1,
      campaign_ids: [7],
      filters: { job_titles: ["Partner"], company_description: "private equity" },
      tam: 3,
    });
    assert.equal(started.status, "started");
    assert.ok(started.held_id);
    assert.equal(started.held, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const polled = await runner.get(started.held_id!);
    assert.ok(polled.status === "done" || polled.status === "started");
    if (polled.status === "done") {
      assert.equal(polled.held, 1);
      assert.equal(polled.net_new, 2);
    }
  });

  it("classifies export errors and never treats search_contacts as the path", () => {
    const cases: Array<[string, HeldExportClass]> = [
      ["Count timed out after 55s (count_timeout)", "count_timeout"],
      ["fair_use daily cap", "fair_use"],
      ["export deadline", "timeout"],
      ["job failed", "export_failed"],
      ["credits_exhausted on search_contacts", "paid_export"],
    ];
    for (const [message, klass] of cases) {
      assert.equal(classifyHeldExportError(message), klass, message);
      assert.match(heldExportError(klass), /No fallback/);
    }
    const src = heldExportSlices.toString() + classifyHeldExportError.toString();
    assert.doesNotMatch(src, /search_contacts/);
  });

  it("chunks a wide title list so each free export stays narrow", () => {
    const filters: GetleadsFilters = {
      job_titles: ["CIO", "CTO", "IT Director", "VP of IT", "Director of IT"],
      industries: ["Hospitals and Health Care"],
    };
    const slices = heldExportSlices(filters);
    assert.ok(slices.length >= 2);
    assert.ok(slices.every((slice) => (slice.job_titles ?? []).length <= 3));
    const titles = slices.flatMap((slice) => slice.job_titles ?? []);
    assert.equal(new Set(titles).size, 5);
  });

  it("D92 — receipt meta parses; a bucket key without a name fails with the stored keys", async () => {
    const pe = await heldRead(
      deps({
        db: {
          query: async (sql: string) => {
            if (sql.includes("from public.campaigns")) return { rows: [{ name: "PE Firms (With Team)" }] };
            if (sql.includes("to_regclass")) return { rows: [{ leads: true, sends: false, suppression: false }] };
            if (sql.includes("information_schema.columns")) return { rows: [{ n: "0" }] };
            if (sql.includes("select distinct e")) return { rows: [] };
            return { rows: [] };
          },
        },
      }),
      {
        client_tag: "acme",
        smartlead_client_id: 1,
        campaign_ids: [3763808],
        filters: {
          job_titles: ["Partner"],
          company_description: "private equity",
          icp_gate: { required: true, cut_labels: ["venture_capital_firm"] },
        },
        tam: 3,
      },
    );
    assert.equal(pe.status, "done", pe.last_error ?? pe.note);

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
    assert.equal(it.status, "failed");
    assert.match(it.last_error ?? "", /Stored keys: alpha, omega/);

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
    assert.equal(named.status, "done", named.last_error ?? named.note);
    assert.ok(Array.isArray(named.filters_applied.industries));
    assert.ok(named.filters_applied.industries_by_campaign);
  });
});
