import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D31 / D32 — the Claude skill and the table agree on project, table, and no rows. */

describe("D31/D32 first-pull receipt contract", () => {
  it("the skill names campaignintelligence, builds vs lanes, and tam vs export", async () => {
    const skill = await readFile(new URL("../../skills/first-pull-receipt/SKILL.md", import.meta.url), "utf8");
    assert.match(skill, /azpapwtnrbzywlnxxecz/);
    assert.match(skill, /topup\.pull_receipts/);
    assert.match(skill, /Never update an old row/);
    assert.match(skill, /granularity = lane/);
    assert.match(skill, /tam_count/);
    assert.match(skill, /maps_runs/);
  });
});
