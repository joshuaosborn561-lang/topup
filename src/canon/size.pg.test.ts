import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapsPoolFromFilters, resolveMapsPool } from "./mapsPool.js";
import { SIZE_SUPPRESS_BIND_OFFSET, shiftSqlParams, sizeRead, sizeSuppressJoinSql } from "./size.js";
import { INTERESTED_CATEGORY_IDS } from "../domain/working.js";
import { BOUNCE_CATEGORY_ID, DNC_CATEGORY_ID, WRONG_PERSON_CATEGORY_ID } from "../stages/suppress/index.js";
import { DEFAULT_RECYCLE_DAYS } from "../stages/suppress/recycle.js";

/**
 * D70 — size() after the D69 $11/$12 shift must type $1. PGlite is
 * Postgres. Ask Josh before leaving $1 unused.
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

async function seedStrictIcp(db: Q): Promise<void> {
  await db.exec(`
    create schema if not exists client_t;
    create schema if not exists topup;
    create schema if not exists lp;
    create table client_t.maps_raw (
      place_id text, plan_id text, main_category text, name text, email text
    );
    create view client_t.v_lane_e_final as
      select *, true as keep_final from client_t.maps_raw;
    create view client_t.v_lane_e_companies as
      select place_id, name, main_category from client_t.maps_raw
       where place_id in ('a', 'b');
    create view client_t.v_lane_e_needs_domain as
      select place_id, main_category from client_t.maps_raw
       where place_id = 'c';
    insert into client_t.maps_raw (place_id, plan_id, main_category, name, email) values
      ('a', 'custom-1', 'church', 'A', 'a@example.test'),
      ('b', 'custom-1', 'hotel', 'B', 'b@example.test'),
      ('c', 'custom-1', 'church', 'C', 'c@example.test'),
      ('d', 'other', 'church', 'D', 'd@example.test');
    create table public.leads (
      id int, email text, campaign_id int, category_id int, smartlead_client_id bigint
    );
    create table public.sends (
      lead_id int, bounced boolean, sent boolean, sent_at timestamptz,
      replied_at timestamptz, positive_reply boolean, lead_category_id int
    );
    create table public.suppression (email text);
    create table public.leads_staging (email text, campaign_id bigint);
    create table public.campaigns (
      id int, smartlead_campaign_id bigint, smartlead_client_id bigint, status text
    );
    create table topup.client_map (client_tag text, smartlead_client_id bigint);
    insert into topup.client_map values ('t', 1);
    create table topup.campaign_registry (campaign_id bigint, offer_key text, client_tag text);
    create table topup.pull_receipts (client_tag text, company_filters jsonb, campaign_ids bigint[]);
    create table lp.t_ingested_leads (email text);
  `);
}

const FILTERS = {
  plan_id: "custom-1",
  categories: ["church", "hotel"],
  icp_filter: "client_t.v_lane_e_final",
};

describe("D70 — size types $1 on the strict ICP path", () => {
  it("Postgres rejects unused untyped $1 (the live 33e8f595 failure)", async () => {
    const { db, close } = await pgliteDb();
    try {
      await assert.rejects(
        () => db.query(
          "with p as (select $2::int[] as positive) select count(*) from p",
          ["custom-1", [1, 2]],
        ),
        (err: Error) => /could not determine data type of parameter \$1/.test(err.message),
      );
    } finally {
      await close();
    }
  });

  it("sizeRead walks the companion ICP pool and the suppress join without a bind error", async () => {
    const { db, close } = await pgliteDb();
    try {
      await seedStrictIcp(db);
      const spec = mapsPoolFromFilters(FILTERS, "t");
      assert.ok(!("error" in spec));
      if ("error" in spec) return;
      const resolved = await resolveMapsPool(db, "t", spec);
      assert.ok(!("error" in resolved));
      if ("error" in resolved) return;
      assert.equal(resolved.companion, true);
      const sql = sizeSuppressJoinSql(resolved, '"lp"."t_ingested_leads"', []);
      assert.match(sql, /\$1::text as plan_id/, "D70: CTE types $1. Ask Josh.");
      assert.match(sql, /\$2::int\[\]/, "D70: $2 stays interested ids. Ask Josh.");
      assert.match(sql, /\$11::text/, "D70: pool plan_id is $11. Ask Josh.");
      assert.match(shiftSqlParams(resolved.fromSql, SIZE_SUPPRESS_BIND_OFFSET), /\$12::text\[\]/);
      const params = [
        "custom-1",
        [...INTERESTED_CATEGORY_IDS],
        DNC_CATEGORY_ID,
        WRONG_PERSON_CATEGORY_ID,
        BOUNCE_CATEGORY_ID,
        1,
        [1],
        [],
        "t",
        DEFAULT_RECYCLE_DAYS,
        ...resolved.params,
      ];
      const { rows } = await db.query(sql, params);
      assert.ok(Array.isArray(rows));
      const r = await sizeRead(db, {
        client_tag: "t",
        campaign_id: 1,
        source: "maps",
        filters: FILTERS,
      });
      assert.equal(r.status, "done", "D70: size must finish. Ask Josh.");
      assert.equal(r.last_error, null, r.last_error ?? "");
      assert.equal(r.pool, 3, "D70: a,b,c on this plan. Ask Josh.");
      assert.equal(r.cost_cents, 0);
      assert.equal(r.job_id, null);
    } finally {
      await close();
    }
  });
});
