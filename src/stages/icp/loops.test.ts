import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FETCH_PARALLEL, fetchAll, gradeAll } from "./loops.js";

describe("D60 — the ICP gate loops", () => {
  it("the ICP fetch loop is three wide", () => {
    assert.equal(FETCH_PARALLEL, 3);
  });

  it("fetchAll and gradeAll run `parallel` invocations side by side and stop when nothing is left", async () => {
    let fetchIn = 0;
    let fetchMax = 0;
    let fetchCalls = 0;
    const fetched = await fetchAll(
      {
        fetchSites: async () => {
          fetchCalls += 1;
          fetchIn += 1;
          fetchMax = Math.max(fetchMax, fetchIn);
          await new Promise((r) => setTimeout(r, 15));
          fetchIn -= 1;
          return { processed: fetchCalls <= 2 ? 4 : 0, ok: 4, released: 0, remaining: fetchCalls <= 2 ? 1 : 0 };
        },
      },
      "b",
      { parallel: 2, perCall: 10, workers: 5, maxCalls: 8 },
    );
    assert.equal(fetchMax, 2);
    assert.ok(fetched.fetched >= 8);

    let gradeIn = 0;
    let gradeMax = 0;
    const left: number[] = [1, 1, 1, 1, 1, 1];
    const graded = await gradeAll(
      async (n, w) => {
        assert.equal(n, 3);
        assert.equal(w, 4);
        gradeIn += 1;
        gradeMax = Math.max(gradeMax, gradeIn);
        await new Promise((r) => setTimeout(r, 15));
        gradeIn -= 1;
        const processed = left.pop() ? 1 : 0;
        return { processed, errors: 0, last_error: null, remaining: left.length };
      },
      { parallel: 3, perCall: 3, workers: 4, maxCalls: 12 },
    );
    assert.equal(gradeMax, 3);
    assert.equal(graded.graded, 6);
  });
});
