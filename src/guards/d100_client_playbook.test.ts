import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_READS, CANON_TOOLS } from "../grok/allowlist.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";

/**
 * D100 — one living playbook per client. A plain view, one read verb,
 * no recipe, no per-client code, no spend. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D100 — client playbook", () => {
  it("playbook is a registered read, not a spend or a write", async () => {
    assert.ok(CANON_READS.includes("playbook"), "D100: playbook is a read. Ask Josh.");
    assert.equal(MCP_TOOL_ROLE.playbook, "operator", "D100: playbook is on the operator surface. Ask Josh.");
    assert.ok(CANON_TOOLS.includes("playbook"));
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    const start = grok.indexOf('registerTool(\n    "playbook"');
    const next = grok.indexOf("registerTool(", start + 1);
    const block = start >= 0 ? grok.slice(start, next > start ? next : start + 600) : "";
    assert.match(grok, /registerTool\(\s*"playbook"/, "D100: playbook must be registered. Ask Josh.");
    assert.match(block, /clientPlaybook/, "D100: playbook calls the read. Ask Josh.");
    assert.ok(!/SpendRails|approve_cost|approved_by/.test(block), "D100: playbook spends nothing. Ask Josh.");
  });

  it("the migration is a view over list_build_records, not a job, and was not applied here", async () => {
    const sql27 = await readFile(new URL("supabase/migrations/0027_client_playbook.sql", root), "utf8");
    const sql28 = await readFile(new URL("supabase/migrations/0028_client_playbook_prod_types.sql", root), "utf8");
    for (const sql of [sql27, sql28]) {
      assert.match(sql, /create or replace view topup\.client_playbook/i, "D100: ship a view. Ask Josh.");
      assert.match(sql, /group by a\.client_tag/i, "D100: grouped by client_tag. Ask Josh.");
      assert.match(sql, /null::uuid\[\]/, "D100: receipt_ids UNION arm is uuid[] (prod). Ask Josh.");
      assert.match(sql, /'\{\}'::integer\[\]/, "D100: campaign_ids UNION arm is integer[] (prod). Ask Josh.");
      assert.ok(!/null::text\[\]\s*$/m.test(sql.split("from topup.process_changes")[0] ?? ""), "D100: do not cast receipt_ids to text[]. Ask Josh.");
      assert.match(sql, /list_build_records/);
      assert.match(sql, /process_changes/);
      assert.match(sql, /list-build-transcripts/);
      assert.match(sql, /security_invoker\s*=\s*true/, "D100: the view does not run as the owner. Ask Josh.");
      assert.ok(!/https:\/\//.test(sql), "D100: no signed URL in the view. Ask Josh.");
      assert.ok(!/\b(cron|pg_cron|create skill|recipe)\b/i.test(sql), "D100: no batch job, no skill, no recipe. Ask Josh.");
      assert.ok(!/\b(dl_status|sg_exclude|skip_)/.test(sql), "D100: the view does not touch dl_status, sg_exclude or skip_*. Ask Josh.");
      assert.ok(!/\binsert into\b/i.test(sql), "D100: the playbook is read-only. Ask Josh.");
      assert.ok(!/client_name|parlay|peterson|basco|goliath|salesglider|bcp/i.test(sql), "D100: no client facts in the migration. Ask Josh.");
    }
    const playbook = await readFile(new URL("src/canon/playbook.ts", root), "utf8");
    assert.ok(!/\b(insert|update|delete)\b/i.test(playbook), "D100: playbook.ts writes nothing. Ask Josh.");
  });

  it("canon names D100 and the loop reads the playbook before a top-up", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D100\*\*/, "D100: fold the decision into CANON.md. Ask Josh.");
    assert.match(canon, /playbook\(client_tag\)/, "D100: the loop names playbook(client_tag). Ask Josh.");
    assert.ok(!/parlay|peterson|basco|goliath/i.test(canon), "D100: no client facts in canon. Ask Josh.");
  });
});
