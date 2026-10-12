import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { SMARTLEAD_ALLOWED } from "../clients/smartlead.js";
import { classifyNegative } from "../replies/classify.js";
import { estimateAudit, LIVE_NEGATIVE_AUDIT } from "../replies/audit.js";
import { SUPPRESS_REASONS } from "../stages/suppress/index.js";
import { dncListSql, hardBounceSql, thisClientUnsubscribeSql } from "../stages/suppress/recycle.js";
import { sizeSuppressJoinSql } from "../canon/size.js";

/** D81 — unsubscribes only. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D81 — unsubscribe-only suppression", () => {
  it("CANON and the suppress set drop Smartlead DNC and 90-day prior contact", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /real unsubscribes only/, "D81: fold into CANON. Ask Josh.");
    assert.match(canon, /negative_class/, "D81: class lives on the lead store. Ask Josh.");
    assert.match(canon, /per-client unsubscribes, hard bounces pending Josh, existing DNC list/, "D81: held row. Ask Josh.");
    assert.doesNotMatch(canon, /90-day sends, live campaigns, suppression/, "D81: held is not 90-day sends. Ask Josh.");
    assert.deepEqual([...SUPPRESS_REASONS], ["unsubscribed", "suppression_list", "bounced"], "D81: suppress reasons. Ask Josh.");
    assert.match(thisClientUnsubscribeSql(true), /negative_class = 'unsubscribe'/, "D81: class, not category_id = 4. Ask Josh.");
    assert.match(dncListSql(), /public\.suppression/, "D81: existing DNC list. Ask Josh.");
    assert.match(hardBounceSql(true), /s\.bounced/, "D81: hard bounces stay pending Josh. Ask Josh.");
  });

  it("Smartlead DNC is not an unsubscribe; text and category classify first", () => {
    const dnc = classifyNegative({ category_id: 4, category: "Do Not Contact", body: "" });
    assert.equal(dnc.needs_ai, true, "D81: Smartlead DNC is every negative. Ask Josh.");
    assert.equal(classifyNegative({ body: "please unsubscribe", category_id: 4 }).class, "unsubscribe");
    assert.equal(classifyNegative({ category_id: 3 }).class, "not_interested");
  });

  it("views and size SQL use only the unsubscribe class", async () => {
    const mig = await readFile(new URL("supabase/migrations/0025_d81_negative_class.sql", root), "utf8");
    assert.match(mig, /negative_class = 'unsubscribe'/, "D81: views filter the class. Ask Josh.");
    assert.match(mig, /v_master_suppression/, "D81. Ask Josh.");
    assert.match(mig, /lp\.reply_suppression/, "D81. Ask Josh.");
    assert.match(mig, /response_based_v1/, "D81. Ask Josh.");
    assert.doesNotMatch(mig, /category_id = 4/, "D81: views must not use Smartlead DNC. Ask Josh.");
    assert.doesNotMatch(mig, /dl_status\s*=|sg_exclude\s*=|skip_\w+\s*=/, "D81: never write those columns. Ask Josh.");
    const sql = sizeSuppressJoinSql({ schema: "client_t", fromSql: "client_t.maps_raw pool", params: [], cats: [], companion: false }, null, []);
    assert.match(sql, /unsubscribed/, "D81: size reads unsubscribes. Ask Josh.");
    assert.doesNotMatch(sql, /positive_reply|do_not_contact|client_prior_contact/, "D81: size dropped the old reasons. Ask Josh.");
  });

  it("audit is dry-run and does not run AI; Smartlead is never unsuppressed", async () => {
    const e = estimateAudit(LIVE_NEGATIVE_AUDIT);
    assert.equal(e.dry_run, true);
    assert.equal(e.ai_run, false);
    assert.equal(e.needs_ai, 55);
    assert.equal(e.worst_case_cents, 1);
    const script = await readFile(new URL("scripts/audit-negative-class.ts", root), "utf8");
    assert.match(script, /Does not call AI/, "D81: backfill dry-run. Ask Josh.");
    assert.ok(!SMARTLEAD_ALLOWED.includes("unsubscribe_lead" as never), "D81: never unsuppress. Ask Josh.");
    assert.ok(!SMARTLEAD_ALLOWED.includes("resume_lead" as never), "D81: never unsuppress. Ask Josh.");
  });
});
