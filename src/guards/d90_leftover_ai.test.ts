import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CANON_VERBS } from "../grok/allowlist.js";
import { GROK_VERBS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { VENDORS } from "../spend/prices.js";
import { LEFTOVER_AI_HARD_CAP_CENTS, leftoverAiPromptLock } from "../replies/leftoverAi.js";
import { LEFTOVER_INSTRUCTIONS } from "../replies/leftoverPrompt.js";
import { OPENROUTER_VAULT_SECRET } from "../clients/jevClassify.js";

/** D90 — leftover-negative AI runner. Ask Josh. */

const root = new URL("../../", import.meta.url);

describe("D90 — leftover-negative AI", () => {
  it("CANON names the verb, the hard cap, the prompt, and no new vendor", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D9[01]\*\*/, "D90: fold into CANON. Ask Josh.");
    assert.match(canon, /`classify_leftover/, "D90: the verb is on the page. Ask Josh.");
    assert.match(canon, /\$0\.05/, "D90: hard cap. Ask Josh.");
    assert.match(canon, /openrouter_api_key/, "D90: same vault secret as icp-llm. Ask Josh.");
    assert.match(canon, /negative_class_source='ai'/, "D90: source=ai. Ask Josh.");
    assert.match(canon, /no inbound body/, "D90: empty body is not sent. Ask Josh.");
    assert.match(canon, /stays unclassified/, "D90: empty body stays unclassified. Ask Josh.");
    for (const list of [CANON_VERBS, GROK_VERBS]) {
      assert.ok((list as readonly string[]).includes("classify_leftover"), "D90: classify_leftover is a canon verb. Ask Josh.");
    }
    assert.equal(MCP_TOOL_ROLE.classify_leftover, "operator");
    assert.equal(LEFTOVER_AI_HARD_CAP_CENTS, 5);
    assert.equal(OPENROUTER_VAULT_SECRET, "openrouter_api_key");
    assert.ok((VENDORS as readonly string[]).includes("jev"), "D90: reuse jev, do not add a vendor. Ask Josh.");
    assert.ok(!(VENDORS as readonly string[]).includes("openrouter"), "D90: OpenRouter is not a new vendor row. Ask Josh.");
  });

  it("the leftover prompt is fixed and the runner never writes skip columns", async () => {
    assert.match(LEFTOVER_INSTRUCTIONS, /explicitly asks to stop|be removed/);
    assert.match(leftoverAiPromptLock(), /no body/);
    const runner = await readFile(new URL("src/replies/leftoverAi.ts", root), "utf8");
    assert.match(runner, /approved_by/, "D90: a name runs it. Ask Josh.");
    assert.match(runner, /SpendRails/, "D90: spend goes through the gate. Ask Josh.");
    assert.doesNotMatch(runner, /dl_status|sg_exclude|skip_/, "D90: never write those columns. Ask Josh.");
    const client = await readFile(new URL("src/clients/jevClassify.ts", root), "utf8");
    assert.match(client, /openrouter\.ai\/api\/alpha\/decisions/, "D90: same Decisions path as icp-llm. Ask Josh.");
  });
});
