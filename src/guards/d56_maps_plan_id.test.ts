import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { countSource } from "../canon/count.js";
import { mapsPoolFromFilters } from "../canon/mapsPool.js";

/**
 * D56 — maps count/pull read client_<tag>.maps_raw scoped by plan_id.
 * plan_id must not be dropped; count must not be 0 when the stored
 * pool exists. Ask Josh before scoping by ZIP or client_tag alone.
 */

const root = new URL("../../", import.meta.url);

describe("D56 — maps stored pool is scoped by plan_id", () => {
  it("dropping plan_id is a refusal, not a client_tag or ZIP count", () => {
    const spec = mapsPoolFromFilters({ categories: ["church"], states: ["CA"], zips: ["94107"] }, "emcor");
    assert.ok("error" in spec && /plan_id/.test(spec.error), "D56: a maps count without plan_id must refuse. Ask Josh.");
  });

  it("count keeps plan_id on filters_used and is not 0 when the stored pool exists", async () => {
    const db = {
      query: async (text: string) => {
        if (text.includes("information_schema.tables")) return { rows: [{ n: "1" }] };
        if (text.includes("information_schema.columns")) {
          return { rows: ["place_id", "plan_id", "main_category"].map((column_name) => ({ column_name })) };
        }
        if (text.includes("from public.leads")) return { rows: [{ n: "5985" }] };
        if (text.startsWith("select count(*)::text as n")) return { rows: [{ n: "18322" }] };
        return { rows: [] };
      },
    };
    const r = await countSource(
      {
        getleads: { count: async () => ({ total_matching: 0 }) },
        aiArk: null,
        maps: { scopedBusinesses: async () => 0 },
        permits: null,
        rails: { gate: async () => ({ kind: "proceed", worstCaseCents: 0 }), record: async () => undefined },
        db,
      } as never,
      { client_tag: "emcor", source: "maps", filters: { plan_id: "custom-1789679826", categories: ["church"] } },
    );
    assert.equal(r.filters_used.plan_id, "custom-1789679826", "D56: plan_id scoping must not be dropped. Ask Josh.");
    assert.equal(r.count, 18322, "D56: count must not be 0 when the stored pool exists. Ask Josh.");
    assert.notEqual(r.count, 0);
    assert.equal(r.already_used, 5985);
    assert.ok(!r.calls.some((c) => c.action === "pipeline_stats"), "D56: count must not call pipeline_stats. Ask Josh.");
  });

  it("the count and pull sources read maps_raw, keep plan_id, and do not write skip columns", async () => {
    const count = await readFile(new URL("src/canon/count.ts", root), "utf8");
    const pool = await readFile(new URL("src/canon/mapsPool.ts", root), "utf8");
    const pull = await readFile(new URL("src/stages/pull/maps.ts", root), "utf8");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(count, /countMapsPool/, "D56: count must read the stored pool. Ask Josh.");
    assert.doesNotMatch(count, /pipeline_stats/, "D56: count must not call pipeline_stats. Ask Josh.");
    assert.match(pool, /maps_raw/, "D56: the pool is client_<tag>.maps_raw. Ask Josh.");
    assert.match(pool, /plan_id/, "D56: plan_id scoping must not be dropped. Ask Josh.");
    assert.doesNotMatch(pool, /\b(update|insert)\b[\s\S]*\b(dl_status|sg_exclude|skip_)/i, "D56: never write dl_status, sg_exclude, or skip_*. Ask Josh.");
    assert.match(pull, /copyMapsPool|maps_raw/, "D56: pull must read the stored pool. Ask Josh.");
    assert.doesNotMatch(pull, /sync_to_supabase|pipeline_stats/, "D56: pull must not call the Maps scraper for the stored pool. Ask Josh.");
    assert.match(canon, /plan_id/, "D56: CANON.md must say maps is scoped by plan_id. Ask Josh.");
  });
});
