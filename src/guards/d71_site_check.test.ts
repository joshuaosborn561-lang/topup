import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { OWNER_LABELS, OWNER_PASS, SITE_CHECK_QUESTIONS, siteCheckWorstCaseCents } from "../canon/siteCheck.js";
import { CANON_VERBS } from "../grok/allowlist.js";
import { GROK_VERBS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { icpWorstCaseCents } from "../stages/icp/index.js";

/**
 * D71 — the website checker is a verb. `site_check` runs our own site
 * fetch and one Jev question (icp per company, owners per named person)
 * over a job or a store leftovers named, prices it from the table, waits
 * for a name, keeps the verdict per domain and per person, and changes
 * nothing on the rows. Names move Postgres → edge function → Jev and
 * never come back to the service or to chat. Ask Josh before any of that
 * changes.
 */
const root = new URL("../../", import.meta.url);

describe("D71 — site_check", () => {
  it("is on the surface, as an operator verb, with exactly two questions", () => {
    for (const list of [CANON_VERBS, GROK_VERBS]) assert.ok((list as readonly string[]).includes("site_check"), "D71: site_check is a canon verb");
    assert.equal(MCP_TOOL_ROLE.site_check, "operator");
    assert.deepEqual([...SITE_CHECK_QUESTIONS], ["icp", "owners"], "D71: the checker answers two questions; a third is a new decision");
    assert.deepEqual([...OWNER_LABELS], ["owner_or_founder", "executive_decision_maker", "manager_or_lead", "staff_or_individual_contributor"]);
    assert.deepEqual([...OWNER_PASS], ["owner_or_founder", "executive_decision_maker"], "D71: owners and decision makers are the first two labels");
  });

  it("prices both questions from the table and never lands at $0 for a real batch", () => {
    assert.equal(siteCheckWorstCaseCents("icp", 1000), icpWorstCaseCents(1000));
    assert.ok(siteCheckWorstCaseCents("owners", 1000) >= 11, "D71: about $0.11 per 1,000 answers");
    assert.equal(siteCheckWorstCaseCents("icp", 0), 0);
    assert.equal(siteCheckWorstCaseCents("owners", 0), 0);
  });

  it("asks for a name, queues people by a hash, never returns a person, never changes a row, never DDLs", async () => {
    const src = await readFile(new URL("src/canon/siteCheck.ts", root), "utf8");
    assert.match(src, /kind: "spend_approval"/, "D51/D71: a card before Jev runs");
    assert.match(src, /resolveAs\(`\$\{approvedBy\} via \$\{d\.by\}`, "owner"/, "D71: the name taps the card as an owner");
    assert.match(src, /insert into \$\{PEOPLE_TABLE\} \(client_tag, domain, person_key, full_name, title, batch\)\s+select/, "D71: the queue is insert … select, server side");
    assert.match(src, /md5\(lower\(\$\{dsql\}\) \|\| '\|' \|\| lower\(\$\{nsql\}\)\)/, "D71: the person key is a hash of domain and name");
    assert.doesNotMatch(src, /returning/i, "D2/D71: no insert returns a row");
    assert.doesNotMatch(src, /\b(delete from|alter table|create table|create index|drop )/i, "D67/D71: no deletes and no runtime DDL");
    for (const m of src.matchAll(/query<\{([^}]*)\}>/g)) {
      assert.doesNotMatch(m[1]!, /\b(full_name|first_name|last_name|email|phone|title|linkedin_url)\b/, `D2/D71: a row shape read back names a person: ${m[1]}`);
    }
    assert.doesNotMatch(src, /^\s*`?update \$\{scope\.rel\}/m, "D71: the verb never updates the store's rows");
    assert.match(src, /SAMPLE_FLAGGED = 10/, "D2: the ten-sample rule");
  });

  it("the queue table is a migration with the service grants, the gate client has the people mode, and the docs name the verb", async () => {
    const m = await readFile(new URL("supabase/migrations/0022_site_check_people.sql", root), "utf8");
    assert.match(m, /create table if not exists topup\.site_check_people/);
    assert.match(m, /primary key \(client_tag, domain, person_key\)/);
    assert.match(m, /grant select, insert, update on topup\.site_check_people to leadtopup_app/);
    const gate = await readFile(new URL("src/clients/icpGate.ts", root), "utf8");
    assert.match(gate, /mode: "people"/, "D71: icp-llm's people mode answers the owners question");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /`site_check\(/, "D71: CANON.md names the verb");
    assert.match(canon, /owner_or_founder/, "D71: CANON.md names the owners labels");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /`site_check`/, "D71: the babysitter skill tells Grok about the checker");
    const servers = await readFile(new URL("docs/servers.md", root), "utf8");
    assert.match(servers, /mode=people/, "D71: docs/servers.md documents the people mode");
  });
});
