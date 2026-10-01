import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { WORKING_UNDER_2000_SENDS, isWorking } from "../domain/working.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { TOPUP_QUEUE_DESCRIPTION } from "../mcp/queue.js";
import { CLIENT_MAP_SQL } from "../mcp/recipe.js";
import { SERVICE_VERSION } from "../version.js";
import { WATCHDOG_NEARLY_DONE_REMAINING_SHARE, isWatchdogLeadNeed, watchdogLeadFlag } from "../watch/decide.js";

/** D44 — queue matches #campaign-watchdog lead flags; 1 reply under 2k is working. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D44 — topup_queue has watchdog visibility and the 1-in-2000 gate", () => {
  it("CANON, the ledger, and the queue name the watchdog board and the under-2k clause — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const babysitter = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as { version: string };
    assert.match(canon, /Canon as of \*\*D44\*\*/);
    assert.match(canon, /#campaign-watchdog/);
    assert.match(canon, /under 2,000 sends/);
    assert.match(ledger, /## D44 — /);
    assert.match(ledger, /#campaign-watchdog/);
    assert.match(ledger, /under 2,000/);
    assert.match(readme, /#campaign-watchdog/);
    assert.match(babysitter, /#campaign-watchdog/);
    assert.equal(pkg.version, SERVICE_VERSION, "D44: package.json version must match SERVICE_VERSION. Ask Josh.");
    assert.equal(SERVICE_VERSION, "0.4.0");
  });

  it("the queue walks client_map, not only a file recipe skip — Ask Josh", async () => {
    const queue = await readFile(new URL("src/mcp/queue.ts", root), "utf8");
    assert.match(queue, /loadClientMap/);
    assert.match(queue, /watchdogLeadFlag/);
    assert.match(queue, /client_under_floor/);
    assert.match(queue, /working_reason/);
    assert.ok(!queue.includes("if (snap.decision.kind === \"skip\") continue"), "D44: do not hide watchdog dry camps when D38 skips. Ask Josh.");
    assert.equal(CLIENT_MAP_SQL, "select client_tag, smartlead_client_id from topup.client_map order by 1");
    assert.equal(MCP_TOOL_ROLE.topup_queue, "operator", "D44: topup_queue is still for Cayden. Ask Josh.");
    assert.match(TOPUP_QUEUE_DESCRIPTION, /#campaign-watchdog/);
    assert.match(TOPUP_QUEUE_DESCRIPTION, /under 2,000/);
    const leadpipe = await readFile(new URL("src/clients/leadpipe.ts", root), "utf8");
    assert.ok(!leadpipe.includes("topup_queue"), "D44: do not add this tool to LeadPipe. Ask Josh.");
  });

  it("1 interested in under 2,000 sends is working; silent is not a lead flag — Ask Josh", () => {
    assert.equal(WORKING_UNDER_2000_SENDS, 2000);
    assert.equal(WATCHDOG_NEARLY_DONE_REMAINING_SHARE, 0.1);
    const v = isWorking({
      interestedPer2000: 1,
      variantMinSends: 1000,
      override: null,
      sends: 1800,
      interested: 1,
      variants: [],
    });
    assert.equal(v.working, true, "D44: 1 reply under 2k sends is acceptable. Ask Josh.");
    assert.equal(
      isWatchdogLeadNeed({
        smartlead_campaign_id: 1,
        name: "x",
        status: "ACTIVE",
        leads_total: 100,
        untouched: 80,
        sends_window: 0,
        last_send_at: null,
        interested_window: 0,
        bounces_window: 0,
        synced_at: null,
        sending: false,
        runway_days: null,
        flags: ["silent"],
      }),
      false,
      "D44: silent / not-sending is not a lead refill. Ask Josh.",
    );
    assert.equal(
      watchdogLeadFlag({
        smartlead_campaign_id: 2,
        name: "y",
        status: "ACTIVE",
        leads_total: 600,
        untouched: 60,
        sends_window: 70,
        last_send_at: null,
        interested_window: 1,
        bounces_window: 0,
        synced_at: null,
        sending: true,
        runway_days: 20,
        flags: [],
      }),
      "nearly_done",
    );
  });
});
