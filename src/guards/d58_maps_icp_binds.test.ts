import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { mapsPoolFromFilters, resolveMapsPool } from "../canon/mapsPool.js";

/**
 * D58 — maps ICP SQL types every bind. Companions without plan_id join
 * maps_raw so $1::text is used. Ask Josh before sending $2 without $1.
 */

const root = new URL("../../", import.meta.url);

function fakeDb(columns: Record<string, string[]>) {
  const tables = new Set(Object.keys(columns));
  const seen: { text: string; params?: unknown[] }[] = [];
  return {
    seen,
    query: async (text: string, params?: unknown[]) => {
      seen.push({ text, params });
      if (text.includes("from information_schema.tables")) {
        const name = String(params?.[1] ?? "");
        return { rows: [{ n: tables.has(name) ? "1" : "0" }] };
      }
      if (text.includes("from information_schema.columns")) {
        const name = String(params?.[1] ?? "");
        return { rows: (columns[name] ?? []).map((column_name) => ({ column_name })) };
      }
      return { rows: [] };
    },
  };
}

describe("D58 — maps ICP binds are typed", () => {
  it("companion views without plan_id join maps_raw and type $1 as text", async () => {
    const db = fakeDb({
      maps_raw: ["place_id", "plan_id", "main_category"],
      v_lane_e_final: ["place_id", "plan_id", "main_category", "keep_final"],
      v_lane_e_companies: ["place_id", "main_category"],
      v_lane_e_needs_domain: ["place_id", "main_category"],
    });
    const spec = mapsPoolFromFilters(
      { plan_id: "custom-1789679826", categories: ["church", "hotel"], icp_filter: "client_emcor.v_lane_e_final" },
      "emcor",
    );
    assert.ok(!("error" in spec));
    if ("error" in spec) return;
    const resolved = await resolveMapsPool(db, "emcor", spec);
    assert.ok(!("error" in resolved), "D58: companion ICP must resolve. Ask Josh.");
    if ("error" in resolved) return;
    assert.match(resolved.fromSql, /maps_raw/, "D58: companions without plan_id join maps_raw. Ask Josh.");
    assert.match(resolved.fromSql, /\$1::text/, "D58: plan_id bind must be $1::text. Ask Josh.");
    assert.doesNotMatch(resolved.fromSql, /\$2/, "D58: must not send $2 when $1 was the unused plan_id. Ask Josh.");
    assert.deepEqual(resolved.params, ["custom-1789679826"]);
    assert.equal(resolved.companion, true);
  });

  it("the pool source types $1 and joins maps_raw on the companion path", async () => {
    const pool = await readFile(new URL("src/canon/mapsPool.ts", root), "utf8");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(pool, /\$1::text/, "D58: mapsPool must type the plan_id bind. Ask Josh.");
    assert.match(pool, /join \$\{q\(schema\)\}\.\$\{q\("maps_raw"\)\}/, "D58: companions join maps_raw. Ask Josh.");
    assert.match(canon, /\$1::text/, "D58: CANON.md must say the ICP bind is typed. Ask Josh.");
  });
});
