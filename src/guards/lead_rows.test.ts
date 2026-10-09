import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAD_FIELD_KEYS, redact } from "../lib/log.js";
import { maskEmail, MCP_TOOL_ROLE, SAMPLE_ROWS_MAX } from "../mcp/server.js";
import { qaHoldCard } from "../console/cards.js";

/**
 * D2 — no lead rows in chat, cards or logs beyond ten sample values on a card.
 * Ask Josh before loosening any of this; the answer has been no every time.
 */
describe("D2 — lead rows never leave the database", () => {
  it("the logger strips email addresses from strings", () => {
    assert.equal(redact("sent to jane.doe@acme.com and bob@x.io"), "sent to [email] and [email]");
  });

  it("the logger redacts lead field keys and logs arrays of objects as a count", () => {
    const out = redact({ run_id: "r1", email: "a@b.co", first_name: "Jane", rows: [{ email: "a@b.co" }], leads: 3, n: 2 }) as Record<string, unknown>;
    assert.equal(out.run_id, "r1");
    assert.equal(out.email, "[redacted]");
    assert.equal(out.first_name, "[redacted]");
    assert.equal(out.rows, "[redacted]");
    assert.equal(out.n, 2);
    assert.equal(redact([{ a: 1 }, { a: 2 }]), "[2 rows redacted]");
    for (const k of ["email", "first_name", "last_name", "company_name", "linkedin_url", "phone"]) assert.ok(LEAD_FIELD_KEYS.has(k), `D2: ${k} must be a redacted key`);
  });

  it("cards cap at ten masked samples, and no MCP tool returns a row at all (D48)", async () => {
    assert.equal(SAMPLE_ROWS_MAX, 10, "D2: ten sample values, never more");
    assert.equal(maskEmail("jane.doe@acme.com"), "ja***@acme.com");
    assert.equal(maskEmail(null), null);
    const { readFile } = await import("node:fs/promises");
    const server = await readFile(new URL("../mcp/server.js", import.meta.url).pathname.replace(/\.js$/, ".ts"), "utf8");
    assert.ok(!/registerTool\(\s*"sample_rows"/.test(server), "D2/D48: the row-returning tool is gone. Ask Josh.");
    assert.equal(MCP_TOOL_ROLE["sample_rows"], undefined, "D2/D48: sample_rows has no role; it is retired. Ask Josh.");
    assert.ok(!/select[^`]*\b(email|first_name|last_name|linkedin_url|phone)\b[^`]*from lp\./i.test(server), "D2/D48: no MCP tool selects lead fields from a lane table. Ask Josh.");
  });

  it("a QA hold card shows at most ten samples", () => {
    const blocks = qaHoldCard({ cardId: "c", runId: "r", clientTag: "parlay", ruleId: "junk_titles", reason: "why", count: 40, samples: Array.from({ length: 25 }, (_, i) => `Co ${i}`), rerouteTo: null });
    const text = JSON.stringify(blocks);
    assert.ok(text.includes("Co 9") && !text.includes("Co 10"), "D2: qaHoldCard must slice samples to ten");
  });
});
