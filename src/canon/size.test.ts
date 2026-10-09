import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SizeRunner, sizeRead, sizeSuppressJoinSql } from "./size.js";

/** D64 — size is a free maps dry-run. Opens no job. Ask Josh. */

function fakeDb() {
  const seen: string[] = [];
  return {
    seen,
    query: async (text: string) => {
      seen.push(text);
      if (text.includes("information_schema.tables")) return { rows: [{ n: "1" }] };
      if (text.includes("information_schema.columns")) {
        return { rows: ["place_id", "plan_id", "main_category"].map((column_name) => ({ column_name })) };
      }
      if (text.includes("from public.leads")) return { rows: [{ n: "10" }] };
      if (text.startsWith("select count(*)::text as n")) return { rows: [{ n: "18322" }] };
      if (text.includes("to_regclass")) return { rows: [{ leads: false, sends: false, suppression: false, campaigns: false }] };
      return { rows: [] };
    },
  };
}

describe("D64 — size dry-run", () => {
  it("walks the maps pool, spends nothing, and opens no job", async () => {
    const db = fakeDb();
    const r = await sizeRead(db as never, {
      client_tag: "emcor",
      campaign_id: 4037475,
      source: "maps",
      filters: { plan_id: "custom-1789679826", categories: ["church"] },
    });
    assert.equal(r.cost_cents, 0);
    assert.equal(r.job_id, null);
    assert.equal(r.pool, 18322);
    assert.equal(r.already_used, 10);
    assert.match(r.note, /net new/);
    assert.equal(r.status, "done");
    assert.equal(r.job_id, null);
    assert.ok(!db.seen.some((q) => /insert into topup\.runs|update topup\.runs/i.test(q)), "D64: size must not open a job. Ask Josh.");
  });

  it("returns a size_id at once and the suppress SQL is an aggregate join (D65)", async () => {
    const sql = sizeSuppressJoinSql({ schema: "client_emcor", fromSql: "client_emcor.maps_raw pool", params: [], cats: [], companion: false }, '"lp"."emcor_ingested_leads"', []);
    assert.match(sql, /left join pos/, "D65: suppress is a join, not a per-email exists. Ask Josh.");
    assert.match(sql, /left join dnc/);
    assert.match(sql, /count\(\*\)::text as n from classified/);
    assert.doesNotMatch(sql, /when exists \(select 1 from public\.leads l where lower\(l\.email\) = r\.e/, "D65: no correlated exists per email. Ask Josh.");
    const runner = new SizeRunner(fakeDb() as never);
    const started = await runner.start({
      client_tag: "emcor",
      campaign_id: 4037475,
      source: "maps",
      filters: { plan_id: "custom-1789679826" },
    });
    assert.equal(started.status, "started");
    assert.ok(started.size_id);
    assert.equal(started.job_id, null);
    assert.equal(started.cost_cents, 0);
    await new Promise((r) => setTimeout(r, 20));
    const polled = await runner.get(started.size_id!);
    assert.ok(polled.status === "done" || polled.status === "started");
  });

  it("refuses a non-maps source instead of inventing a job", async () => {
    const r = await sizeRead(fakeDb() as never, {
      client_tag: "bcp",
      campaign_id: 1,
      source: "getleads",
      filters: { job_titles: ["CIO"] },
    });
    assert.equal(r.pool, null);
    assert.match(r.note, /count \+ held/);
  });
});
