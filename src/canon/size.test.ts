import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sizeRead } from "./size.js";

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
    assert.ok(!db.seen.some((q) => /insert into|update /i.test(q)), "D64: size must not write. Ask Josh.");
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
