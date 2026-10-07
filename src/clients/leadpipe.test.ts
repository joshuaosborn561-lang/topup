import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ingestJobFromResponse, lpRunJobFromResponse } from "./leadpipe.js";

describe("lp_run ingest_csv job id", () => {
  it("reads job_id from result when the tool wraps the payload", () => {
    const wrapped = { ok: true, tool: "ingest_csv", result: { job_id: "x" } };
    assert.deepEqual(lpRunJobFromResponse(wrapped), { job_id: "x", status: "queued" });
    assert.deepEqual(ingestJobFromResponse(wrapped), { job_id: "x", status: "queued" });
  });

  it("parses result when it arrives as a JSON string", () => {
    const wrapped = { ok: true, tool: "ingest_csv", result: JSON.stringify({ job_id: "x", status: "running" }) };
    assert.deepEqual(lpRunJobFromResponse(wrapped), { job_id: "x", status: "running" });
    assert.deepEqual(ingestJobFromResponse(wrapped), { job_id: "x", status: "running" });
  });

  it("keeps a top-level job_id", () => {
    const parsed = ingestJobFromResponse({ job_id: 44, status: "queued" });
    assert.deepEqual(parsed, { job_id: "44", status: "queued" });
  });

  it("parks with the response error instead of the key list", () => {
    const parsed = ingestJobFromResponse({ ok: false, tool: "ingest_csv", result: { error: "the signed url expired" } });
    assert.deepEqual(parsed, { error: "the signed url expired" });
  });
});
