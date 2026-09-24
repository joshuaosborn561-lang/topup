import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { SAMPLE_ROWS_MAX } from "../mcp/server.js";
import { GROK_MAY, GROK_MUST_NOT, GROK_MUST_NOT_SELECT, GROK_SAMPLE_MAX } from "../grok/allowlist.js";

/** D39 — Grok bot is the babysitter; rows never enter its context. Ask Josh. */

const root = new URL("../../", import.meta.url);

const PULL_SKILLS = [
  "lead-list-build",
  "parlay-lead-pulls",
  "culture-fits-lead-pulls",
  "techevo-lead-pulls",
  "goliath-lead-pulls",
  "salesglider-lead-pulls",
  "earthworks-lead-pulls",
  "insight-lead-pulls",
] as const;

describe("D39 — Grok bot is the babysitter", () => {
  it("CANON, AGENTS, and the ledger name the babysitter rule — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const agents = await readFile(new URL("AGENTS.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D39\*\*/);
    assert.match(canon, /Grok bot is the \*\*babysitter\*\*/);
    assert.match(canon, /MCP → Supabase/);
    assert.match(canon, /source_table/);
    assert.match(canon, /do not enter Grok bot context/);
    assert.match(canon, /Railway crons/);
    assert.match(canon, /skills\/grok-bot-babysitter/);
    assert.match(canon, /skills\/leadpipe/);
    assert.match(canon, /supabase-csv-endpoint/);
    assert.match(canon, /does not reconstruct the thirteen steps/);
    // Line wraps in the ledger are allowed; \s+ is the phrase.
    assert.match(canon, /lp_run ingest_csv/);
    assert.match(canon, /find_dms_by_title/);
    assert.match(canon, /get-dataset-items/);
    assert.match(canon, /export_contacts/);
    assert.match(agents, /Grok bot is the babysitter \(D39\)/);
    assert.match(agents, /enter Grok bot context/);
    assert.match(agents, /grok-bot-babysitter/);
    assert.match(agents, /thirteen steps/);
    assert.match(agents, /export_contacts/);
    assert.match(ledger, /## D39 — Grok bot is the babysitter/);
    assert.match(ledger, /nuked our grok bot/);
    assert.match(ledger, /Do not reconstruct the thirteen steps/);
    assert.match(ledger, /skills\/leadpipe/);
    assert.match(ledger, /allowlist\.ts/);
    assert.match(ledger, /PRs #6 and #7/);
  });

  it("the service MCP still only samples ten masked rows (D2 stays) — Ask Josh", () => {
    assert.equal(SAMPLE_ROWS_MAX, 10, "D39: Grok bot may not widen sample_rows. Ask Josh.");
    assert.equal(GROK_SAMPLE_MAX, 10, "D39: Grok sample ceiling is ten. Ask Josh.");
    assert.equal(SAMPLE_ROWS_MAX, GROK_SAMPLE_MAX);
  });

  it("vendor MCP docs keep rows on source_table / writeback, not chat", async () => {
    const servers = await readFile(new URL("skills/MCP_SERVERS.md", root), "utf8");
    assert.match(servers, /source_table/);
    assert.match(servers, /writeback/);
    assert.match(servers, /Rows never travel through the service/);
    assert.match(servers, /LeadPipe/);
    assert.match(servers, /Context Saver/);
  });

  it("dedicated LeadPipe and Grok babysitter skills exist and name the allow / ban lists — Ask Josh", async () => {
    const leadpipe = await readFile(new URL("skills/leadpipe/SKILL.md", root), "utf8");
    const babysitter = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    const index = await readFile(new URL("skills/SKILLS_INDEX.md", root), "utf8");
    assert.match(leadpipe, /store and job runner/i);
    assert.match(leadpipe, /ingest_csv/);
    assert.match(leadpipe, /lp_sample/);
    assert.match(leadpipe, /counts only/i);
    assert.match(leadpipe, /find_dms_by_title/);
    assert.match(leadpipe, /\$0\.10/);
    assert.match(leadpipe, /supabase-csv-endpoint/);
    assert.match(leadpipe, /Grok bot/);
    assert.match(babysitter, /babysitter/);
    assert.match(babysitter, /do not reconstruct/i);
    assert.match(babysitter, /lead-list-build/);
    assert.match(babysitter, /campaignintelligence/);
    assert.match(babysitter, /topup\.pull_receipts/);
    assert.match(babysitter, /PRs #6 and #7/);
    assert.match(index, /grok-bot-babysitter/);
    assert.match(index, /`leadpipe`/);
    for (const tool of GROK_MAY) {
      assert.match(babysitter, new RegExp(`\`${tool}\``), `D39: grok-bot-babysitter must allowlist \`${tool}\`. Ask Josh.`);
    }
    for (const tool of GROK_MUST_NOT) {
      assert.match(babysitter, new RegExp(`\`${tool}\``), `D39: grok-bot-babysitter must ban \`${tool}\`. Ask Josh.`);
    }
    for (const col of GROK_MUST_NOT_SELECT) {
      assert.match(babysitter, new RegExp(col), `D39: grok-bot-babysitter must ban SELECT of ${col}. Ask Josh.`);
    }
  });

  it("pull skills tell Grok bot not to walk them in chat — Ask Josh", async () => {
    for (const name of PULL_SKILLS) {
      const src = await readFile(new URL(`skills/${name}/SKILL.md`, root), "utf8");
      assert.match(src, /Grok bot \(D39\)/, `D39: skills/${name} must warn Grok bot off. Ask Josh.`);
      assert.match(src, /start_topup|do not walk these thirteen steps/, `D39: skills/${name} must point Grok at start_topup. Ask Josh.`);
    }
  });

  it("the Railway clients still return URLs and counts, never contacts — Ask Josh", async () => {
    const leadpipe = await readFile(new URL("src/clients/leadpipe.ts", root), "utf8");
    const getleads = await readFile(new URL("src/clients/getleads.ts", root), "utf8");
    assert.match(leadpipe, /signed_url/);
    assert.match(leadpipe, /job_id/);
    assert.match(leadpipe, /never contact rows/);
    assert.match(getleads, /Nothing here returns a contact/);
    assert.match(getleads, /Grok bot must not call these/);
    assert.ok(!leadpipe.includes("contacts:"), "D39: LeadPipe client must not shape a contacts payload. Ask Josh.");
  });

  it("this branch stays honest: Railway still walks the file recipe, not PR #6/#7 inference — Ask Josh", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    const orchestrator = await readFile(new URL("src/orchestrator.ts", root), "utf8");
    assert.match(canon, /still walks the file recipe/);
    assert.match(ledger, /still\s+walks the file recipe/);
    assert.match(orchestrator, /PIPELINE_STEPS/);
    const recipes = await readdir(new URL("recipes/parlay", root));
    assert.ok(recipes.includes("it_dm.json"), "D39: Parlay file recipe is still the override on this branch. Ask Josh.");
  });
});
