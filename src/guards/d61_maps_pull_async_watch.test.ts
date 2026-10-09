import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { isSelfStart, isWatchActor } from "../jobs/selfStart.js";

/**
 * D61 — maps pull insert is idempotent on email; pull returns a job id
 * and runs in the background; nothing opens as the watch. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D61 — maps pull idempotent, async, no self-start", () => {
  it("the maps copy dedupes the batch and skips emails already held", async () => {
    const pool = await readFile(new URL("src/canon/mapsPool.ts", root), "utf8");
    assert.match(pool, /distinct on \(email\)/i, "D61: the maps copy must dedupe the batch on email. Ask Josh.");
    assert.match(pool, /on conflict \(email\) do nothing/i, "D61: the maps copy must skip emails already in lp.<tag>_ingested_leads. Ask Josh.");
    assert.match(pool, /already_held/, "D61: skipped emails are counted as already_held. Ask Josh.");
    assert.doesNotMatch(pool, /\b(dl_status|sg_exclude)\s*=/, "D61: never write dl_status or sg_exclude. Ask Josh.");
  });

  it("pull returns a job id and starts the verb in the background", async () => {
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(runner, /async begin\(/, "D61: JobRunner.begin starts a verb without holding the caller. Ask Josh.");
    assert.match(runner, /status: "started"/, "D61: begin returns status started. Ask Josh.");
    assert.match(grok, /d\.jobs\.begin\(id, "pull"/, "D61: the pull tool must return before pull+ingest finish. Ask Josh.");
    assert.doesNotMatch(grok, /d\.jobs\.run\(id, "pull"/, "D61: the pull tool must not await the full pull on the MCP call. Ask Josh.");
    assert.match(canon, /returns the `job_id` at once/i, "D61: CANON.md must say pull returns the job id at once. Ask Josh.");
  });

  it("nothing opens as the watch, and a watch or runway trigger is refused", async () => {
    assert.equal(isWatchActor("watch"), true);
    assert.equal(isWatchActor("the watch"), true);
    assert.equal(isWatchActor("mcp:operator"), false);
    assert.equal(isSelfStart("watch", "runway"), true);
    assert.equal(isSelfStart("the watch", "manual"), true);
    assert.equal(isSelfStart("mcp:operator", "runway"), true);
    assert.equal(isSelfStart("mcp:operator", "scheduled"), true);
    assert.equal(isSelfStart("mcp:operator", "manual"), false);

    const repo = await readFile(new URL("src/db/repo.ts", root), "utf8");
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    const boot = await readFile(new URL("src/index.ts", root), "utf8");
    assert.match(repo, /isSelfStart\(input\.opened_by, input\.trigger\)/, "D61: openRun must refuse the watch. Ask Josh.");
    assert.match(runner, /isWatchActor\(by\)/, "D61: JobRunner.open must refuse a watch actor. Ask Josh.");
    assert.match(boot, /nothing is driven on boot \(D51, D61\)/, "D61: boot must not drive leftover watch runs. Ask Josh.");
    assert.doesNotMatch(boot, /cron\.schedule|startTopup|resumeOpenRuns/, "D61: boot must not schedule or resume a watch. Ask Josh.");
  });
});
