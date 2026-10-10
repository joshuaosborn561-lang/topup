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
});
