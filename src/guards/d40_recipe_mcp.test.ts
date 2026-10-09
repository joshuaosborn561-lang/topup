import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GROK_MAY } from "../grok/allowlist.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import {
  CAMPAIGN_NOT_FOUND,
  CLIENT_MAP_TAGS_SQL,
  TOPUP_CAMPAIGN_BUILDS_SQL,
  TOPUP_PROVENANCE_GAPS_SQL,
  TOPUP_RECIPE_DESCRIPTION,
  TOPUP_RECIPE_SQL,
} from "../mcp/recipe.js";
import { notWorkingCard } from "../slack/cards.js";
import { MCP_HTTPS_URL, SERVICE_VERSION } from "../version.js";

/** D40 — live pull recipe MCP on this service, not LeadPipe. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D40 — live pull recipe lives on this service", () => {
  it("CANON, the ledger, and README name the live pull record tool and the HTTPS URL — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const servers = await readFile(new URL("skills/MCP_SERVERS.md", root), "utf8");
    const agents = await readFile(new URL("AGENTS.md", root), "utf8");
    const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8")) as { version: string };
    assert.match(canon, /Canon as of \*\*D\d+\*\*/);
    // D48 folded topup_recipe / topup_campaign_builds / topup_provenance_gaps into campaign_history.
    assert.match(canon, /campaign_history/);
    assert.match(canon, /topup\.recipe\(\)/);
    assert.match(canon, /not on LeadPipe/);
    assert.match(canon, /any_reconstructed/);
    assert.match(canon, /leads_without_method/);
    assert.match(canon, new RegExp(MCP_HTTPS_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(ledger, /## D40 — Live pull recipe lives on this service/);
    assert.match(ledger, /not on LeadPipe/);
    assert.match(ledger, /campaign not found in public\.campaigns/);
    assert.match(readme, /`campaign_history`/);
    assert.match(readme, /select topup\.recipe\(\$1, \$2\)/);
    assert.match(readme, new RegExp(MCP_HTTPS_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(servers, /leadtopup/);
    assert.match(servers, /campaign_history/);
    assert.match(servers, /Not LeadPipe/);
    assert.match(agents, /campaign_history/);
    assert.equal(pkg.version, SERVICE_VERSION, "D40: package.json version must match SERVICE_VERSION. Ask Josh.");
    assert.match(SERVICE_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it("the live pull record is operator-readable, one SQL each, and not registered on LeadPipe — Ask Josh", async () => {
    assert.equal(MCP_TOOL_ROLE.campaign_history, "operator", "D40/D48: campaign_history is for Cayden as well as Josh. Ask Josh.");
    assert.ok((GROK_MAY as readonly string[]).includes("campaign_history"), "D40/D48: Grok babysitter may call campaign_history. Ask Josh.");
    for (const t of ["topup_recipe", "topup_campaign_builds", "topup_provenance_gaps"]) {
      assert.equal(MCP_TOOL_ROLE[t], undefined, `D48: ${t} is retired; campaign_history replaced it. Ask Josh.`);
    }
    assert.equal(TOPUP_RECIPE_SQL, "select topup.recipe($1, $2)");
    assert.equal(
      TOPUP_CAMPAIGN_BUILDS_SQL,
      "select * from topup.campaign_builds where client_tag = $1 and smartlead_campaign_id = $2 order by leads desc",
    );
    assert.equal(TOPUP_PROVENANCE_GAPS_SQL, "select * from topup.provenance_gaps where client_tag = $1");
    assert.match(TOPUP_RECIPE_DESCRIPTION, /Read before any top up/);
    assert.equal(CAMPAIGN_NOT_FOUND, "campaign not found in public.campaigns");
    assert.equal(CLIENT_MAP_TAGS_SQL, "select client_tag from topup.client_map order by 1");
    const server = await readFile(new URL("src/mcp/server.ts", root), "utf8");
    assert.match(server, /applyMcpCors/);
    assert.match(server, /OPTIONS/);
    assert.match(server, /Access-Control-Allow-Origin/);
    const leadpipe = await readFile(new URL("src/clients/leadpipe.ts", root), "utf8");
    const leadpipeSkill = await readFile(new URL("skills/leadpipe/SKILL.md", root), "utf8");
    assert.ok(!leadpipe.includes("topup_recipe"), "D40: do not add these tools to LeadPipe. Ask Josh.");
    assert.ok(!leadpipeSkill.includes("topup_recipe"), "D40: do not add these tools to LeadPipe. Ask Josh.");
    const migrations = await readFile(new URL("src/mcp/recipe.ts", root), "utf8");
    assert.ok(!migrations.includes("create table"), "D40: no schema changes; the function and views already exist. Ask Josh.");
  });

  it("the watch Slack card includes the recipe summary and never the method paragraph — Ask Josh", async () => {
    const watch = await readFile(new URL("src/watch/index.ts", root), "utf8");
    assert.match(watch, /recipeSummariesForWatch/);
    assert.match(watch, /recipeSummary/);
    assert.match(watch, /last_pull_counts/, "D40/D50: the watch carries the count summary on its would-start line; it no longer opens a run thread. Ask Josh.");
    const cards = await readFile(new URL("src/slack/cards.ts", root), "utf8");
    assert.match(cards, /recipeSummary/);
    const blocks = notWorkingCard({
      cardId: "c",
      runId: "r",
      clientTag: "parlay",
      campaignId: 3847838,
      campaignName: "parlay it dm",
      runwayDays: 3,
      sends: 2000,
      interested: 0,
      variants: [],
      recipeSummary: "*Last pull recipe* (#3847838)\n• `parlay_adjacent_dms_20260825` — 1 interested\n• any_reconstructed: no\n• leads_without_method: 0",
    });
    const text = JSON.stringify(blocks);
    assert.match(text, /parlay_adjacent_dms_20260825/);
    assert.match(text, /any_reconstructed/);
    assert.match(text, /leads_without_method/);
    assert.ok(!text.includes("@"), "D40: recipe summary is counts, never an email. Ask Josh.");
  });
});
