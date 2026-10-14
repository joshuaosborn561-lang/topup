import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D108 — nothing stored decides a lane's split. Grokbot reads the chats
 * and passes the split with the pool; the service checks it and never
 * reads one from a record, the registry, or anywhere else. Ask Josh
 * before storing a split or reading one back.
 */
const root = new URL("../../", import.meta.url);

describe("D108 — the split comes from Grokbot with the pool, never from storage", () => {
  it("the split code reads no split from a record or the registry's cells", async () => {
    const split = await readFile(new URL("src/canon/laneSplit.ts", root), "utf8");
    assert.doesNotMatch(split, /yield_by_step|source_refs|routingFromRecord|segmentsFromRecord|registry_cells|record_routing|cellOf\(/, "D108: a stored split is a recipe. Ask Josh.");
    assert.match(split, /split\?: GrokSplit \| null/);
    assert.match(split, /no split was passed/);
    const plan = await readFile(new URL("src/jobs/lanePlan.ts", root), "utf8");
    assert.match(plan, /select campaign_ids, lanes\s+from topup\.list_build_records/, "D108: the lane loader reads only which campaigns a record names");
    assert.doesNotMatch(plan, /yield_by_step|source_refs/);
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /split: laneSplitInput\.optional\(\)/, "D108: topup takes the split Grokbot read from the chats");
    const settings = await readFile(new URL("src/jobs/settings.ts", root), "utf8");
    assert.match(settings, /export const laneSplitInput/);
    assert.match(settings, /split_from/);
  });

  it("the canon, the ledger, the skill and the README say so", async () => {
    const canon = (await readFile(new URL("CANON.md", root), "utf8")).replace(/\s+/g, " ");
    assert.match(canon, /Nothing stored decides the split\*\* \(D108\)/);
    assert.match(canon, /passes it with the pool/);
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^## D108 — /m);
    assert.match(ledger, /^\| D108 \|/m);
    const skill = (await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8")).replace(/\s+/g, " ");
    assert.match(skill, /Nothing stored decides how a lane splits/);
    assert.match(skill, /pass it as `split` with the pool/);
    const readme = await readFile(new URL("README.md", root), "utf8");
    assert.match(readme, /source\[, split\]/);
  });
});
