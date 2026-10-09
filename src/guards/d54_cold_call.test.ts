import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { isColdCall } from "../policy/rules.js";

/**
 * D54 — a campaign marked as cold call is not an email campaign. The
 * service ignores it: not listed, not read, not pulled. Ask Josh before
 * widening or narrowing the mark.
 */

const root = new URL("../../", import.meta.url);

describe("D54 — cold call campaigns are ignored", () => {
  it("recognises the marks Josh uses in campaign names and nothing else", () => {
    for (const name of ["Cold Call Followup", "Gabe Calls | Deep Roots", "SG Cayden Calls", "Post-call | Gabe | EMCOR", "Canary shell: #3739316 Cold Call Followup"]) {
      assert.equal(isColdCall(name), true, `D54: "${name}" is a cold call campaign`);
    }
    for (const name of ["BCP Healthcare IT (AirPods)", "Parlay Reengage Generic Choice", "SalesGlider Nurture", "EMCOR E Small Ops | Scope", "", null]) {
      assert.equal(isColdCall(name), false, `D54: "${name}" is an email campaign`);
    }
  });

  it("the list, the record and the pull all check the mark; a job never pulls more than 2,000 rows", async () => {
    for (const f of ["src/canon/campaigns.ts", "src/canon/record.ts", "src/mcp/grok.ts"]) {
      const src = await readFile(new URL(f, root), "utf8");
      assert.match(src, /isColdCall\(/, `D54: ${f} does not check the cold call mark`);
    }
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /max\(MAX_ROWS_PER_JOB\)/, "D53: pull caps max_rows at the canon's 2,000");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /cold call/i, "D54: CANON.md says cold call campaigns are ignored");
  });
});
