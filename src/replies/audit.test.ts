import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { worstCaseCents } from "../spend/prices.js";
import { LIVE_NEGATIVE_AUDIT, estimateAudit } from "./audit.js";

/** D81 — dry-run audit estimates Jev on the leftover only. Ask Josh. */

describe("D81 — negative-class audit dry-run", () => {
  it("defaults to dry-run and does not run AI", () => {
    const e = estimateAudit(LIVE_NEGATIVE_AUDIT);
    assert.equal(e.dry_run, true);
    assert.equal(e.apply, false);
    assert.equal(e.ai_run, false);
    assert.equal(e.negatives, 1211);
    assert.equal(e.text_unsubscribe, 133);
    assert.equal(e.text_not_interested, 236);
    assert.equal(e.category_not_interested, 787);
    assert.equal(e.needs_ai, 55);
    assert.equal(e.worst_case_cents, worstCaseCents("jev", "grade", 55));
    assert.equal(e.worst_case_cents, 1, "D81: 55 leftovers × Jev $0.11/1,000 rounds up to 1 cent. Ask Josh.");
    assert.match(e.note, /AI is not run/);
  });

  it("quotes zero when text and category cover every negative", () => {
    const e = estimateAudit({
      negatives: 10,
      text_unsubscribe: 4,
      text_not_interested: 3,
      category_unsubscribe: 1,
      category_not_interested: 2,
      status_unsubscribe: 0,
      needs_ai: 0,
    });
    assert.equal(e.worst_case_cents, 0);
    assert.equal(e.ai_run, false);
  });
});
