import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GROK_MAY } from "../grok/allowlist.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { CLIENT_OVERVIEW_DESCRIPTION, nextLine } from "../mcp/overview.js";
import { MIN_NET_NEW } from "../policy/rules.js";
import { addRegisteredLaneCampaigns } from "../recipes/registry.js";
import { parseRecipe } from "../recipes/schema.js";
import { SPINE } from "../spine/steps.js";

/**
 * D49 — starts read the registry and the build tags for every client; the
 * babysitter sees a client in one read; the step 2 gate is the 1,000 floor.
 * Ask Josh.
 */

const root = new URL("../../", import.meta.url);

/** A valid recipe body: the shipped Parlay file, re-tagged for the case at hand. */
async function validRecipe(overrides: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = JSON.parse(await readFile(new URL("recipes/parlay/it_dm.json", root), "utf8")) as Record<string, unknown>;
  return { ...base, ...overrides };
}

describe("D49 — starts read the tags; client_overview", () => {
  it("CANON, the ledger, README, AGENTS and the babysitter name D49 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const agents = await readFile(new URL("AGENTS.md", root), "utf8");
    const babysitter = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D49\*\*/);
    assert.match(canon, /## Starts read the tags; the babysitter sees a client in one read \(D49\)/);
    assert.match(canon, /There is no hand-written method per campaign/);
    assert.match(ledger, /## D49 — Starts read the tags/);
    assert.match(ledger, /^\| D49 \| Live/m);
    assert.match(readme, /`client_overview`/);
    assert.match(agents, /`client_overview\(client_tag\)` \(D49\)/);
    assert.match(babysitter, /## Start here \(D49\)/);
    assert.match(babysitter, /`client_overview`/);
    assert.match(babysitter, /Read it \*\*once\*\* per client per turn/);
  });

  it("the start path adds the registry's lane campaigns for every client, in the resolver that both the watch and start_topup use", async () => {
    const resolve = await readFile(new URL("src/recipes/resolve.ts", root), "utf8");
    assert.match(resolve, /addRegisteredCampaigns\(repo, trimmed\.recipe\)/, "D49: resolveRecipeForStart must merge the registry's lane campaigns. Ask Josh.");
    assert.match(resolve, /addRegisteredLaneCampaigns\(recipe, registryRows\(rows\)\)/);
    const orchestrator = await readFile(new URL("src/orchestrator.ts", root), "utf8");
    assert.doesNotMatch(orchestrator, /\nfunction registryRows\(/, "D49: one registry row mapper, in src/recipes/registry.ts");
    const out = addRegisteredLaneCampaigns(
      parseRecipe(
        await validRecipe({
          recipe_id: "bcp.it_dm_airpods.v0",
          client_tag: "bcp",
          lane: "it_dm_airpods",
          smartlead_client_id: 542838,
          routing: [{ when: { slot: "1" }, campaign_id: 1, icp: { kind: "linkedin_native", persona: "it_dm" } }],
          segments: { slot: ["1"] },
        }),
      ),
      [{ campaign_id: 2, client_tag: "bcp", smartlead_client_id: 542838, lane: "it_dm_airpods", status: "ACTIVE" }],
    );
    assert.deepEqual(out.routing.map((r) => r.campaign_id), [1, 2]);
  });

  it("client_overview is on the surface, allow-listed for the babysitter, counts only, and says what to do next", () => {
    assert.equal(MCP_TOOL_ROLE.client_overview, "operator", "D49: client_overview is for Cayden and the bot. Ask Josh.");
    assert.ok((GROK_MAY as readonly string[]).includes("client_overview"));
    assert.match(CLIENT_OVERVIEW_DESCRIPTION, /never a lead row/i);
    assert.match(CLIENT_OVERVIEW_DESCRIPTION, /Read this first/);
    const none = { campaigns: 3, needing_leads: 0, qualifying: 0, without_build_record: 0, missing_tags: 0 };
    assert.match(nextLine("bcp", none, 0, true), /Nothing to start/);
    assert.match(nextLine("bcp", { ...none, needing_leads: 2 }, 0, true), /none passes the policy/);
    const go = nextLine("bcp", { ...none, needing_leads: 2, qualifying: 1 }, 1, true);
    assert.match(go, /campaign_history/);
    assert.match(go, /size_client\("bcp"\)/);
    assert.match(go, /already open/);
    assert.match(go, /Loads are paused/);
  });

  it("the step 2 gate is the policy's 1,000 floor, in the spine, the skill and the recipe schema", async () => {
    assert.equal(MIN_NET_NEW, 1000);
    assert.match(SPINE[1].gate, /at least the useful floor of 1,000 per campaign \(D46\)/);
    const skill = await readFile(new URL("skills/lead-list-build/SKILL.md", root), "utf8");
    assert.match(skill, /Gate: projected net new is at least the useful floor of 1,000 per campaign \(D46\)/);
    assert.doesNotMatch(skill, /default 200/, "D49: the 200 floor is gone from the skill. Ask Josh.");
    const body = await validRecipe({});
    delete body.size;
    assert.equal(parseRecipe(body).size.useful_floor, MIN_NET_NEW);
  });

  it("the tag reads and campaign_history never select a lead column", async () => {
    const tags = await readFile(new URL("src/builds/tags.ts", root), "utf8");
    assert.doesNotMatch(tags, /select[^;]*\b(email|first_name|last_name|phone|linkedin_url)\b[^;]*from topup\.lead_provenance/i, "D2/D49: lead_provenance is counted, never selected. Ask Josh.");
    assert.match(tags, /count\(\*\)/);
    const load = await readFile(new URL("src/builds/load.ts", root), "utf8");
    assert.match(load, /tags: \{ method, missing: missingTags\(/, "D49: campaign_history carries the tags block");
  });
});
