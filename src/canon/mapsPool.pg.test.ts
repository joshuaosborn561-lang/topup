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
      assert.match(resolved.fromSql, /\$2::text\[\]/);
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

  it("lane E ICP re-applies main_category and drops preschool–high school (D68)", async () => {
    const { db, close } = await pgliteDb();
    try {
      await seedLane(db);
      await db.exec(`insert into client_t.maps_raw (place_id, plan_id, main_category, name) values
        ('e', 'custom-1', 'private school', 'E'),
        ('f', 'custom-1', 'church', 'Lincoln Elementary School');`);
      await db.exec(`
        create or replace view client_t.v_lane_e_companies as
          select place_id, name, main_category from client_t.maps_raw
           where place_id in ('a', 'b', 'e', 'f');
      `);
      const r = await countMapsPool(db, "t", {
        plan_id: "custom-1",
        categories: ["church", "hotel", "private school"],
        icp_filter: "client_t.v_lane_e_final",
      });
      assert.ok(!("error" in r), "D68: ICP count must still bind. Ask Josh.");
      if ("error" in r) return;
      assert.equal(r.pool, 3, "D68: a,b,c stay; private school and elementary name drop. Ask Josh.");
    } finally {
      await close();
    }
  });
});

async function withTx<T>(db: Q, fn: (tx: Q) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    const out = await fn(db);
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback").catch(() => undefined);
    throw err;
  }
}

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
      const withRun = async <T>(_id: string, fn: (tx: typeof db) => Promise<T>) => withTx(db, fn);
      const copied = await copyMapsPool({ ...db, withRun } as never, {
        client_tag: "t",
        filters: { plan_id: "custom-1", categories: ["church"] },
        max_rows: 4,
        source_label: "fixture",
        run_id: "00000000-0000-0000-0000-000000000001",
      });
      assert.equal(copied.inserted, 2, "D61: two new emails insert; the held one and the batch dup do not. Ask Josh.");
      assert.equal(copied.already_held, 1, "D64: already_held is dest∩pool before insert (the one existing email). Ask Josh.");
      const again = await copyMapsPool({ ...db, withRun } as never, {
        client_tag: "t",
        filters: { plan_id: "custom-1", categories: ["church"] },
        max_rows: 4,
        source_label: "fixture-2",
        run_id: "00000000-0000-0000-0000-000000000002",
      });
      assert.equal(again.inserted, 0, "D61: a second copy of the same emails inserts nothing. Ask Josh.");
      assert.equal(again.already_held, 3, "D64: dest now holds the three distinct pool emails.");
    } finally {
      await close();
    }
  });
});

