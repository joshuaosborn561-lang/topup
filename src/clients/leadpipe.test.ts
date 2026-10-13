import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_DONE, jobStatusFromResponse, lpRunJobFromResponse } from "./leadpipe.js";

/** D99 — lp_status is read off `result`, the ingest counts off `result.results_summary` (job 756c7271, 13 Oct 2026). */
describe("LeadPipe answers as the service reads them", () => {
  it("sees a completed ingest and every row LeadPipe read", () => {
    const live = {
      ok: true,
      tool: "lp_status",
      result: {
        status: "completed",
        rows_done: 3,
        rows_total: 3,
        useful_output_count: 127,
        results_summary: { ok: true, note: "Pass-through CSV/XLSX ingest — counts only. WARNING: optional fields not mapped from headers: employee_range.", rows_read: 1204, filtered_out: 931, dupes_dropped: 146, rows_inserted: 127, files_processed: 3 },
        error: null,
      },
    };
    const s = jobStatusFromResponse(live);
    assert.equal(s.status, "completed");
    assert.ok(JOB_DONE.includes(s.status));
    assert.equal(s.rows_read, 1204);
    assert.equal(s.filtered_out, 931);
    assert.equal(s.dupes_dropped, 146);
    assert.equal(s.rows_inserted, 127);
    assert.match(s.note!, /employee_range/);
    assert.equal(s.rows_read, s.rows_inserted! + s.dupes_dropped! + s.filtered_out!, "every row read is accounted for");
  });

  it("still reads the flat shape and a string result, and a queued job is running", () => {
    assert.equal(jobStatusFromResponse({ status: "queued" }).status, "queued");
    assert.equal(jobStatusFromResponse({ ok: true, result: JSON.stringify({ status: "failed", error: "bad url" }) }).error, "bad url");
    assert.equal(jobStatusFromResponse({ ok: true, tool: "lp_status" }).status, "unknown");
    const started = lpRunJobFromResponse({ ok: true, tool: "lp_run", result: { job_id: "j1", status: "queued" } });
    assert.deepEqual(started, { job_id: "j1", status: "queued" });
  });
});
