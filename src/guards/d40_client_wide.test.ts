import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const root = new URL("../../", import.meta.url);

/** D40 — client-wide winners, one pull, then segment. Ask Josh. */

describe("D40 — client-wide top-up", () => {
  it("CANON and the decision ledger name D40", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D40\*\*/);
    assert.match(canon, /client-wide|working campaign/i);
    assert.match(canon, /one pull per shared ICP|tickets and AirPods are one/i);
    assert.match(ledger, /## D40 — /);
    assert.match(ledger, /^\| D40 \|/m);
  });

  it("the watch ticks per client and groups a pull", async () => {
    const watch = await readFile(new URL("src/watch/index.ts", root), "utf8");
    assert.match(watch, /this\.client\(/);
    assert.match(watch, /pullGroups/);
    assert.match(watch, /pullIdentity/);
    const orch = await readFile(new URL("src/orchestrator.ts", root), "utf8");
    assert.match(orch, /mergeClientPull/);
    assert.match(orch, /mergeSiblingRecipes/);
  });
});
