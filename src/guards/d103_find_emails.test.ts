import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PHASE_STEPS } from "../jobs/runner.js";
import { ICP_STATUSES } from "../stages/icp/index.js";
import { FIND_MAX_TIER, findWorstCaseCents } from "../stages/find_emails/index.js";
import { worstCaseCents } from "../spend/prices.js";
import { loadConfig } from "../config.js";

/**
 * D103 — top-ups find emails for the people an export names without one.
 * Ask Josh before taking it out, going past AI Ark, or finding phones.
 */
const root = new URL("../../", import.meta.url);

describe("D103 — top-ups find emails", () => {
  it("the approve phase runs the ICP check, then the finder, then verification; the ICP check covers the people with no email", () => {
    const a = PHASE_STEPS.approve;
    assert.ok(a.indexOf("icp") < a.indexOf("find_emails") && a.indexOf("find_emails") < a.indexOf("verify"), "D103: icp → find_emails → verify");
    assert.ok((ICP_STATUSES as readonly string[]).includes("needs_email"), "D103: no money on finding emails at companies that are not a fit");
  });

  it("the look-up is priced from the service's own table, stops at AI Ark, and never asks for phones", async () => {
    assert.equal(FIND_MAX_TIER, "aiark", "D58/D103: Prospeo and FullEnrich only when Josh says");
    assert.equal(findWorstCaseCents(100), worstCaseCents("aiark", "find_email", 100));
    const client = await readFile(new URL("src/clients/emailFinder.ts", root), "utf8");
    assert.match(client, /need: "email"/);
    assert.doesNotMatch(client, /\bfind_(phone|email|people):/, "D103: a find_* flag overrides need; find_phone=false alone switches email off. need \"email\" never calls a phone endpoint.");
    assert.match(client, /approve_cost_usd: ceilingUsd/, "D103: the finder is told the approved ceiling");
    assert.match(loadConfig({}).EMAIL_WATERFALL_MCP_URL, /^https:\/\//);
    assert.match(loadConfig({ EMAIL_WATERFALL_MCP_URL: "" }).EMAIL_WATERFALL_MCP_URL, /^https:\/\//, "an empty Railway variable means the default address");
  });

  it("ingest keeps the people LeadPipe drops for having no email; found addresses pass the held and unsubscribe checks", async () => {
    const ingest = await readFile(new URL("src/stages/ingest/index.ts", root), "utf8");
    assert.match(ingest, /addPeopleWithoutEmail/);
    assert.match(ingest, /email_source/);
    const stage = await readFile(new URL("src/stages/find_emails/index.ts", root), "utf8");
    assert.match(stage, /holdByStatus\(run, settings, "email_found"\)/);
    assert.match(stage, /removeFound\(run, settings, "email_found"\)/);
    assert.match(stage, /found_email_already_in_lane/);
    assert.match(stage, /email_not_found/);
  });

  it("the lane lock lets only the finder's own columns through without the run (migration 0029)", async () => {
    const sql = await readFile(new URL("supabase/migrations/0029_finder_writeback.sql", root), "utf8");
    assert.match(sql, /to_jsonb\(new\) - v_finder\) = \(to_jsonb\(old\) - v_finder\)/);
    assert.doesNotMatch(sql, /'lead_status'|'email'[,\]]/, "D103: lead_status and email still need the run");
  });

  it("the canon and the standing orders tell Grokbot to export without the VALID filter", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /without the\s+`email_status` VALID filter/);
    assert.match(canon, /\(D103\)/);
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /without the\s+`email_status` VALID filter/);
  });
});
