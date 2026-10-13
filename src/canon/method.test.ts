import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMethod, isoOrNull, pageMethod, redactArg } from "./method.js";

/** D99 — the method comes off the transcript, in order, with no lead row in it. */
describe("D99 — method off the transcript", () => {
  const transcript = [
    `<turn n="0">Human: Pull 2,000 more IT buyers in hospitals for Boulder.</turn>`,
    `<turn n="1">Assistant: <tool name="getleads:count_contacts">`,
    `<parameter name="filters">{"job_titles":["CIO"],"industries":["Hospitals"]}</parameter>`,
    `</tool>`,
    `<tool name="mcp__Supabase__execute_sql">`,
    `<parameter name="query">select count(*) from lp.bcp_ingested_leads</parameter>`,
    `</tool></turn>`,
    `<turn n="2">Human: good, go.</turn>`,
    `<turn n="3">Assistant: &lt;tool name="Smartlead:stage_leads_from_url"&gt;&lt;parameter name="url"&gt;https://x/y.csv&lt;/parameter&gt;&lt;/tool&gt;</turn>`,
  ].join("\n");

  it("lists every tool call in order with its arguments, and the human turns", () => {
    const m = extractMethod(transcript);
    assert.deepEqual(m.steps.map((s) => s.tool), ["getleads:count_contacts", "mcp__Supabase__execute_sql", "Smartlead:stage_leads_from_url"]);
    assert.equal(m.steps[0]!.args.filters, `{"job_titles":["CIO"],"industries":["Hospitals"]}`);
    assert.equal(m.steps[2]!.args.url, "[url x]", "a recorded URL is never replayed; only its host stays");
    assert.equal(m.tool_counts["getleads:count_contacts"], 1);
    assert.deepEqual(m.asked, ["Pull 2,000 more IT buyers in hospitals for Boulder.", "good, go."]);
  });

  it("pages the steps", () => {
    const m = extractMethod(transcript);
    const p = pageMethod("bcp/x.md", m, 2, 1);
    assert.equal(p.total_steps, 3);
    assert.equal(p.steps.length, 1);
    assert.equal(p.steps[0]!.n, 2);
    assert.equal(p.next_from, 3);
    assert.equal(pageMethod("bcp/x.md", m, 3, 5).next_from, null);
  });

  it("never carries an address, a phone, a signed URL, or a pasted result set", () => {
    assert.equal(redactArg("mail jane.doe@acme.com or call 303-555-0100"), "mail [email] or call [phone]");
    assert.equal(redactArg("label maps_emcor_1760312345678 run 1791912736330"), "label maps_emcor_1760312345678 run 1791912736330", "a stamp is not a phone");
    assert.equal(redactArg("url https://getleads-storage-prod.s3.us-east-2.amazonaws.com/x.csv?X-Amz-Signature=abc"), "url [url getleads-storage-prod.s3.us-east-2.amazonaws.com]");
    const json = JSON.stringify({ rows: [{ email: "a@b.co", first_name: "Ann" }, { email: "c@d.co", first_name: "Cy" }], filters: { job_titles: ["CIO"] }, email: "x@y.z" });
    const red = redactArg(json);
    assert.ok(!red.includes("a@b.co") && !red.includes("Ann"), red);
    assert.match(red, /2 rows not shown/);
    assert.match(red, /"job_titles":\["CIO"\]/);
    assert.match(red, /"email":"\[redacted\]"/);
    const dump = ["email,first,last", ...Array.from({ length: 20 }, (_, i) => `p${i}@x.io,a,b,c,d`)].join("\n");
    const out = redactArg(dump);
    assert.ok(!out.includes("p3@x.io"));
    assert.match(out, /20 more delimited lines not shown/);
    assert.ok(redactArg("x".repeat(2000)).length < 800);
  });

  it("turns the record's JS-formatted created_at back into a timestamptz literal", () => {
    assert.equal(isoOrNull("Sun Oct 11 2026 02:38:14 GMT+0000 (Coordinated Universal Time)"), "2026-10-11T02:38:14.000Z");
    assert.equal(isoOrNull(new Date("2026-10-11T02:38:14Z")), "2026-10-11T02:38:14.000Z");
    assert.equal(isoOrNull(null), null);
    assert.equal(isoOrNull("not a date"), null);
  });
});
