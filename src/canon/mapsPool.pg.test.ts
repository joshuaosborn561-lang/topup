import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countMapsPool, mapsPoolFromFilters, resolveMapsPool } from "./mapsPool.js";

/**
 * D59 — the ICP path must survive a real Postgres bind, not a mock.
 * PGlite is Postgres. The live emcor count is a read-only check in the PR,
 * not a test (D4: tests do not construct Db).
 */

type Q = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (text: string) => Promise<unknown>;
};

async function pgliteDb(): Promise<{ db: Q; close: () => Promise<void> }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const db: Q = {
    query: async (text, values) => {
      const r = values?.length ? await pg.query(text, values) : await pg.query(text);
      return { rows: r.rows as unknown[] };
    },
    exec: (text) => pg.exec(text),
  };
  return { db, close: () => pg.close() };
}

async function seedLane(db: Q): Promise<void> {
  await db.exec(`
    create schema client_t;
    create table client_t.maps_raw (
      place_id text, plan_id text, main_category text, name text
    );
    create view client_t.v_lane_e_final as
      select *, true as keep_final from client_t.maps_raw;
    create view client_t.v_lane_e_companies as
      select place_id, name, main_category from client_t.maps_raw
       where place_id in ('a', 'b');
    create view client_t.v_lane_e_needs_domain as
      select place_id, main_category from client_t.maps_raw
       where place_id = 'c';
    insert into client_t.maps_raw (place_id, plan_id, main_category, name) values
      ('a', 'custom-1', 'church', 'A'),
      ('b', 'custom-1', 'hotel', 'B'),
      ('c', 'custom-1', 'church', 'C'),
      ('d', 'other', 'church', 'D');
  `);
}

describe("D59 — maps ICP against real Postgres", () => {
  it("Postgres rejects $2 when $1 is unused and untyped (the live failure)", async () => {
    const { db, close } = await pgliteDb();
    try {
      await assert.rejects(
        () => db.query(
          "select count(*)::text as n from (select 1 as place_id where $2::text[] is not null) pool",
          ["custom-1", ["church"]],
        ),
        (err: Error) => /could not determine data type of parameter \$1/.test(err.message),
      );
    } finally {
      await close();
    }
  });

  it("countMapsPool on companions without plan_id binds $1::text and counts the union", async () => {
    const { db, close } = await pgliteDb();
    try {
      await seedLane(db);
      const spec = mapsPoolFromFilters(
        { plan_id: "custom-1", categories: ["church", "hotel"], icp_filter: "client_t.v_lane_e_final" },
        "t",
      );
      assert.ok(!("error" in spec));
      if ("error" in spec) return;
      const resolved = await resolveMapsPool(db, "t", spec);
      assert.ok(!("error" in resolved));
      if ("error" in resolved) return;
      assert.match(resolved.fromSql, /\$1::text/);
      assert.doesNotMatch(resolved.fromSql, /\$2/);
      await db.query(`prepare icp_ok as select count(*)::text as n from ${resolved.fromSql}`);
      const r = await countMapsPool(db, "t", {
        plan_id: "custom-1",
        categories: ["church", "hotel"],
        icp_filter: "client_t.v_lane_e_final",
      });
      assert.ok(!("error" in r), "D59: ICP count must not fail on real Postgres. Ask Josh.");
      if ("error" in r) return;
      assert.equal(r.pool, 3, "D59: a,b,c on this plan; d is another plan_id");
      assert.equal(r.already_used, 0);
      assert.equal(r.net_new, 3);
    } finally {
      await close();
    }
  });
});
