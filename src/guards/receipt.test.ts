import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { COMPANY_SOURCES, DOMAIN_SOURCES, PERSON_SOURCES, SIGNAL_COMPANY_SOURCES } from "../recipes/receipt.js";

/** D31–D33 — the Claude skill and the table agree on project, table, vocabulary, and no rows. */

describe("D31/D32/D33 first-pull receipt contract", () => {
  it("the skill names campaignintelligence, builds vs lanes, and tam vs export", async () => {
    const skill = await readFile(new URL("../../skills/first-pull-receipt/SKILL.md", import.meta.url), "utf8");
    assert.match(skill, /azpapwtnrbzywlnxxecz/);
    assert.match(skill, /topup\.pull_receipts/);
    assert.match(skill, /Never update an old row/);
    assert.match(skill, /granularity = lane/);
    assert.match(skill, /tam_count/);
    assert.match(skill, /maps_runs/);
  });

  it("D33 — skill and validator share the table vocabulary; other is a bug, not a value", async () => {
    const skill = await readFile(new URL("../../skills/first-pull-receipt/SKILL.md", import.meta.url), "utf8");
    const spine = await readFile(new URL("../../skills/lead-list-build/SKILL.md", import.meta.url), "utf8");
    for (const s of COMPANY_SOURCES) assert.match(skill, new RegExp(`\`${s}\``), `D33: first-pull-receipt must name ${s}`);
    for (const s of SIGNAL_COMPANY_SOURCES) {
      assert.match(spine, new RegExp(s), `D33: lead-list-build step 11.5 must name ${s}`);
    }
    assert.match(skill, /There is no `other`/);
    assert.match(spine, /never `other`/);
    assert.match(skill, /`theirstack`/);
    assert.match(skill, /`leadmagic_employee_finder`/);
    assert.ok(DOMAIN_SOURCES.includes("theirstack"));
    assert.ok(PERSON_SOURCES.includes("leadmagic_employee_finder"));
    assert.match(skill, /claude_backfill/);
    assert.match(skill, /recount/);
  });
});
