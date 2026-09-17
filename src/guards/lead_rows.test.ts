import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LEAD_FIELD_KEYS, redact } from "../lib/log.js";
import { maskEmail, SAMPLE_ROWS_MAX } from "../mcp/server.js";
import { qaHoldCard, segmentCard } from "../slack/cards.js";

/**
 * D2 — no lead rows in chat, Slack, or logs beyond ten sample rows on a card.
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

  it("MCP sample_rows caps at ten and masks the address", () => {
    assert.equal(SAMPLE_ROWS_MAX, 10, "D2: ten sample rows, never more");
    assert.equal(maskEmail("jane.doe@acme.com"), "ja***@acme.com");
    assert.equal(maskEmail(null), null);
  });

  it("a QA hold card shows at most ten samples", () => {
    const blocks = qaHoldCard({ cardId: "c", runId: "r", clientTag: "parlay", ruleId: "junk_titles", reason: "why", count: 40, samples: Array.from({ length: 25 }, (_, i) => `Co ${i}`), rerouteTo: null });
    const text = JSON.stringify(blocks);
    assert.ok(text.includes("Co 9") && !text.includes("Co 10"), "D2: qaHoldCard must slice samples to ten");
  });

  it("a segment card shows at most ten samples", () => {
    const blocks = segmentCard({
      cardId: "c",
      runId: "r",
      clientTag: "parlay",
      lane: "it_dm_tickets",
      action: "repeat",
      alert: false,
      summary: "repeat",
      basis: "r1",
      segment: "getleads",
      diff: "",
      counts: [["Pool", "1"]],
      cost: "$0.00",
      widening: [],
      flags: [],
      confidence: "high",
      reasons: ["x"],
      samples: Array.from({ length: 25 }, (_, i) => `Co ${i}`),
      split: false,
    });
    const text = JSON.stringify(blocks);
    assert.ok(text.includes("Co 9") && !text.includes("Co 10"), "D2: segmentCard must slice samples to ten");
  });
});
