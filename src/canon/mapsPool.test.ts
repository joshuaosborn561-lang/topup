import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countMapsPool, icpViewOf, mapsPoolFromFilters, MAPS_NEEDS_PLAN } from "./mapsPool.js";

/** D57 — maps pool is scoped by plan_id. Ask Josh. */

function fakeDb(opts: { pool?: number; used?: number; live?: number; ingested?: number; contacted?: number; tables?: string[]; columns?: Record<string, string[]> }) {
  const seen: string[] = [];
  const tables = new Set(opts.tables ?? ["maps_raw", "v_lane_e_final", "v_lane_e_companies", "v_lane_e_needs_domain"]);
  const columns = opts.columns ?? {
    maps_raw: ["place_id", "plan_id", "main_category", "source_category"],
    v_lane_e_final: ["place_id", "plan_id", "main_category", "keep_final"],
    v_lane_e_companies: ["place_id", "plan_id"],
    v_lane_e_needs_domain: ["place_id", "plan_id"],
  };
  const db = {
    seen,
    query: async (text: string, params?: unknown[]) => {
      seen.push(text);
      if (text.includes("from information_schema.tables")) {
        const name = String(params?.[1] ?? "");
        return { rows: [{ n: tables.has(name) ? "1" : "0" }] };
      }
      if (text.includes("from information_schema.columns")) {
        const name = String(params?.[1] ?? "");
        return { rows: (columns[name] ?? []).map((column_name) => ({ column_name })) };
      }
      if (text.includes("already_ingested")) {
        return {
          rows: [
            {
              already_live: String(opts.live ?? opts.used ?? 0),
              already_ingested: String(opts.ingested ?? 0),
              already_contacted: String(opts.contacted ?? 0),
              already_used: String(opts.used ?? 0),
            },
          ],
        };
      }
      if (text.includes("from public.leads")) return { rows: [{ n: String(opts.used ?? 0) }] };
      if (text.startsWith("select count(*)::text as n")) return { rows: [{ n: String(opts.pool ?? 0) }] };
      return { rows: [] };
    },
  };
  return db;
}

const laneE = {
  plan_id: "custom-1789679826",
  categories: ["church", "hotel"],
  icp_filter: "client_emcor.v_lane_e_final (SQL rules, no LLM): in CA",
  zips: "404 ZIPs across 22 counties",
  states: [],
};

describe("D57 — maps stored pool", () => {
  it("keeps plan_id and the named ICP view, and drops zips and states", () => {
    const spec = mapsPoolFromFilters(laneE, "emcor");
    assert.ok(!("error" in spec));
    if ("error" in spec) return;
    assert.equal(spec.plan_id, "custom-1789679826");
    assert.deepEqual(spec.categories, ["church", "hotel"]);
    assert.equal(spec.icp_view, "v_lane_e_final");
    assert.equal(icpViewOf(laneE, "emcor"), "v_lane_e_final");
  });

  it("refuses a count with no plan_id instead of scoping by client_tag or ZIP", () => {
    const spec = mapsPoolFromFilters({ categories: ["church"], states: ["CA"], zips: ["94107"] }, "emcor");
    assert.ok("error" in spec && spec.error === MAPS_NEEDS_PLAN);
  });

  it("counts the stored pool and is not zero when rows exist; SQL keeps plan_id and never selects a lead column", async () => {
    const db = fakeDb({ pool: 18322, used: 5985 });
    const r = await countMapsPool(db as never, "emcor", laneE);
    assert.ok(!("error" in r));
    if ("error" in r) return;
    assert.equal(r.pool, 18322);
    assert.equal(r.already_used, 5985);
    assert.equal(r.already_live, 5985);
    assert.equal(r.already_ingested, 0);
    assert.equal(r.already_contacted, 0);
    assert.equal(r.net_new, 12337);
    assert.equal(r.filters_used.plan_id, "custom-1789679826");
    assert.deepEqual(r.filters_used.categories, ["church", "hotel"]);
    assert.equal(r.filters_used.icp_view, "v_lane_e_final");
    assert.notEqual(r.pool, 0, "D57: count must not be 0 when the stored pool exists");
    const sql = db.seen.join("\n");
    assert.match(sql, /plan_id/, "D57: plan_id scoping must not be dropped");
    assert.doesNotMatch(sql, /pipeline_stats/);
    const poolSql = db.seen.filter((q) => q.includes("union") || q.includes("maps_raw") || q.includes("v_lane")).join("\n");
    assert.doesNotMatch(poolSql, /\b(state|zip|source_zip|client_tag)\b\s*=/, "D57: must not scope by ZIP or client_tag");
    for (const q of db.seen) {
      if (q.includes("information_schema")) continue;
      assert.doesNotMatch(q, /select\s+(email|first_name|last_name|phone|linkedin_url)\b/i, `D2/D57: ${q.slice(0, 80)}`);
    }
  });

  it("companions without plan_id still keep plan_id via a maps_raw join", async () => {
    const db = fakeDb({
      pool: 18322,
      used: 6017,
      columns: {
        maps_raw: ["place_id", "plan_id", "main_category"],
        v_lane_e_final: ["place_id", "plan_id", "main_category", "keep_final"],
        v_lane_e_companies: ["place_id", "main_category"],
        v_lane_e_needs_domain: ["place_id", "main_category"],
      },
    });
    const r = await countMapsPool(db as never, "emcor", laneE);
    assert.ok(!("error" in r));
    if ("error" in r) return;
    const poolSql = db.seen.filter((q) => q.includes("union")).join("\n");
    assert.match(poolSql, /maps_raw/, "D59: companions without plan_id join maps_raw");
    assert.match(poolSql, /\$1::text/, "D59: the plan_id bind is typed");
    assert.match(poolSql, /\$2::text\[\]/, "D68: categories bind as $2 after typed $1. Ask Josh.");
    assert.equal(r.already_used, 6017);
  });

  it("used is the union of live, ingested and contacted when maps_raw has email (D64)", async () => {
    const db = fakeDb({
      pool: 18322,
      used: 2473,
      live: 600,
      ingested: 1185,
      contacted: 473,
      columns: {
        maps_raw: ["place_id", "plan_id", "main_category", "email"],
        v_lane_e_final: ["place_id", "plan_id", "main_category", "keep_final"],
        v_lane_e_companies: ["place_id", "plan_id"],
        v_lane_e_needs_domain: ["place_id", "plan_id"],
      },
    });
    const r = await countMapsPool(db as never, "emcor", laneE);
    assert.ok(!("error" in r));
    if ("error" in r) return;
    assert.equal(r.already_live, 600);
    assert.equal(r.already_ingested, 1185);
    assert.equal(r.already_contacted, 473);
    assert.equal(r.already_used, 2473);
    assert.equal(r.net_new, 15849);
    assert.ok(db.seen.some((q) => q.includes("already_ingested")), "D64: count must ask for ingested and contacted components. Ask Josh.");
  });
});
