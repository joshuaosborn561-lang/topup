import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D97 — held is an async chunked free export. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D97 — held chunked free export", () => {
  it("CANON and the ledger name the async held join", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D97\*\*/, "D97: fold into CANON. Ask Josh or Cayden.");
    assert.match(canon, /held_id/, "D97: held returns a held_id. Ask Josh or Cayden.");
    assert.match(canon, /chunked|every export_id|every split/, "D97: the pool export is chunked. Ask Josh or Cayden.");
    assert.match(canon, /never a paid export|Never a paid export|never.*paid GetLeads export/i, "D97: paid export is refused. Ask Josh or Cayden.");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D97 \|/m, "D97 index row. Ask Josh or Cayden.");
    assert.match(ledger, /^## D97 — /m, "D97 entry. Ask Josh or Cayden.");
  });

  it("held polls every export id, classifies the miss, and never calls search_contacts", async () => {
    const held = await readFile(new URL("src/canon/held.ts", root), "utf8");
    assert.match(held, /class HeldRunner/, "D97: held returns a held_id and runs in the background. Ask Josh or Cayden.");
    assert.match(held, /EXPORT_SLICE_DEADLINE_MS/, "D97: each slice has its own deadline. Ask Josh or Cayden.");
    assert.match(held, /started\.export_ids/, "D97: every split id is polled. Ask Josh or Cayden.");
    assert.match(held, /classifyHeldExportError/, "D97: a failed export names its class. Ask Josh or Cayden.");
    assert.match(held, /paid_export/, "D97: a paid path is refused. Ask Josh or Cayden.");
    assert.doesNotMatch(held, /search_contacts/, "D97: held never pages the paid search. Ask Josh or Cayden.");
    assert.doesNotMatch(held, /EXPORT_DEADLINE_MS = 60_000/, "D97: the 60s single-id wait is gone. Ask Josh or Cayden.");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /held_id/, "D97: the held tool accepts a held_id poll. Ask Josh or Cayden.");
    assert.match(grok, /d\.held\.start|d\.held\.get/, "D97: grok uses HeldRunner. Ask Josh or Cayden.");
  });
});
