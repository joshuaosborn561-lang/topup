import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvHeader, headerUsable, preflightPool } from "./preflight.js";

/** D99 — a pool the service cannot ingest is refused before a job opens, in plain English. */
describe("D99 — pool preflight", () => {
  it("reads only the header of a file and says whether it can land", async () => {
    assert.deepEqual(csvHeader('﻿"Work_Email",first_name,Company\nrow'), ["work_email", "first_name", "company"]);
    assert.deepEqual(headerUsable(["work_email", "first_name"]), { email: "work_email", first: "first_name" });
    assert.deepEqual(headerUsable(["mobile_phone", "title"]), { email: null, first: null });
    const fetchOk = (async () => new Response("email,first_name,last_name\n", { status: 206 })) as unknown as typeof fetch;
    const ok = await preflightPool({ query: async () => ({ rows: [] }) } as never, "bcp", { kind: "file_url", urls: ["https://example.invalid/pool.csv"] }, fetchOk);
    assert.ok(ok.ok && /1 file\(s\) reachable/.test(ok.note));
    const fetch403 = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    const bad = await preflightPool({ query: async () => ({ rows: [] }) } as never, "bcp", { kind: "file_url", urls: ["https://example.invalid/pool.csv"] }, fetch403);
    assert.ok(!bad.ok && /HTTP 403/.test(bad.message));
    const noCols = (async () => new Response("mobile_phone,title\n", { status: 200 })) as unknown as typeof fetch;
    const unusable = await preflightPool({ query: async () => ({ rows: [] }) } as never, "bcp", { kind: "file_url", urls: ["https://example.invalid/pool.csv"] }, noCols);
    assert.ok(!unusable.ok && /no email or first_name column/.test(unusable.message));
  });

  it("refuses the whole lane table, a missing table, and an empty match before anything opens", async () => {
    const db = (cols: string[], n: string) => ({ query: async (sql: string) => (sql.includes("information_schema") ? { rows: cols.map((c) => ({ column_name: c })) } : { rows: [{ n }] }) }) as never;
    const whole = await preflightPool(db(["email"], "9"), "bcp", { kind: "table", table: "lp.bcp_ingested_leads", where: "true" });
    assert.ok(!whole.ok && /own lane table/.test(whole.message));
    const missing = await preflightPool(db([], "0"), "bcp", { kind: "table", table: "scratch.nothing", where: "true" });
    assert.ok(!missing.ok && /does not exist/.test(missing.message));
    const empty = await preflightPool(db(["work_email", "first_name"], "0"), "bcp", { kind: "table", table: "scratch.pool", where: "state = 'CO'" });
    assert.ok(!empty.ok && /no row of scratch.pool matches/.test(empty.message));
    const lane = await preflightPool(db(["email"], "46"), "bcp", { kind: "table", table: "lp.bcp_ingested_leads", where: "source_label = 'x'" });
    assert.ok(lane.ok && lane.rows === 46);
  });
});
