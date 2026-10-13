import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finderEstimateFrom, finderJobFrom, finderSourceArg, unwrapFinder } from "./emailFinder.js";

/** D103 — the email finder's answers, read as the server writes them. No vendor call here. Ask Josh. */
describe("D103 — email finder answers", () => {
  it("unwraps a JSON string, with or without the MCP {result} wrapper", () => {
    assert.deepEqual(unwrapFinder('{"job_id":"j1","status":"queued"}'), { job_id: "j1", status: "queued" });
    assert.deepEqual(unwrapFinder({ result: '{"job_id":"j2"}' }), { job_id: "j2" });
    assert.deepEqual(unwrapFinder({ job_id: "j3" }), { job_id: "j3" });
  });

  it("reads an estimate and a refusal over the ceiling", () => {
    assert.deepEqual(finderEstimateFrom('{"rows_in":191,"estimated_cost_usd":4.2,"spend":0}'), { rows: 191, estimated_cost_usd: 4.2, refused: false });
    assert.equal(finderEstimateFrom({ rows_in: 9, estimated_cost_usd: 9, would_refuse: true }).refused, true);
  });

  it("reads a job: running, done with spend and finds, stopped at the ceiling, failed", () => {
    assert.equal(finderJobFrom({ status: "running", result: {} }).status, "running");
    const done = finderJobFrom(JSON.stringify({ status: "completed", result: { status: "completed", spend: 1.25, emails_found: 40 } }));
    assert.deepEqual(done, { status: "done", outcome: "completed", spend_usd: 1.25, emails_found: 40, error: null });
    assert.equal(finderJobFrom({ status: "completed", result: { status: "refused_over_ceiling", spend: 0 } }).outcome, "refused_over_ceiling");
    const failed = finderJobFrom({ status: "failed", error: "RuntimeError: boom" });
    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "RuntimeError: boom");
  });

  it("points the finder at the lane table by id, with the lane's column names", () => {
    const src = finderSourceArg({ schema: "lp", table: "acme_ingested_leads", where: "run_id = 'r' and lead_status = 'needs_email'" });
    assert.equal(src.key_column, "id");
    assert.deepEqual((src.map as Record<string, string>).domain, "company_domain");
    assert.equal(src.schema, "lp");
  });
});
