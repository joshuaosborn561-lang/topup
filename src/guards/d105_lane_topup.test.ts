import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_TOOLS } from "../grok/allowlist.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { isRefillableStatus, isStoppedStatus } from "../policy/rules.js";

/**
 * D105 — top-ups size the lane, not one segment campaign; STOPPED is
 * never refilled. Ask Josh before changing either rule.
 */
const root = new URL("../../", import.meta.url);

describe("D105 — lane-level top-up; never refill STOPPED", () => {
  it("the canon states the lane sizing rule and the never-refill-STOPPED rule", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D105\*\*/);
    assert.match(canon, /Top-ups size the lane, not one segment campaign/);
    assert.match(canon, /STOPPED is never refilled/);
    assert.match(canon, /PAUSED may be/);
    assert.match(canon, /If the split cannot be determined, stop and\s+report/);
    assert.ok(canon.split("\n").length < 140, "D99: the canon is one page");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /Size the lane, not one segment/);
    assert.match(skill, /STOPPED is out of the sum/);
  });

  it("the surface is still the lean tools; lane is a parameter on campaigns and topup, not a new verb", async () => {
    assert.deepEqual([...Object.keys(MCP_TOOL_ROLE)].sort(), [...CANON_TOOLS].sort());
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /lane: snake\.optional/);
    assert.match(grok, /lanes\[\] is the lane runway/);
    assert.doesNotMatch(grok, /registerTool\(\s*"(lane_topup|split|segment)"/);
    const campaigns = await readFile(new URL("src/canon/campaigns.ts", root), "utf8");
    assert.match(campaigns, /function rollupLanes/);
    assert.match(campaigns, /STOPPED/);
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.match(runner, /planLaneJob/);
    assert.match(runner, /scope === "lane"/);
    const route = await readFile(new URL("src/stages/route/index.ts", root), "utf8");
    assert.match(route, /dropStoppedRouting/);
    assert.match(route, /STOPPED is never refilled \(D105\)/);
  });

  it("STOPPED is never refillable; PAUSED is", () => {
    assert.equal(isStoppedStatus("STOPPED"), true);
    assert.equal(isStoppedStatus("stopped"), true);
    assert.equal(isStoppedStatus("ACTIVE"), false);
    assert.equal(isRefillableStatus("PAUSED"), true);
    assert.equal(isRefillableStatus("ACTIVE"), true);
    assert.equal(isRefillableStatus("STOPPED"), false);
    assert.equal(isRefillableStatus(null), true);
  });

  it("the decision is in the ledger and names who to ask", async () => {
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^## D105 — /m);
    assert.match(ledger, /^\| D105 \|/m);
    assert.match(ledger, /Ask Josh/);
    assert.doesNotMatch(ledger.split("## D105")[1] ?? "", /@/, "D2: no addresses in the decision");
  });
});