describe("D62 — maps copy times out and dedupes without a unique index", () => {
  it("skips already-held emails when the ingest table has no unique email index", async () => {
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
        insert into lp.t_ingested_leads (email, company_name) values ('held@example.test', 'Old');
        insert into client_t.maps_raw (place_id, plan_id, main_category, name, email, domain) values
          ('a', 'custom-1', 'church', 'A', 'held@example.test', 'a.example'),
          ('b', 'custom-1', 'church', 'B', 'new@example.test', 'b.example'),
          ('c', 'custom-1', 'church', 'C', 'new@example.test', 'c.example');
      `);
      const withRun = async <T>(_id: string, fn: (tx: typeof db) => Promise<T>) => withTx(db, fn);
      const copied = await copyMapsPool({ ...db, withRun } as never, {
        client_tag: "t",
        filters: { plan_id: "custom-1", categories: ["church"] },
        max_rows: 3,
        source_label: "fixture",
        run_id: "00000000-0000-0000-0000-000000000003",
      });
      assert.equal(copied.inserted, 1, "D62: NOT EXISTS skips the held email without a unique index. Ask Josh.");
      assert.equal(copied.already_held, 1, "D64: dest∩pool before insert is the one held email.");
    } finally {
      await close();
    }
  });

  it("copies from the named ICP view and never joins companion views", async () => {
    const { db, close } = await pgliteDb();
    try {
      await db.exec(`
        create schema client_t;
        create schema lp;
        create table client_t.maps_raw (
          place_id text, plan_id text, main_category text, name text, email text, domain text
        );
        create view client_t.v_lane_e_final as
          select *, true as keep_final from client_t.maps_raw;
        create view client_t.v_lane_e_companies as
          select place_id from client_t.maps_raw where place_id = 'never-used';
        create view client_t.v_lane_e_needs_domain as
          select place_id from client_t.maps_raw where place_id = 'never-used';
        create table lp.t_ingested_leads (
          id serial primary key, email text, company_name text, company_domain text, industry text, source_label text
        );
        insert into client_t.maps_raw (place_id, plan_id, main_category, name, email, domain) values
          ('a', 'custom-1', 'church', 'A', 'a@example.test', 'a.example');
      `);
      const seen: string[] = [];
      const wrapped: Q = {
        query: async (text, values) => {
          seen.push(text);
          return db.query(text, values);
        },
        exec: db.exec,
      };
      const withRun = async <T>(_id: string, fn: (tx: Q) => Promise<T>) => withTx(wrapped, fn);
      const copied = await copyMapsPool({ ...wrapped, withRun } as never, {
        client_tag: "t",
        filters: { plan_id: "custom-1", categories: ["church"], icp_filter: "client_t.v_lane_e_final" },
        max_rows: 1,
        source_label: "fixture",
        run_id: "00000000-0000-0000-0000-000000000004",
      });
      assert.equal(copied.inserted, 1, "D62: the named ICP view is the copy source. Ask Josh.");
      const insertSql = seen.find((s) => /insert into/i.test(s)) ?? "";
      assert.match(insertSql, /v_lane_e_final/, "D62: copy must read the named view. Ask Josh.");
      assert.doesNotMatch(insertSql, /v_lane_e_companies|v_lane_e_needs_domain/, "D62: copy must not join companions. Ask Josh.");
      assert.match(seen.join("\n"), /set local statement_timeout/i, "D62: the copy must set a statement timeout. Ask Josh.");
    } finally {
      await close();
    }
  });

  it("a failing copy throws and rolls back (PGlite does not honor statement_timeout)", async () => {
    const { db, close } = await pgliteDb();
    try {
      await db.exec(`
        create schema client_t;
        create schema lp;
        create table client_t.maps_raw (
          place_id text, plan_id text, main_category text, name text, email text, domain text
        );
        create view client_t.v_boom as
          select place_id, plan_id, main_category, name, email, domain, true as keep_final
            from client_t.maps_raw
           where (1 / 0) is not null;
        create table lp.t_ingested_leads (
          id serial primary key, email text, company_name text, source_label text
        );
        insert into client_t.maps_raw (place_id, plan_id, main_category, name, email, domain) values
          ('a', 'custom-1', 'church', 'A', 'a@example.test', 'a.example');
      `);
      const seen: string[] = [];
      const wrapped: Q = {
        query: async (text, values) => {
          seen.push(text);
          return db.query(text, values);
        },
        exec: db.exec,
      };
      const withRun = async <T>(_id: string, fn: (tx: Q) => Promise<T>) => withTx(wrapped, fn);
      await assert.rejects(
        () =>
          copyMapsPool({ ...wrapped, withRun } as never, {
            client_tag: "t",
            filters: { plan_id: "custom-1", categories: ["church"], icp_view: "v_boom" },
            max_rows: 1,
            source_label: "fixture",
            run_id: "00000000-0000-0000-0000-000000000005",
            statementTimeoutMs: 200,
          }),
        (err: Error) => /division by zero|57014|statement timeout|canceling statement/i.test(err.message),
      );
      assert.match(seen.join("\n"), /set local statement_timeout/i, "D62: timeout is set before the insert. Ask Josh.");
      const left = await db.query("select count(*)::text as n from lp.t_ingested_leads");
      assert.equal(
        Number((left.rows[0] as { n: string }).n),
        0,
        "D62: a failed copy must roll back. Ask Josh.",
      );
    } finally {
      await close();
    }
  });
});

describe("D64 — maps pull skips held emails before max_rows", () => {
  it("a 2-row pull after three held emails still inserts the two new ones", async () => {
    const { db, close } = await pgliteDb();
    try {
      await db.exec(`
        create schema client_t;
        create schema lp;
        create table client_t.maps_raw (
          place_id text, plan_id text, main_category text, name text, email text, domain text
        );
        create table lp.t_ingested_leads (
          id serial primary key, email text, company_name text, company_domain text, industry text, source_label text
        );
        insert into lp.t_ingested_leads (email) values
          ('held1@example.test'), ('held2@example.test'), ('held3@example.test');
        insert into client_t.maps_raw (place_id, plan_id, main_category, name, email, domain) values
          ('a', 'custom-1', 'church', 'A', 'held1@example.test', 'a.example'),
          ('b', 'custom-1', 'church', 'B', 'held2@example.test', 'b.example'),
          ('c', 'custom-1', 'church', 'C', 'held3@example.test', 'c.example'),
          ('d', 'custom-1', 'church', 'D', 'new1@example.test', 'd.example'),
          ('e', 'custom-1', 'church', 'E', 'new2@example.test', 'e.example');
      `);
      const withRun = async <T>(_id: string, fn: (tx: typeof db) => Promise<T>) => withTx(db, fn);
      const copied = await copyMapsPool({ ...db, withRun } as never, {
        client_tag: "t",
        filters: { plan_id: "custom-1", categories: ["church"] },
        max_rows: 2,
        source_label: "fixture",
        run_id: "00000000-0000-0000-0000-000000000064",
      });
      assert.equal(copied.inserted, 2, "D64: LIMIT applies after skipping held emails so successive pulls advance. Ask Josh.");
      assert.equal(copied.already_held, 3);
    } finally {
      await close();
    }
  });
});
