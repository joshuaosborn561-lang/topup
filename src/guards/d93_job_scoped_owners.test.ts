import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { JOB_SOURCES } from "../jobs/recipe.js";
import { isSharedOwnerTable, SITE_OWNERS_SOURCE } from "../canon/siteOwners.js";
import { FOUND_VIEW } from "../canon/siteCheck.js";

/** D93 — job-scoped owner count and pull. Ask Josh or Cayden. */

const root = new URL("../../", import.meta.url);

describe("D93 — job-scoped owner count and pull", () => {
  it("CANON names the generic count and pull and forbids the shared owner table", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D93\*\*/, "D93: fold into CANON.md in the same PR. Ask Josh or Cayden.");
    assert.match(canon, /site_owners/, "D93: the job-scoped source is on the page. Ask Josh or Cayden.");
    assert.match(canon, /place_id/, "D93: businesses are keyed by place_id. Ask Josh or Cayden.");
    assert.match(canon, /Never read the shared owner table/, "D93. Ask Josh or Cayden.");
    assert.match(canon, /job_id, batch and place_id|job_id \+ batch \+ place_id/, "D93: job, batch and place. Ask Josh or Cayden.");
    assert.doesNotMatch(canon, /emcor|bcp|pe_firms|it_dm_airpods|healthcare|logistics/, "D93: no client facts on the page. Ask Josh or Cayden.");
  });

  it("the pull and count are on the surface; the shared view is refused", async () => {
    assert.ok((JOB_SOURCES as readonly string[]).includes(SITE_OWNERS_SOURCE), "D93: site_owners is a pull source. Ask Josh or Cayden.");
    assert.equal(isSharedOwnerTable(FOUND_VIEW), true, "D93: site_people_found is the shared view. Ask Josh or Cayden.");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /source === SITE_OWNERS_SOURCE/, "D93: pull and count intercept site_owners. Ask Josh or Cayden.");
    assert.match(grok, /countSiteOwners/, "D93: count is the dry-run. Ask Josh or Cayden.");
    assert.match(grok, /attachSiteOwners/, "D93: pull attaches. Ask Josh or Cayden.");
    assert.match(grok, /refuseSharedOwnerTable/, "D93: a table pull of the shared view is refused. Ask Josh or Cayden.");
    const owners = await readFile(new URL("src/canon/siteOwners.ts", root), "utf8");
    assert.match(owners, /run_id = \$1/, "D93: the job is the scope. Ask Josh or Cayden.");
    assert.match(owners, /t\.batch = \(select batch from looking\)/, "D93: this job's batch. Ask Josh or Cayden.");
    assert.match(owners, /place_id/, "D93: place_id is the business key. Ask Josh or Cayden.");
    assert.match(owners, /topup\.site_people_text/, "D93: batch lives on the text table. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /from topup\.site_people_found/, "D93: never FROM the shared view. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /owner_netnew|owner_pilot/, "D93: never a client owner table. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /["']emcor["']|["']bcp["']/, "D93: no client constants. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /dl_status|sg_exclude|skip_/, "D81/D93: those columns stay untouched. Ask Josh or Cayden.");
    assert.doesNotMatch(owners, /query<\{[^}]*(full_name|first_name|last_name|email|phone)/, "D2/D93: a row shape must not name a person. Ask Josh or Cayden.");
    const site = await readFile(new URL("src/canon/siteCheck.ts", root), "utf8");
    assert.match(site, /source="site_owners"/, "D93: site_check points at the job-scoped pull. Ask Josh or Cayden.");
    assert.doesNotMatch(site, /source="table", filters=\{"table":"\$\{FOUND_VIEW\}"/, "D93: do not hint the shared view as a table pull. Ask Josh or Cayden.");
    const filters = await readFile(new URL("src/jobs/filters.ts", root), "utf8");
    assert.doesNotMatch(filters, /healthcare|logistics/, "D93: bucket keys come from the stored map. Ask Josh or Cayden.");
  });

  it("the ledger has the entry and the babysitter names the verbs", async () => {
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^## D93 — /m, "D93: append the entry. Ask Josh or Cayden.");
    assert.match(ledger, /^\| D93 \|/m, "D93: status index. Ask Josh or Cayden.");
    assert.doesNotMatch(ledger.split("## D93 —")[1] ?? "", /emcor|bcp|pe_firms|it_dm_airpods/, "D93: the new entry has no client facts. Ask Josh or Cayden.");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /site_owners/, "D93: the babysitter tells Grok the job-scoped pull. Ask Josh or Cayden.");
    const pkg = await readFile(new URL("package.json", root), "utf8");
    assert.match(pkg, /retag:lane-mismatch/, "D93: the retag npm script is generic. Ask Josh or Cayden.");
    assert.doesNotMatch(pkg, /retag:bcp/, "D93: the client-named retag script is gone. Ask Josh or Cayden.");
  });
});
