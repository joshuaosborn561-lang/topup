import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateFromCounts } from "./backfill.js";
import { extractSenderFromHistory, extractSenderFromLead, normalizeSender } from "./sender.js";

/** D81 — sender extract and dry-run estimate. Fixtures are example.test only. Ask Josh. */

describe("D81 — sender extract", () => {
  it("reads the sending inbox from message history and ignores the lead address", () => {
    assert.equal(
      extractSenderFromHistory({
        history: [
          { type: "SENT", from: "Inbox@Example.test", to: "person@example.test" },
          { type: "REPLY", from: "person@example.test" },
        ],
      }),
      "inbox@example.test",
    );
    assert.equal(
      extractSenderFromHistory({ messages: [{ direction: "outbound", email_account: { from_email: "pod-a@example.test" } }] }),
      "pod-a@example.test",
    );
    assert.equal(extractSenderFromHistory({ history: [{ type: "REPLY", from: "person@example.test" }] }), null);
  });

  it("reads a sender already on a campaign-lead row", () => {
    assert.equal(extractSenderFromLead({ last_sent_from: "Seat@Example.test" }), "seat@example.test");
    assert.equal(extractSenderFromLead({ email_account: { email: "generic@example.test" } }), "generic@example.test");
    assert.equal(extractSenderFromLead({ first_name: "x" }), null);
  });

  it("rejects a non-inbox string", () => {
    assert.equal(normalizeSender(""), null);
    assert.equal(normalizeSender("not-an-inbox"), null);
    assert.equal(normalizeSender(12), null);
  });
});

describe("D81 — backfill dry-run estimate", () => {
  it("defaults to dry-run and reports list + worst-case history calls", () => {
    const e = estimateFromCounts({ sent_rows: 332731, distinct_pairs: 195888, campaigns: 202, missing_sender: 195888, rps: 2 });
    assert.equal(e.dry_run, true);
    assert.equal(e.apply, false);
    assert.equal(e.list_calls, 2020);
    assert.equal(e.history_calls_worst, 195888);
    assert.equal(e.seconds_worst, 97944);
    assert.equal(e.hours_worst, 27.2);
    assert.match(e.note, /does not call Smartlead/);
  });
});
