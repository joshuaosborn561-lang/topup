import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ingestJobFromResponse, lpExportFromResponse, lpRunJobFromResponse } from "./leadpipe.js";

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

describe("D64 — lp_export unwraps {ok, tool, result}", () => {
  it("reads signed_url and row_count from result", () => {
    const wrapped = { ok: true, tool: "lp_export", result: { signed_url: "https://example.test/x.csv", row_count: 140 } };
    assert.deepEqual(lpExportFromResponse(wrapped), { signed_url: "https://example.test/x.csv", row_count: 140 });
  });

  it("still accepts the flat shape", () => {
    assert.deepEqual(lpExportFromResponse({ signed_url: "https://example.test/y.csv", row_count: 3 }), {
      signed_url: "https://example.test/y.csv",
      row_count: 3,
    });
  });

  it("names the wrapper keys when result has no url (job 46b1c941)", () => {
    const parsed = lpExportFromResponse({ ok: true, tool: "result" });
    assert.ok("error" in parsed);
    if ("error" in parsed) assert.match(parsed.error, /signed_url\/row_count/);
  });
});
