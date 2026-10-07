import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeMatchSql, shouldReuseIngest } from "./dedupe.js";
import { sourceLabel } from "./index.js";
import type { RunRow } from "../../domain/runs.js";

describe("ingest is idempotent and deduped across campaigns", () => {
  it("reuses a job or rows already stored for the same run and campaign", () => {
    const run = { run_id: "da2e3d68-c119-4422-b953-73dde724808a", client_tag: "emcor", lane: "a_property_facilities" } as RunRow;
    const label = sourceLabel(run, 4036499);
    assert.equal(sourceLabel(run, 4036499), label);
    assert.equal(shouldReuseIngest("job-1", 0), true);
    assert.equal(shouldReuseIngest(null, 1404), true);
    assert.equal(shouldReuseIngest(null, 0), false);
    assert.match(label, /da2e3d68_c4036499$/);
  });

  it("matches email and person id when those columns exist", () => {
    const match = dedupeMatchSql(new Set(["email", "person_id", "city"]));
    assert.ok(match);
    assert.match(match, /lower\(a\.email\)/);
    assert.match(match, /a\."person_id"/);
    assert.doesNotMatch(match, /city/);
    assert.equal(dedupeMatchSql(new Set(["city"])), null);
  });
});
