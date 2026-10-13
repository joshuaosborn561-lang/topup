import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { approverRule, parseApprovers, TopupRunner } from "../jobs/runner.js";

/**
 * D101 — who approves is a Railway setting; a yes is to an amount; a
 * restart finishes what a person started. Ask Josh before widening the
 * list or the tolerance.
 */
describe("D101 — approvers and the amount a yes covers", () => {
  it("TOPUP_APPROVERS is read from the environment and only those names approve", () => {
    assert.equal(loadConfig({}).TOPUP_APPROVERS, "");
    assert.deepEqual(parseApprovers(loadConfig({ TOPUP_APPROVERS: "Josh" }).TOPUP_APPROVERS), ["josh"]);
    assert.deepEqual(parseApprovers(""), ["josh", "cayden"], "D92 default");
    const r = new TopupRunner({ repo: {} as never, stages: {} as never, console: {} as never, approvers: ["josh"] });
    assert.equal(r.isApprover("Josh"), true);
    assert.equal(r.isApprover("Cayden"), false);
    assert.equal(r.isApprover(""), false);
    assert.match(approverRule(["josh"]), /Only Josh approves/);
  });

  it("the runner stops a step priced more than a tenth above the quote, resumes interrupted jobs on boot, and abort removes unloaded rows", async () => {
    const src = await readFile(new URL("../jobs/runner.ts", import.meta.url), "utf8");
    assert.match(src, /asked > Math\.ceil\(quoted \* 1\.1\)/, "D101: the tolerance is a tenth of the quoted figure");
    assert.match(src, /async resumeInterrupted\(/, "D101: boot resumes what a restart cut off");
    assert.match(src, /delete from \$\{table\} where run_id = \$1 and lead_status not in \$\{keep\}/, "D101: abort takes a file pool's unloaded rows out of the lane");
    const boot = await readFile(new URL("../index.ts", import.meta.url), "utf8");
    assert.match(boot, /resumeInterrupted\("boot"\)/);
    const canon = await readFile(new URL("../../CANON.md", import.meta.url), "utf8");
    assert.match(canon, /TOPUP_APPROVERS/);
  });
});
