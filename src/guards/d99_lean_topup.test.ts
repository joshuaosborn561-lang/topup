import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_TOOLS, LEADPIPE_RULE } from "../grok/allowlist.js";
import { MCP_TOOL_ROLE, RETIRED_MCP_TOOLS } from "../mcp/server.js";
import { loadConfig } from "../config.js";

/**
 * D99 — the lean top-up. The canon tools, LeadPipe always, no legacy pull,
 * recipe or count code left to confuse the bot. D100 adds the playbook read.
 * Ask Josh or Cayden before adding a tool, a client, a recipe or a vendor client here.
 */
const root = new URL("../../", import.meta.url);

async function exists(rel: string): Promise<boolean> {
  return stat(new URL(rel, root)).then(() => true, () => false);
}

describe("D99 — the lean top-up", () => {
  it("the MCP surface is exactly the canon tools", async () => {
    assert.deepEqual([...Object.keys(MCP_TOOL_ROLE)].sort(), [...CANON_TOOLS].sort());
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    const server = await readFile(new URL("src/mcp/server.ts", root), "utf8");
    const registered = [...`${grok}\n${server}`.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(registered.sort(), [...CANON_TOOLS].sort(), "D99: every registered tool is in CANON_TOOLS and vice versa.");
    for (const t of ["pull", "count", "held", "size", "enrich", "site_check", "write_receipt", "confirm_filters", "resolve", "note", "holds", "leftovers", "sources", "campaign_record"]) {
      assert.ok(RETIRED_MCP_TOOLS.includes(t), `D99: ${t} is retired and must say so`);
    }
  });

  it("the legacy pull, recipe, count and per-client code is gone", async () => {
    for (const rel of ["src/stages/pull/", "src/stages/puzzle/", "src/stages/find_emails/", "src/recipes/", "src/pilot/", "src/clients/getleads.ts", "src/clients/aiArkPreview.ts", "src/canon/count.ts", "src/canon/held.ts", "src/canon/size.ts", "src/canon/siteCheck.ts", "src/jobs/recipe.ts", "src/orchestrator.ts"]) {
      assert.equal(await exists(rel), false, `D99: ${rel} is legacy and must not come back`);
    }
    const clients = (await readdir(new URL("src/clients/", root))).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();
    assert.deepEqual(clients, ["icpGate.ts", "leadpipe.ts", "mcpHttp.ts", "smartlead.ts", "verifier.ts"], "D99: the service calls LeadPipe, the verifier, Smartlead and the ICP gate. Nothing else.");
    const cfg = loadConfig({});
    for (const k of ["GETLEADS_TOKEN", "AI_ARK_TOKEN", "PROSPEO_API_KEY", "SITE_PEOPLE_KEY", "NAME_TO_EMAIL_MCP_URL"]) assert.ok(!(k in cfg), `D99: config no longer carries ${k}`);
  });

  it("the hard rule is on every tool that moves rows, and the canon opens with the connectors", async () => {
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.ok(grok.includes("LEADPIPE_RULE"), "D99: topup and build_record carry LEADPIPE_RULE");
    assert.match(LEADPIPE_RULE, /LeadPipe/);
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /## Connect first/);
    assert.match(canon, /Every lead row moves through LeadPipe/);
    assert.match(canon, /Josh or Cayden approves every spend/);
    assert.match(canon, /No recorded build means wait/);
    assert.ok(canon.split("\n").length < 140, "D99: the canon is one page");
  });
});
