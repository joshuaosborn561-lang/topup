import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { MAPS_COPY_STATEMENT_TIMEOUT_MS } from "../canon/mapsPool.js";
import { VERB_BACKGROUND_TIMEOUT_MS } from "../jobs/runner.js";

/**
 * D62 — a background maps pull always ends done or failed with last_error.
 * The copy reads the named ICP view (not the companion join), times out,
 * and dedupes with or without a unique email index. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D62 — background maps pull cannot hang", () => {
  it("the maps copy does not join companions, skips held emails without a unique index, and sets a statement timeout", async () => {
    const pool = await readFile(new URL("src/canon/mapsPool.ts", root), "utf8");
    assert.match(pool, /not exists/i, "D62: skip already-held emails with NOT EXISTS so a missing unique index cannot fail the insert. Ask Josh.");
    assert.match(pool, /set local statement_timeout/i, "D62: the copy transaction must set a statement timeout. Ask Josh.");
    assert.match(pool, /MAPS_COPY_STATEMENT_TIMEOUT_MS/, "D62: the statement timeout must be a named constant. Ask Josh.");
    assert.equal(MAPS_COPY_STATEMENT_TIMEOUT_MS, 45_000, "D62: 45s is the copy timeout until Josh names another. Ask Josh.");
    assert.match(
      pool,
      /never the companion|Companion companies|not join companions|never joins companion/i,
      "D62: copy must not use the companion-view join (job 44fa45d9). Ask Josh.",
    );
    const copyFn = pool.slice(pool.indexOf("export async function copyMapsPool"));
    assert.doesNotMatch(
      copyFn,
      /_companies|_needs_domain/,
      "D62: copyMapsPool must not name companion views. Count still may. Ask Josh.",
    );
    assert.match(copyFn, /on conflict \(email\) do nothing/i, "D62: ON CONFLICT stays when the unique index exists. Ask Josh.");
    assert.match(copyFn, /destEmailUnique/, "D62: ON CONFLICT is optional on the unique index. Ask Josh.");
  });

  it("a background verb that throws or times out writes last_error and closes the job as failed", async () => {
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    const common = await readFile(new URL("src/stages/common.ts", root), "utf8");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(runner, /recordBackgroundFailure/, "D62: begin must record a background failure, not only log it. Ask Josh.");
    assert.match(runner, /failStep/, "D62: the background failure must write the step last_error. Ask Josh.");
    assert.match(runner, /setRunStatus\(jobId, "failed"/, "D62: the background failure must close the job as failed. Ask Josh.");
    assert.match(runner, /VERB_BACKGROUND_TIMEOUT_MS/, "D62: the background verb must have a job timeout. Ask Josh.");
    assert.equal(VERB_BACKGROUND_TIMEOUT_MS, 90_000, "D62: 90s is the job timeout until Josh names another. Ask Josh.");
    assert.match(common, /runIsOpen/, "D62: a failed job must not be rewritten to done. Ask Josh.");
    assert.match(canon, /last_error/, "D62: CANON.md must say a background pull writes last_error. Ask Josh.");
    assert.match(canon, /Canon as of \*\*D62\*\*/, "D62: fold this decision into CANON.md. Ask Josh.");
  });
});
