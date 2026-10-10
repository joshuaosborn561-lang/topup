import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { shouldReopenStep } from "../jobs/runner.js";
import { STEP_RULES, stepRulesHash, storedRulesHash, withRulesHash } from "../jobs/rules.js";
import { domainSql } from "../stages/puzzle/classify.js";
import { ewDomainViewName, ewDomainViewSql } from "../stages/puzzle/ewSource.js";

/**
 * D66 — job 46b1c941 after #43. Ask Josh before any of this changes.
 */

const root = new URL("../../", import.meta.url);

describe("D66 — people domain view and normalize rules-hash rerun", () => {
  it("the ingest view aliases company_domain as domain and does not ALTER the lane table", async () => {
    const cols = new Set(["company_domain", "email", "first_name", "company_name"]);
    const sql = ewDomainViewSql("lp.emcor_ingested_leads", cols);
    assert.equal(ewDomainViewName("lp.emcor_ingested_leads"), "lp.emcor_ingested_leads_ew");
    assert.match(sql, /create view lp\.emcor_ingested_leads_ew/, "D66: sibling view, not an ALTER of the lane table. Ask Josh.");
    assert.match(sql, /as domain/, "D66: the view exposes domain. Ask Josh.");
    assert.match(sql, /company_domain/, "D66: domain comes from company_domain. Ask Josh.");
    assert.equal(domainSql(cols, "t.").includes("company_domain"), true);
    assert.doesNotMatch(sql, /alter table/i, "D66: do not ALTER lp.emcor_ingested_leads. Ask Josh.");
    const puzzle = await readFile(new URL("src/stages/puzzle/index.ts", root), "utf8");
    assert.match(puzzle, /ensureEwDomainSource/, "D66: people waterfall must get the view. Ask Josh.");
    const email = await readFile(new URL("src/stages/find_emails/index.ts", root), "utf8");
    assert.match(email, /ensureEwDomainSource/, "D66: email waterfall shares ew_read_source. Ask Josh.");
    const people = await readFile(new URL("src/clients/peopleWaterfall.ts", root), "utf8");
    assert.doesNotMatch(people, /map:/, "D66: resolve_people does not accept map; the fix is the view. Ask Josh.");
  });

  it("names the other-repo RPC and the missing company_domain candidate, and does not edit them", async () => {
    const src = await readFile(new URL("src/stages/puzzle/ewSource.ts", root), "utf8");
    assert.match(src, /ew_read_source/, "D66: name the shared RPC. Ask Josh.");
    assert.match(src, /003_ew_source_rpcs\.sql/, "D66: the RPC lives in email-waterfall migrations. Ask Josh.");
    assert.match(src, /people_waterfall\/source\.py/, "D66: people waterfall is the caller. Ask Josh.");
    assert.match(src, /FIELD_CANDIDATES/, "D66: their map is domain\/website, not company_domain. Ask Josh.");
    const migration = await readFile(new URL("supabase/migrations/0020_ingested_ew_domain_view.sql", root), "utf8");
    assert.match(migration, /unapplied/i, "D66: 0020 is unapplied until Josh says so. Ask Josh.");
    assert.match(migration, /ensure_ingested_ew_view/, "D66: the durable function is in this repo. Ask Josh.");
    assert.doesNotMatch(migration, /alter table lp\./i, "D66: the migration must not ALTER a live lane table. Ask Josh.");
  });

  it("reopens normalize when the rules hash changed or force is on", () => {
    assert.equal(stepRulesHash("normalize"), STEP_RULES.normalize);
    assert.equal(storedRulesHash({ held: 147 }), null, "D66: a pre-hash step has no rules_hash. Ask Josh.");
    assert.equal(
      shouldReopenStep({
        step: "normalize",
        status: "done",
        useful_output: 0,
        counts: { held: 147 },
        queued: {},
        rules_hash: STEP_RULES.normalize,
        stored_rules_hash: null,
      }),
      true,
      "D66: missing stored hash must reopen so D65 company fill can write. Ask Josh.",
    );
    assert.equal(
      shouldReopenStep({
        step: "normalize",
        status: "done",
        useful_output: 0,
        counts: { held: 147 },
        queued: {},
        rules_hash: STEP_RULES.normalize,
        stored_rules_hash: "d65:before-hash",
      }),
      true,
      "D66: a stale hash must reopen. Ask Josh.",
    );
    assert.equal(
      shouldReopenStep({
        step: "normalize",
        status: "done",
        useful_output: 147,
        counts: { held: 0 },
        queued: {},
        rules_hash: STEP_RULES.normalize,
        stored_rules_hash: STEP_RULES.normalize,
      }),
      false,
      "D66: matching hash and no queued hold stays done. Ask Josh.",
    );
    assert.equal(
      shouldReopenStep({
        step: "normalize",
        status: "done",
        useful_output: 147,
        counts: { held: 0 },
        queued: {},
        rules_hash: STEP_RULES.normalize,
        stored_rules_hash: STEP_RULES.normalize,
        force: true,
      }),
      true,
      "D66: force=true re-runs a clean done step. Ask Josh.",
    );
    assert.equal(shouldReopenStep({ step: "verify", status: "done", useful_output: 147, counts: {}, queued: {} }), false);
    const stamped = withRulesHash("normalize", { held_merge_field: 147 });
    assert.equal(stamped.rules_hash, STEP_RULES.normalize);
  });

  it("the runner and the normalize verb store the hash and accept force", async () => {
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.match(runner, /storedRulesHash/, "D66: reopen compares the stored hash. Ask Josh.");
    assert.match(runner, /force/, "D66: a verb can force a rerun. Ask Josh.");
    assert.match(runner, /rules hash changed/, "D66: the lane event names the reason. Ask Josh.");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /force/, "D66: the MCP verbs accept force. Ask Josh.");
    const norm = await readFile(new URL("src/stages/normalize/index.ts", root), "utf8");
    assert.match(norm, /withRulesHash\("normalize"/, "D66: normalize writes rules_hash. Ask Josh.");
    const repo = await readFile(new URL("src/db/repo.ts", root), "utf8");
    assert.match(repo, /rules_hash/, "D66: resetStep drops the stale hash. Ask Josh.");
  });
});
