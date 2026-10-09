import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_READS } from "../grok/allowlist.js";
import { GROK_READS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { parseIcpCategory } from "../stages/icp/parse.js";
import { lpExportFromResponse } from "../clients/leadpipe.js";
import { icpWorstCaseCents } from "../stages/icp/index.js";

/**
 * D64 — job 46b1c941. Ask Josh before any of this changes.
 */

const root = new URL("../../", import.meta.url);

describe("D64 — job 46b1c941", () => {
  it("puzzle waits as spend_approval, passes approvedCents, and recounts the queue", async () => {
    const src = await readFile(new URL("src/stages/puzzle/index.ts", root), "utf8");
    assert.match(src, /kind: "spend_approval"/, "D64: puzzle must post a spend_approval, not only park. Ask Josh.");
    assert.match(src, /approvedCents/, "D64: the people gate must see approvedCents. Ask Josh.");
    assert.match(src, /statusCounts/, "D64: queue is what is on the table now. Ask Josh.");
    assert.match(src, /did not run Find Named Person/, "D64: 0 of N queued is not done. Ask Josh.");
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.match(runner, /kind === "parked"/, "D64: approved_by must close a leftover parked card. Ask Josh.");
    const emails = await readFile(new URL("src/stages/find_emails/index.ts", root), "utf8");
    assert.match(emails, /will not skip/, "D64: find_emails must not skip while needs_person remain. Ask Josh.");
  });

  it("ICP labels are tokens and the spend card is re-quoted with actual_cents", async () => {
    const src = await readFile(new URL("src/stages/icp/index.ts", root), "utf8");
    assert.doesNotMatch(src, /coalesce\(reason, model\)/, "D64: never write Jev's raw sentence as the label. Ask Josh.");
    assert.match(src, /icpLabelSql/, "D64: the label is parsed to the allowed token set. Ask Josh.");
    assert.match(src, /updateCardPayload/, "D64: a re-quote must update the open card. Ask Josh.");
    assert.match(src, /counts\.cost_cents/, "D64: finish must record actual_cents. Ask Josh.");
    assert.equal(parseIcpCategory(null, "This looks like a commercial electrical contractor.").label, null);
    assert.ok(icpWorstCaseCents(333) < icpWorstCaseCents(815), "D64: a smaller batch must re-quote lower. Ask Josh.");
  });

  it("maps count reports used components and pull skips held before max_rows", async () => {
    const pool = await readFile(new URL("src/canon/mapsPool.ts", root), "utf8");
    assert.match(pool, /already_ingested/, "D64: used must include already-ingested. Ask Josh.");
    assert.match(pool, /already_contacted/, "D64: used must include prior contact/suppression. Ask Josh.");
    assert.match(pool, /eligible as/, "D64: held emails are skipped before LIMIT. Ask Josh.");
    assert.match(pool, /limit \$\{limitParam\}/, "D64: max_rows applies to eligible rows. Ask Josh.");
    const windowedLimit = /windowed as \([\s\S]*limit \$\{limitParam\}/;
    assert.doesNotMatch(pool, windowedLimit, "D64: must not LIMIT the pool before skipping held emails. Ask Josh.");
  });

  it("lp_export unwraps result.signed_url and verify does not park a recorded approval", async () => {
    const wrapped = lpExportFromResponse({ ok: true, tool: "lp_export", result: { signed_url: "https://example.test/z.csv", row_count: 19 } });
    assert.deepEqual(wrapped, { signed_url: "https://example.test/z.csv", row_count: 19 });
    const verify = await readFile(new URL("src/stages/verify/verify.ts", root), "utf8");
    assert.match(verify, /resetStep/, "D64: a recorded approval must reset attempts so a retry resumes. Ask Josh.");
    assert.match(verify, /approved <= 0/, "D64: a third verify failure must not park when approval is recorded. Ask Josh.");
  });

  it("size is a free dry-run read on the surface", async () => {
    assert.ok((CANON_READS as readonly string[]).includes("size"), "D64: size is a read. Ask Josh.");
    assert.ok((GROK_READS as readonly string[]).includes("size"));
    assert.equal(MCP_TOOL_ROLE.size, "operator");
    const size = await readFile(new URL("src/canon/size.ts", root), "utf8");
    assert.match(size, /job_id: null/, "D64: size opens no job. Ask Josh.");
    assert.match(size, /cost_cents: 0/, "D64: size spends nothing. Ask Josh.");
    assert.doesNotMatch(size, /openRun|insert into topup\.runs/, "D64: size must not block the lane. Ask Josh.");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /`size\(/, "D64: CANON.md names size. Ask Josh.");
  });
});
