import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D76–D89 — ops rules Josh settled live 12 Oct 2026. Docs only. Ask Josh.
 */

const root = new URL("../../", import.meta.url);

describe("D76–D89 — ops rules in the canon", () => {
  it("CANON is as of D90 and names each rule", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D90\*\*/, "D90: fold into CANON. Ask Josh.");
    assert.match(canon, /whole usable pool/, "D76");
    assert.match(canon, /VALID email is a quality filter/, "D77");
    assert.match(canon, /TAM cross-check/, "D78");
    assert.match(canon, /about 50 people/, "D79");
    assert.match(canon, /exact full-list join/, "D80");
    assert.match(canon, /real unsubscribes only/, "D81");
    assert.match(canon, /Title filters are exact match/, "D82");
    assert.match(canon, /Prospeo is a count source/, "D83");
    assert.match(canon, /Count honors/, "D84");
    assert.match(canon, /Local-business owner finder/, "D85");
    assert.match(canon, /list_build_records/, "D86");
    assert.match(canon, /method Josh settles in chat/, "D87");
    assert.match(canon, /8pm to 6am CT/, "D88");
    assert.match(canon, /Cayden has full authority/, "D89");
    assert.match(canon, /classify_leftover/, "D90");
    assert.match(canon, /negative_class/, "D81 classify is live");
    assert.match(canon, /lower\(current_title\) IN/, "D82 is live");
    assert.match(canon, /count\(source="prospeo"\)/, "D83 is live");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    for (const n of [76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90]) {
      assert.match(ledger, new RegExp(`^\\| D${n} \\|`, "m"), `D${n} index row`);
      assert.match(ledger, new RegExp(`^## D${n} — `, "m"), `D${n} entry`);
    }
  });
});
