import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FETCH_PARALLEL, fetchAll, gradeAll, PEOPLE_EXTRACT_PARALLEL, PEOPLE_EXTRACT_WORKERS, PEOPLE_FETCH_WORKERS, peopleLoopConfig } from "./loops.js";

describe("D73 — people loops fan out; ICP stays at three-wide fetch", () => {
  it("ships ~50 fetch workers and ~28 Gemini / Jev, overridable by env and params", () => {
    const d = peopleLoopConfig({});
    assert.equal(d.fetch.parallel * d.fetch.workers, 50, "D73: 2 × 25 fetch workers");
    assert.equal(d.extract.parallel * d.extract.workers, 28, "D73: 4 × 7 Gemini workers");
    assert.equal(d.ask.parallel * d.ask.workers, 28);
    assert.equal(d.perHost, 2);
    assert.equal(d.geminiRpm, 200);
    assert.equal(FETCH_PARALLEL, 3, "D73: the ICP fetch loop is unchanged");
    const over = peopleLoopConfig({ SITE_PEOPLE_EXTRACT_PARALLEL: "3", SITE_PEOPLE_EXTRACT_WORKERS: "10" }, { fetch_parallel: 5 });
    assert.equal(over.extract.parallel, 3);
    assert.equal(over.extract.workers, 10);
    assert.equal(over.fetch.parallel, 5);
    assert.equal(PEOPLE_FETCH_WORKERS, 25);
    assert.equal(PEOPLE_EXTRACT_PARALLEL, 4);
    assert.equal(PEOPLE_EXTRACT_WORKERS, 7);
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
