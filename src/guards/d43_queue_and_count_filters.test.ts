import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GROK_MAY } from "../grok/allowlist.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { GETLEADS_COUNT_KEYS, outboundFilters, type GetleadsFilters } from "../clients/getleads.js";
import { TOPUP_QUEUE_DESCRIPTION } from "../mcp/queue.js";
import { SERVICE_VERSION } from "../version.js";

/** D43 — Cayden's queue, and count_contacts is count filters only. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D43 — topup_queue and count_contacts filters", () => {
  it("CANON, the ledger, and README name the queue and the count-filter rule — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const servers = await readFile(new URL("skills/MCP_SERVERS.md", root), "utf8");
    const agents = await readFile(new URL("AGENTS.md", root), "utf8");
    const babysitter = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as { version: string };
    assert.match(canon, /Canon as of \*\*D43\*\*/);
    assert.match(canon, /topup_queue/);
    assert.match(canon, /No Slack, no Cursor/);
    assert.match(canon, /max_per_company/);
    assert.match(ledger, /## D43 — /);
    assert.match(ledger, /topup_queue/);
    assert.match(ledger, /max_per_company/);
    assert.match(ledger, /Do not put `max_per_company` in the count filters\./);
    assert.match(readme, /`topup_queue`/);
    assert.match(servers, /topup_queue/);
    assert.match(agents, /topup_queue/);
    assert.match(babysitter, /topup_queue/);
    assert.equal(pkg.version, SERVICE_VERSION, "D43: package.json version must match SERVICE_VERSION. Ask Josh.");
    assert.equal(SERVICE_VERSION, "0.3.0");
  });

  it("the queue is operator-readable, ranked, and not on LeadPipe — Ask Josh", async () => {
    assert.equal(MCP_TOOL_ROLE.topup_queue, "operator", "D43: topup_queue is for Cayden. Ask Josh.");
    assert.ok((GROK_MAY as readonly string[]).includes("topup_queue"), "D43: Grok babysitter may call topup_queue. Ask Josh.");
    assert.match(TOPUP_QUEUE_DESCRIPTION, /Open the queue, pick the top one/);
    assert.match(TOPUP_QUEUE_DESCRIPTION, /never lead rows/);
    const server = await readFile(new URL("src/mcp/server.ts", root), "utf8");
    assert.match(server, /topup_queue/);
    assert.match(server, /buildTopupQueue/);
    const queue = await readFile(new URL("src/mcp/queue.ts", root), "utf8");
    assert.match(queue, /rankQueueItems/);
    assert.match(queue, /recipe_summary/);
    assert.ok(!queue.includes("create table"), "D43: no schema changes. Ask Josh.");
    const leadpipe = await readFile(new URL("src/clients/leadpipe.ts", root), "utf8");
    const leadpipeSkill = await readFile(new URL("skills/leadpipe/SKILL.md", root), "utf8");
    assert.ok(!leadpipe.includes("topup_queue"), "D43: do not add this tool to LeadPipe. Ask Josh.");
    assert.ok(!leadpipeSkill.includes("topup_queue"), "D43: do not add this tool to LeadPipe. Ask Josh.");
  });

  it("count_contacts never receives max_per_company or numeric employee bounds — Ask Josh", async () => {
    assert.ok(!GETLEADS_COUNT_KEYS.includes("max_per_company" as never), "D43: max_per_company is an export cap. Ask Josh.");
    const client = await readFile(new URL("src/clients/getleads.ts", root), "utf8");
    assert.match(client, /GETLEADS_COUNT_KEYS/);
    assert.match(client, /Do not put it in the count filters/);
    const out = outboundFilters({
      job_titles: ["IT Director"],
      company_size: ["11 to 50", "51 to 200"],
      countries: ["United States"],
      max_per_company: 3,
    } as GetleadsFilters);
    assert.deepEqual(out.company_size, ["11 to 50", "51 to 200"]);
    assert.equal("max_per_company" in out, false, "D43: Parlay size parked on unrecognized max_per_company. Ask Josh.");
    assert.equal("employees_min" in out, false);
  });
});
