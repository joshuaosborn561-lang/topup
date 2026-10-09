import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { copyMapsPool, countMapsPool, mapsPoolFromFilters, resolveMapsPool } from "./mapsPool.js";

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

describe("D61 — maps copy is idempotent on email", () => {
  it("dedupes the batch and skips emails already in the ingest table", async () => {
    const { db, close } = await pgliteDb();
    try {
      await db.exec(`
        create schema client_t;
        create schema lp;
        create table client_t.maps_raw (
          place_id text, plan_id text, main_category text, name text, email text, domain text
        );
        create table lp.t_ingested_leads (
          id serial primary key,
          email text,
          company_name text,
          company_domain text,
          industry text,
          source_label text
        );
        create unique index t_ingested_leads_email_uidx on lp.t_ingested_leads (email);
        insert into lp.t_ingested_leads (email, company_name) values ('held@example.test', 'Old');
        insert into client_t.maps_raw (place_id, plan_id, main_category, name, email, domain) values
          ('a', 'custom-1', 'church', 'A', 'held@example.test', 'a.example'),
          ('b', 'custom-1', 'church', 'B', 'new@example.test', 'b.example'),
          ('c', 'custom-1', 'church', 'C', 'new@example.test', 'c.example'),
          ('d', 'custom-1', 'church', 'D', 'fresh@example.test', 'd.example');
      `);
      const withRun = async <T>(_id: string, fn: (tx: typeof db) => Promise<T>) => fn(db);
      const copied = await copyMapsPool({ ...db, withRun } as never, {
        client_tag: "t",
        filters: { plan_id: "custom-1", categories: ["church"] },
        max_rows: 4,
        source_label: "fixture",
        run_id: "00000000-0000-0000-0000-000000000001",
      });
      assert.equal(copied.inserted, 2, "D61: two new emails insert; the held one and the batch dup do not. Ask Josh.");
      assert.equal(copied.already_held, 2, "D61: the existing email and the in-batch dup are already_held. Ask Josh.");
      const again = await copyMapsPool({ ...db, withRun } as never, {
        client_tag: "t",
        filters: { plan_id: "custom-1", categories: ["church"] },
        max_rows: 4,
        source_label: "fixture-2",
        run_id: "00000000-0000-0000-0000-000000000002",
      });
      assert.equal(again.inserted, 0, "D61: a second copy of the same emails inserts nothing. Ask Josh.");
      assert.equal(again.already_held, 4);
    } finally {
      await close();
    }
  });
});
