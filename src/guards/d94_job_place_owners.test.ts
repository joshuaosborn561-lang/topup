import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/** D94 — site_owners scopes by the job's place_id or normalized domain. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D94 — owners attach by this job's places", () => {
  it("CANON names place_id or normalized domain and forbids the shared owner table", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D94\*\*/, "D94: fold into CANON.md in the same PR. Ask Josh or Cayden.");
    assert.match(canon, /place_id or normalized domain/, "D94: the job's places are the scope. Ask Josh or Cayden.");
    assert.match(canon, /Owners attach by the job's places/, "D94. Ask Josh or Cayden.");
    assert.match(canon, /Never read the shared owner table/, "D93/D94. Ask Josh or Cayden.");
    assert.match(canon, /Never attach an owner whose domain or place is not on this job/, "D94. Ask Josh or Cayden.");
    assert.doesNotMatch(canon, /emcor|bcp|pe_firms|it_dm_airpods|healthcare|logistics/, "D94: no client facts on the page. Ask Josh or Cayden.");
  });

  it("the attach SQL keys the job's places, not the text batch", async () => {
    const owners = await readFile(new URL("src/canon/siteOwners.ts", root), "utf8");
    assert.match(owners, /run_id = \$1/, "D94: the job is the scope. Ask Josh or Cayden.");
    assert.match(owners, /a\.domain = p\.domain/, "D94: normalized domain. Ask Josh or Cayden.");
    assert.match(owners, /place_id/, "D94: place_id is a business key. Ask Josh or Cayden.");
    assert.match(owners, /D94/, "D94: the rule names the decision. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /and f\.in_batch/, "D94: do not filter attach by the text batch. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /from topup\.site_people_found/, "D94: never FROM the shared view. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /owner_netnew|owner_pilot/, "D94: never a client owner table. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /["']emcor["']|["']bcp["']/, "D94: no client constants. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /dl_status|sg_exclude|skip_/, "D81/D94: those columns stay untouched. Ask Josh or Cayden.");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /place_id or normalized domain/, "D94: count and pull describe the place scope. Ask Josh or Cayden.");
  });

  it("the ledger has the entry and no client facts", async () => {
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^## D94 — /m, "D94: append the entry. Ask Josh or Cayden.");
    assert.match(ledger, /^\| D94 \|/m, "D94: status index. Ask Josh or Cayden.");
    assert.doesNotMatch(ledger.split("## D94 —")[1] ?? "", /emcor|bcp|pe_firms|it_dm_airpods/, "D94: the new entry has no client facts. Ask Josh or Cayden.");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /place_id or normalized domain/, "D94: the babysitter names the place scope. Ask Josh or Cayden.");
  });
});
