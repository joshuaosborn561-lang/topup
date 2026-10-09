import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GROK_MAY } from "../grok/allowlist.js";
import { jobRecipe } from "../jobs/recipe.js";
import { VERB_ORDER, VERB_STEPS } from "../jobs/runner.js";
import { GROK_READS, GROK_VERBS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";

/** D52 — the reads state the rule and no verdict; the verbs run one stage on a job; nothing returns a row. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D52 — reads and verbs", () => {
  it("CANON, the ledger, README, AGENTS and the babysitter name D52 — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const readme = await readFile(new URL("README.md", root), "utf8");
    const agents = await readFile(new URL("AGENTS.md", root), "utf8");
    const babysitter = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D5\d\*\*/);
    assert.match(canon, /## The reads and the verbs for Grok bot \(D52\)/);
    assert.match(ledger, /## D52 — The reads and the verbs/);
    assert.match(ledger, /^\| D52 \| Live/m);
    assert.match(agents, /`campaigns` and `campaign_record` \(D52\)/);
    assert.match(babysitter, /## The reads and the verbs \(D52\)/);
    for (const tool of [...GROK_READS, ...GROK_VERBS]) {
      assert.match(readme, new RegExp(`\`${tool}\``), `D52: README must list \`${tool}\`. Ask Josh.`);
      assert.match(babysitter, new RegExp(`\`${tool}\``), `D52: the babysitter must allowlist \`${tool}\`. Ask Josh.`);
    }
  });

  it("every read and verb is on the surface for the operator and the bot", () => {
    for (const tool of [...GROK_READS, ...GROK_VERBS]) {
      assert.equal(MCP_TOOL_ROLE[tool], "operator", `D52: ${tool} is for Cayden and the bot`);
      assert.ok((GROK_MAY as readonly string[]).includes(tool), `D52: Grok may call ${tool}`);
    }
    assert.deepEqual([...VERB_ORDER], ["pull", "suppress", "enrich", "verify", "normalize", "qa", "stage", "import"]);
    assert.deepEqual(VERB_STEPS.pull, ["pull", "ingest"]);
    assert.deepEqual(VERB_STEPS.import, ["import", "post_import"]);
  });

  it("a job recipe is filed under its own lane, nothing chains, and no read selects a lead column", async () => {
    const r = jobRecipe({ client_tag: "bcp", smartlead_client_id: 542838, lane: "it_dm_airpods", campaign_id: 3921850, source: "getleads", filters: { job_titles: ["CIO"], industries: ["Hospitals"] }, max_rows: 500 }, 1700000000000);
    assert.match(r.recipe_id, /^bcp\.job_3921850_1700000000000\.v1$/, "D52: findRecipe(client, lane) must never return a job recipe");
    assert.equal(r.lane, "it_dm_airpods");
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.doesNotMatch(runner, /startTopup\(|\.drive\(|pipeline\(/, "D52: a verb runs its stage and returns; nothing chains");
    assert.doesNotMatch(runner, /\.resolveCard\(/, "D18/D52: approvals go through the console");
    const orchestrator = await readFile(new URL("src/orchestrator.ts", root), "utf8");
    assert.match(orchestrator, /grok_job/, "D52: the orchestrator never drives a job");
    for (const f of ["src/canon/record.ts", "src/canon/campaigns.ts", "src/canon/jobs.ts", "src/mcp/grok.ts"]) {
      const src = await readFile(new URL(f, root), "utf8");
      assert.doesNotMatch(src, /select[^;`]*\b(email|first_name|last_name|phone|linkedin_url)\b[^;`]*\bfrom\b/i, `D2/D52: ${f} never selects a lead column`);
    }
  });
});
