import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D95 — replay the hand search; hide internals. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D95 — replay the hand search", () => {
  it("CANON names the five-step flow and hides internals", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D\d+\*\*/, "D95: CANON still has a header. Ask Josh or Cayden.");
    assert.match(canon, /Replay the hand search/, "D95. Ask Josh or Cayden.");
    assert.match(canon, /filters_applied/, "D95: every applied filter is listed. Ask Josh or Cayden.");
    assert.match(canon, /never a lane-total fallback|never a lane total/, "D95: held has no lane fallback. Ask Josh or Cayden.");
    assert.match(canon, /exact full-list join/, "D95 keeps D80. Ask Josh or Cayden.");
    assert.doesNotMatch(canon, /emcor|bcp|pe_firms|it_dm_airpods/, "D95: no client facts on the page. Ask Josh or Cayden.");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D95 \|/m, "D95 index row");
    assert.match(ledger, /^## D95 — /m, "D95 entry");
    assert.doesNotMatch(ledger.split("## D95 —")[1] ?? "", /emcor|bcp|pe_firms|it_dm_airpods/, "D95: the new entry has no client facts. Ask Josh or Cayden.");
  });

  it("held has no sample or lane fallback; count echoes every applied filter", async () => {
    const held = await readFile(new URL("src/canon/held.ts", root), "utf8");
    assert.match(held, /exact full-list join/, "D95: held names the join. Ask Josh or Cayden.");
    assert.doesNotMatch(held, /scaleOverlap|SAMPLE_ROWS|method === "lane"|HeldMethod/, "D95: sample and lane fallback are gone. Ask Josh or Cayden.");
    assert.match(held, /No fallback/, "D95: a failed export is an error. Ask Josh or Cayden.");
    const count = await readFile(new URL("src/canon/count.ts", root), "utf8");
    assert.match(count, /filters_applied/, "D95: count returns filters_applied. Ask Josh or Cayden.");
    assert.match(count, /filtersApplied/, "D95: the echo helper is used. Ask Josh or Cayden.");
    assert.match(count, /filters_used: used/, "D95: filters_used stays the vendor payload. Ask Josh or Cayden.");
    const filters = await readFile(new URL("src/jobs/filters.ts", root), "utf8");
    assert.match(filters, /export function filtersApplied/, "D95: filtersApplied is the echo. Ask Josh or Cayden.");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /filters_applied/, "D95: the count tool names filters_applied. Ask Josh or Cayden.");
    assert.match(grok, /exact full-list join/, "D95: held tool names the join. Ask Josh or Cayden.");
  });
});
