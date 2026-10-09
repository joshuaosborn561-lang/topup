import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GROK_MAY } from "../grok/allowlist.js";
import { SIZE_ACROSS_CLIENTS, SIZE_WITHIN_CLIENT } from "../lib/concurrency.js";
import { HIDDEN_FROM_OPERATOR, MCP_TOOL_ROLE, RETIRED_MCP_TOOLS } from "../mcp/server.js";
import { COUNT_CACHE_HOURS, PILOT_CACHE_DAYS } from "../plan/cache.js";
import { INDUSTRY_CHUNK_MAX, planSlices } from "../plan/chunk.js";
import { VENDOR_LOG_MAX, VendorCallLog } from "../plan/vendorLog.js";
import { GEO_CHUNK_MAX } from "../recipes/geoFence.js";

/** D48 — the planner, the caches, the vendor-call log, lifecycle tools and the small surface. Ask Josh. */

const root = new URL("../../", import.meta.url);

export const D48_SURFACE = [
  "topup_queue",
  "client_overview", // D49
  "campaign_history",
  "size_client",
  "approval_briefing",
  "start_topup",
  "run_status",
  "list_runs",
  "abort_run",
  "resume_run",
  "list_holds",
  "resolve_hold",
  "loads_paused",
  "lane_state",
  "lane_note",
  "add_client_domains",
] as const;

describe("D48 — planner and surface", () => {
  it("CANON, the ledger, README and the babysitter name D48 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const babysitter = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D\d+\*\*/);
    assert.match(canon, /## The planner and the surface \(D48\)/);
    assert.match(canon, /No tool returns a lead\s+row or a file URL/);
    assert.match(ledger, /## D48 — /);
    assert.match(ledger, /^\| D48 \| Live/m);
    for (const tool of D48_SURFACE) {
      assert.match(readme, new RegExp(`\`${tool}\``), `D48: README must list \`${tool}\`. Ask Josh.`);
      assert.match(babysitter, new RegExp(`\`${tool}\``), `D48: the babysitter must allowlist \`${tool}\`. Ask Josh.`);
    }
  });

  it("the surface is exactly the agreed tools (fifteen by D48, client_overview by D49), all operator-visible, none hidden, the retired ones gone", () => {
    assert.deepEqual(Object.keys(MCP_TOOL_ROLE).sort(), [...D48_SURFACE].sort(), "D48: adding or removing a tool is a new decision. Ask Josh.");
    for (const tool of D48_SURFACE) assert.equal(MCP_TOOL_ROLE[tool], "operator", `D48: ${tool} is for Cayden as well as Josh`);
    assert.deepEqual([...HIDDEN_FROM_OPERATOR], []);
    for (const tool of RETIRED_MCP_TOOLS) {
      assert.equal(MCP_TOOL_ROLE[tool], undefined, `D48: ${tool} is retired`);
      assert.ok(!(GROK_MAY as readonly string[]).includes(tool), `D48: Grok must not be told it may call ${tool}`);
    }
    for (const tool of D48_SURFACE) assert.ok((GROK_MAY as readonly string[]).includes(tool), `D48: Grok babysitter may call ${tool}`);
  });

  it("queries are sliced before the call; caches and the vendor log have the agreed limits", () => {
    assert.equal(GEO_CHUNK_MAX, 45);
    assert.equal(INDUSTRY_CHUNK_MAX, 12);
    assert.equal(planSlices({ job_titles: ["Owner"], cities: Array.from({ length: 137 }, (_, i) => `c${i}`) }).slices.length, 4);
    assert.equal(COUNT_CACHE_HOURS, 24);
    assert.equal(PILOT_CACHE_DAYS, 30);
    assert.equal(VENDOR_LOG_MAX, 60);
    assert.equal(SIZE_WITHIN_CLIENT, 4);
    assert.equal(SIZE_ACROSS_CLIENTS, 8);
  });

  it("the vendor log keeps the outcome and strips addresses; a failure is rethrown after it is logged", async () => {
    const log = new VendorCallLog(() => 0);
    await assert.rejects(log.time("aiark", "people_preview", async () => { throw new Error("HTTP 401 from preview: bad token for jane@acme.com"); }));
    assert.equal(log.calls.length, 1);
    assert.equal(log.calls[0]?.ok, false);
    assert.equal(log.calls[0]?.status, 401);
    assert.equal(log.calls[0]?.message?.includes("@"), false, "D48/D2: the log never carries an address");
    const r = await log.time("getleads", "count", async () => ({ total_matching: 5 }), (v) => v.total_matching);
    assert.equal(r.total_matching, 5);
    assert.equal(log.calls[1]?.rows, 5);
    assert.deepEqual(log.summary(), { vendor_calls: 2, vendor_calls_failed: 1, vendor_calls_cached: 0 });
  });

  it("the orchestrator exposes abort and resume for any open run, and the size stage is the planner", async () => {
    const orchestrator = await readFile(new URL("src/orchestrator.ts", root), "utf8");
    assert.match(orchestrator, /async abortRun\(/);
    assert.match(orchestrator, /async resumeRun\(/);
    const size = await readFile(new URL("src/stages/size/index.ts", root), "utf8");
    assert.match(size, /planSize\(/);
    assert.match(size, /nothing_to_pull/);
    const slack = await readFile(new URL("src/slack/client.ts", root), "utf8");
    assert.match(slack, /When no token is configured every post is logged and dropped/, "D48: Slack stays optional");
  });
});
