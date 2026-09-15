import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { VerifierResults, VerifierStatus } from "../../clients/verifier.js";
import { decide, observe, splitNames, type BatchState, type RunbookConfig } from "./runbook.js";

/** D10 — the stall runbook is code with tests, not a paragraph in a chat. */

const cfg: RunbookConfig = { stallPercent: 90, stallMinutes: 12, minSplitRows: 50, deadMinutes: 360 };
const MIN = 60_000;
const t0 = 1_700_000_000_000;

function status(p: Partial<VerifierStatus>): VerifierStatus {
  return {
    run_id: "v1",
    status: "verifying_mv",
    total_emails: 1000,
    stage_completed: "mx",
    retry_count: 0,
    last_error: null,
    mv_ok_count: 0,
    mv_catch_all_count: 0,
    mv_unknown_count: 0,
    mv_invalid_count: 0,
    mv_credits_used: 0,
    n2b_credits_used: 0,
    final_sendable_count: 0,
    final_rejected_count: 0,
    useful_output_count: 0,
    mail_class_seg_count: 0,
    progress: null,
    ...p,
  };
}

function state(p: Partial<BatchState> = {}): BatchState {
  return { batch: "A0", rows: 1000, vendorRunId: "v1", submittedAt: t0, lastProgressAt: t0, lastPercent: 0, lastVerified: 0, resumesUsed: 0, ...p };
}

const noResults: VerifierResults = { partial: false, resolved_counts: null, salvage_decision: null, sendable_url: null, rejected_url: null, unresolved_url: null };

describe("verify runbook (D10)", () => {
  it("waits while the vendor is moving", () => {
    const a = decide(state({ lastPercent: 40 }), status({}), null, t0 + 5 * MIN, cfg);
    assert.equal(a.kind, "wait");
  });

  it("observe() only advances the progress clock when a number moved", () => {
    const s = state({ lastPercent: 50, lastVerified: 500 });
    const same = observe(s, status({ progress: { percent: 50, verified: 500 } }), t0 + 5 * MIN);
    assert.equal(same.lastProgressAt, t0);
    const moved = observe(s, status({ progress: { percent: 51, verified: 510 } }), t0 + 5 * MIN);
    assert.equal(moved.lastProgressAt, t0 + 5 * MIN);
    assert.equal(moved.lastPercent, 51);
  });

  it("at or above 90% with no progress for 12 minutes: one free resume", () => {
    const a = decide(state({ lastPercent: 93 }), status({}), null, t0 + 12 * MIN, cfg);
    assert.equal(a.kind, "resume");
    assert.match(a.reason, /free resume/);
  });

  it("below 90% it is not a stall until the dead ceiling", () => {
    assert.equal(decide(state({ lastPercent: 60 }), status({}), null, t0 + 60 * MIN, cfg).kind, "wait");
    assert.equal(decide(state({ lastPercent: 60 }), status({}), null, t0 + 361 * MIN, cfg).kind, "resume");
  });

  it("no movement after the resume: split (a split is spend)", () => {
    const a = decide(state({ lastPercent: 93, resumesUsed: 1 }), status({}), null, t0 + 12 * MIN, cfg);
    assert.equal(a.kind, "split");
  });

  it("splits stop at 50 rows; the remainder is residue, never sent", () => {
    const a = decide(state({ lastPercent: 93, resumesUsed: 1, rows: 50 }), status({}), null, t0 + 12 * MIN, cfg);
    assert.equal(a.kind, "residue");
    assert.match(a.reason, /50-row floor/);
  });

  it("a completion with zero MV verdicts but rows marked rejected is a stall, not REJECTED", () => {
    const a = decide(state(), status({ status: "completed", final_rejected_count: 2301 }), noResults, t0, cfg);
    assert.equal(a.kind, "zero_result");
    assert.match(a.reason, /not a verdict/);
  });

  it("a completion with verdicts completes", () => {
    const a = decide(state(), status({ status: "completed", mv_ok_count: 700, mv_invalid_count: 300, final_sendable_count: 700, useful_output_count: 700 }), noResults, t0, cfg);
    assert.equal(a.kind, "complete");
  });

  it("a failed run follows the server's salvage_decision, bounded by resumes used", () => {
    const failed = status({ status: "failed" });
    const r = (action: NonNullable<VerifierResults["salvage_decision"]>["action"], extra: Partial<NonNullable<VerifierResults["salvage_decision"]>> = {}): VerifierResults => ({
      ...noResults,
      salvage_decision: { action, reason: "server said so", ...extra },
    });
    assert.equal(decide(state(), failed, r("resume"), t0, cfg).kind, "resume");
    assert.equal(decide(state({ resumesUsed: 2 }), failed, r("resume"), t0, cfg).kind, "split");
    assert.equal(decide(state(), failed, r("resume", { do_not_resume: true }), t0, cfg).kind, "split");
    assert.equal(decide(state(), failed, r("salvage"), t0, cfg).kind, "salvage_then_split");
    assert.equal(decide(state(), failed, r("done"), t0, cfg).kind, "complete");
    assert.equal(decide(state(), failed, r("fresh_ok"), t0, cfg).kind, "resume");
    assert.equal(decide(state({ resumesUsed: 1 }), failed, r("fresh_ok"), t0, cfg).kind, "split");
  });

  it("child batch names are deterministic", () => {
    assert.deepEqual(splitNames("A0"), ["A0.1", "A0.2"]);
    assert.deepEqual(splitNames("A0.2"), ["A0.2.1", "A0.2.2"]);
  });
});
