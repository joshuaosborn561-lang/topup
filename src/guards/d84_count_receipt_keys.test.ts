import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { RECEIPT_COUNT_KEYS } from "../jobs/filters.js";

/**
 * D84 — count honors max_per_company, industries_by_campaign and
 * over_1k_campaign on every source. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D84 — count honors stored receipt keys", () => {
  it("the honor helper names the three keys and count applies it on every source", async () => {
    assert.deepEqual([...RECEIPT_COUNT_KEYS], ["max_per_company", "industries_by_campaign", "over_1k_campaign"]);
    const filters = await readFile(new URL("src/jobs/filters.ts", root), "utf8");
    assert.match(filters, /export function honorReceiptCountKeys/, "D84: honor lives in filters. Ask Josh.");
    assert.match(filters, /industries_by_campaign/, "D84: the parent map is honored");
    assert.match(filters, /over_1k_campaign/, "D84: the over-1k flag is honored");
    const count = await readFile(new URL("src/canon/count.ts", root), "utf8");
    assert.match(count, /honorReceiptCountKeys/, "D84: count honors the keys before the source switch. Ask Josh.");
    assert.match(count, /max_per_company \$\{cap\} honored \(D84\)/, "D84: the cap stays on the answer");
    assert.match(count, /case "maps"/, "D84: maps is a count source");
    assert.match(count, /case "permits"/, "D84: permits is a count source");
    assert.match(count, /case "ai_ark"/, "D84: ai_ark is a count source");
    assert.doesNotMatch(count, /export cap; count_contacts does not apply it \(D43\)/, "D84 qualifies D43");
  });

  it("CANON marks D84 live and still fails an unknown key", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Count honors/, "D84: fold into CANON. Ask Josh.");
    assert.doesNotMatch(canon, /until D84 lands in code/, "D84: the pending note is gone");
    assert.doesNotMatch(canon, /\(D84; \*code pending\*\)/, "D84: how-to is live");
    assert.doesNotMatch(
      canon,
      /Count honors[\s\S]{0,120}\*Code pending,\s+follow-up PR\* \(D84\)/,
      "D84: rule 33 is live. Ask Josh.",
    );
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D84 \| Live;/m, "D84: status index is live. Ask Josh.");
  });
});
