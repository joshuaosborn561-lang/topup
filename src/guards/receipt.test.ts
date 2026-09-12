import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D31 — the Claude skill and the table agree on project, table, and no rows. */

describe("D31 first-pull receipt contract", () => {
  it("the skill names campaignintelligence, the table, and the no-rows rule", async () => {
    const skill = await readFile(new URL("../../skills/first-pull-receipt/SKILL.md", import.meta.url), "utf8");
    assert.match(skill, /azpapwtnrbzywlnxxecz/);
    assert.match(skill, /topup\.pull_receipts/);
    assert.match(skill, /Never put emails/);
    assert.match(skill, /linkedin_native/);
    assert.match(skill, /maps_and_permits/);
  });
});
