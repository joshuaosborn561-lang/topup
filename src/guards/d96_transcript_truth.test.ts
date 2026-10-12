import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { parseCorrectReceiptArgs } from "../../scripts/correct-receipt-from-transcript.js";
import { isUnassignedLane, UNASSIGNED_LANE } from "../canon/lanes.js";

/** D96 — transcript is the source of truth; skip unassigned. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D96 — transcript truth and unassigned skip", () => {
  it("CANON names the backfill fix and the parking-lot lane", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D96\*\*/, "D96: fold into CANON. Ask Josh or Cayden.");
    assert.match(canon, /The build transcript is the source of truth/, "D96. Ask Josh or Cayden.");
    assert.match(canon, /backfill fix, not widening/, "D96. Ask Josh or Cayden.");
    assert.match(canon, /Skip registry lane `unassigned`/, "D96. Ask Josh or Cayden.");
    assert.doesNotMatch(canon, /emcor|bcp|pe_firms|it_dm_airpods/, "D96: no client facts on the page. Ask Josh or Cayden.");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^\| D96 \|/m, "D96 index row");
    assert.match(ledger, /^## D96 — /m, "D96 entry");
    assert.doesNotMatch(ledger.split("## D96 —")[1] ?? "", /emcor|bcp|pe_firms|it_dm_airpods/, "D96: the new entry has no client facts. Ask Josh or Cayden.");
  });

  it("the corrector is generic, dry-run first, and does not write skip columns", async () => {
    assert.deepEqual(parseCorrectReceiptArgs(["--client_tag=acme"]), { client_tag: "acme", apply: false });
    assert.equal(parseCorrectReceiptArgs(["--client_tag=acme", "--apply"]).apply, true);
    assert.throws(() => parseCorrectReceiptArgs([]), /client_tag/);
    const src = await readFile(new URL("scripts/correct-receipt-from-transcript.ts", root), "utf8");
    assert.match(src, /if \(!args\.apply\) return/, "D96: dry-run first. Ask Josh or Cayden.");
    assert.match(src, /company_filters/, "D96: only company_filters is written. Ask Josh or Cayden.");
    assert.doesNotMatch(src, /const CLIENT_TAG|const PE_|const IT_/);
    assert.doesNotMatch(src, /["']bcp["']|["']emcor["']|["']pe_firms["']|["']it_dm_airpods["']/);
    assert.doesNotMatch(src, /\b(set|update)\s+dl_status|\b(set|update)\s+sg_exclude|\bskip_[a-z0-9_]+\s*=/);
    const pkg = await readFile(new URL("package.json", root), "utf8");
    assert.match(pkg, /correct:receipt-from-transcript/, "D96: npm script. Ask Josh or Cayden.");
  });

  it("unassigned is a parking lot and the retag script cannot target it", async () => {
    assert.equal(UNASSIGNED_LANE, "unassigned");
    assert.equal(isUnassignedLane("unassigned"), true);
    assert.equal(isUnassignedLane("it_lane"), false);
    const retag = await readFile(new URL("scripts/retag-lane-mismatch.ts", root), "utf8");
    assert.match(retag, /isUnassignedLane/, "D96: retag skips the parking lot. Ask Josh or Cayden.");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /isUnassignedLane/, "D96: pull refuses unassigned. Ask Josh or Cayden.");
    const campaigns = await readFile(new URL("src/canon/campaigns.ts", root), "utf8");
    assert.match(campaigns, /isUnassignedLane\(lane\)/, "D96: campaigns marks unassigned never_top_up. Ask Josh or Cayden.");
  });
});
