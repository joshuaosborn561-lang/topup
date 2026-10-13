import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SMARTLEAD_ALLOWED } from "../clients/smartlead.js";
import { parseJobSettings } from "../jobs/settings.js";
import { importMatched, parseJobs } from "./import/index.js";
import { isLaneTable, LEADPIPE_CANONICAL_COLUMNS, safeWhere, sourceLabel } from "./ingest/index.js";
import { QA_FIELD_COLUMN, scopeSql } from "./qa/index.js";
import { bandSegment, cellLabel, mailClassSegment, matchRule } from "./route/index.js";
import { dedupeKeySql } from "./stage/index.js";

/** The pure halves of the referee stages. Vendor calls are never made here; the stages that make them are exercised against fakes. */
describe("D99 — the referee's pure halves", () => {
  it("a job's settings route every row to the one campaign and carry no settings", () => {
    const s = parseJobSettings({ id: "bcp.job_1.v1", client_tag: "bcp", lane: "job_1", smartlead_client_id: 1, campaign_id: 7, source: { kind: "table", table: "scratch.pool" }, routing: [{ when: {}, campaign_id: 7 }] });
    assert.equal(s.source.kind === "table" && s.source.where, "true");
    assert.equal(matchRule({ band: "11_50", mail_class: "SEG", gift: null }, s.routing)?.campaign_id, 7);
    assert.throws(() => parseJobSettings({ id: "x", client_tag: "bcp", lane: "l", smartlead_client_id: 1, campaign_id: 7, source: { kind: "getleads", filters: {} } }));
  });

  it("a where clause the bot wrote is one expression", () => {
    assert.equal(safeWhere(" state = 'CO' "), "state = 'CO'");
    assert.equal(safeWhere(""), "true");
    assert.throws(() => safeWhere("true; drop table x"));
    assert.throws(() => safeWhere("true -- x"));
    assert.equal(safeWhere("source_label = 'topup_replay_3897344' and (state in ('CO','TX') or city ilike '%denver%') and email is not null"), "source_label = 'topup_replay_3897344' and (state in ('CO','TX') or city ilike '%denver%') and email is not null");
    assert.throws(() => safeWhere("pg_sleep(10) = 1"), /does not run/);
    assert.throws(() => safeWhere("id in (select id from public.leads)"), /does not run/);
    assert.throws(() => safeWhere("email = $1"), /parameters/);
    assert.throws(() => safeWhere("(state = 'CO'"), /parentheses/);
  });

  it("the pool may be the lane table itself, and LeadPipe's column map only ever names its canonical columns", async () => {
    assert.equal(isLaneTable("lp.bcp_ingested_leads", "bcp"), true);
    assert.equal(isLaneTable("scratch.bcp_pool", "bcp"), false);
    assert.ok(!(LEADPIPE_CANONICAL_COLUMNS as readonly string[]).includes("phone"));
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./ingest/index.ts", import.meta.url), "utf8");
    assert.match(src, /LEADPIPE_CANONICAL_COLUMNS as readonly string\[\]\)\.includes\(k\)/, "D99: every column_map key is filtered to LeadPipe's canonical columns before the call.");
    assert.ok(!/PHONE_HEADER_MAP/.test(src), "D99: no phone mapping; LeadPipe refuses it.");
  });

  it("labels, keys and matches", () => {
    const run = { run_id: "0123456789abcdef", client_tag: "bcp", lane: "job_7_1" } as never;
    assert.equal(sourceLabel(run, 7), "topup_bcp_job_7_1_01234567_c7");
    assert.equal(bandSegment("11 to 50"), "11_50");
    assert.equal(mailClassSegment("seg"), "SEG");
    assert.equal(cellLabel({ band: "11_50", mail_class: "SEG", gift: null }, ["band"]), "band=11_50");
    assert.match(dedupeKeySql("c", "e"), /md5/);
    assert.equal(importMatched(10, { status: "completed", imported_count: 10, duplicate_count: 0, invalid_count: 0, error_message: null } as never), true);
    assert.deepEqual(parseJobs('{"7":"job-a"}'), { 7: "job-a" });
    assert.equal(QA_FIELD_COLUMN.job_title, "title");
    assert.equal(scopeSql(null, "bcp")?.sql, "true");
    assert.equal(scopeSql("other", "bcp"), null);
    for (const path of SMARTLEAD_ALLOWED) assert.ok(!/update_campaign_status|delete/i.test(String(path)), `D6: ${String(path)}`);
  });
});
