import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D107 — the split read from the lane's build transcript is the truth the
 * way the build is. It quotes on its own; nobody confirms it. A question
 * the transcript does not answer is a plain question to Josh, never a
 * guess. Ask Josh before putting a confirmation gate back.
 */
const root = new URL("../../", import.meta.url);

describe("D107 — the transcript split quotes on its own", () => {
  it("the split code has no confirmation gate and no approver list", async () => {
    const split = await readFile(new URL("src/canon/laneSplit.ts", root), "utf8");
    assert.doesNotMatch(split, /not yet confirmed/, "D107: a recorded split quotes without a confirmation. Ask Josh.");
    assert.doesNotMatch(split, /approvers/, "D107: who approves spend (D101) has nothing to do with reading the split");
    const plan = await readFile(new URL("src/jobs/lanePlan.ts", root), "utf8");
    assert.doesNotMatch(plan, /approvers/);
  });

  it("the canon, the ledger and the Grokbot skill say so", async () => {
    const canon = (await readFile(new URL("CANON.md", root), "utf8")).replace(/\s+/g, " ");
    assert.match(canon, /Grokbot reads the lane's build transcript and the process chats/);
    assert.match(canon, /no confirmation step/);
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^## D107 — /m);
    assert.match(ledger, /^\| D107 \|/m);
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /nobody confirms it \(D107\)/);
    assert.match(skill, /ask Josh one plain-English question/);
  });
});
