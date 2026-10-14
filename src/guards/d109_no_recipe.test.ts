import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D109 — no recipe anywhere. The build is the transcripts and the tools
 * they use; nothing stored decides a build, a split, a clean or a route.
 * Ask Josh before adding a rule table, a skill copy or a stored cell.
 */
const root = new URL("../../", import.meta.url);

async function sources(dir: URL): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await sources(new URL(`${e.name}/`, dir))));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(new URL(e.name, dir).pathname);
  }
  return out;
}

describe("D109 — the build is the transcripts and the tools", () => {
  it("the repo carries only the standing orders and the connector list, not copies of the pull skills", async () => {
    const names = (await readdir(new URL("skills/", root))).sort();
    assert.deepEqual(names, ["MCP_SERVERS.md", "grok-bot-babysitter"], "D109: a skill copy in the repo is a recipe; they live in Josh's skill library");
  });

  it("no code reads a rule table, a stored cell, a recipe table or a gift word", async () => {
    for (const file of await sources(new URL("src/", root))) {
      if (file.endsWith("/mcp/server.ts")) continue; // the retired tool-name list names the old tools so they stay refused
      const src = await readFile(file, "utf8");
      assert.doesNotMatch(src, /lane_recipes|recipe_id|upsertRecipe|getRecipe|recipeAuthorised|qa_rules|gift_tier|gift_key|MAX_ROWS_PER_JOB|NON_TARGET_CAMPAIGN_STATUSES/, `D109: ${file} carries a recipe. Ask Josh.`);
    }
    const settings = await readFile(new URL("src/jobs/settings.ts", root), "utf8");
    assert.doesNotMatch(settings, /reroute:|\bqa: z\./, "D109: a job names no QA rules and no reroute map");
    const migration = await readFile(new URL("supabase/migrations/0030_d109_job_settings.sql", root), "utf8");
    assert.match(migration, /rename to job_settings/);
  });

  it("the canon and the ledger say so", async () => {
    const canon = (await readFile(new URL("CANON.md", root), "utf8")).replace(/\s+/g, " ");
    assert.match(canon, /No recipe anywhere\*\* \(D109\): the build is the transcripts and the tools they use/);
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^## D109 — /m);
    assert.match(ledger, /^\| D109 \|/m);
  });
});
