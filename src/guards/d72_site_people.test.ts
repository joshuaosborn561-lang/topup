import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { DEFAULT_LOOKING_FOR, normalizeLookingFor, questionKey, SITE_CHECK_QUESTIONS, siteCheckBatch, siteCheckWorstCaseCents } from "../canon/siteCheck.js";
import { CANON_VERBS } from "../grok/allowlist.js";
import { GROK_VERBS } from "../mcp/grok.js";
import { MCP_TOOL_ROLE } from "../mcp/server.js";
import { PRICES, worstCaseCents } from "../spend/prices.js";
import { icpWorstCaseCents } from "../stages/icp/index.js";

/**
 * D71, D72 — the website checker is a verb. `site_check` runs our own site
 * fetch and then a question over what the site says: `icp` grades each
 * company with the client's label set; `people` crawls the people pages,
 * has Gemini list every person the site presents and asks Jev which of
 * them is `looking_for`. It prices both from the table, waits for a name,
 * keeps sites, people and answers per domain, and changes nothing on the
 * rows. The people found are rows of topup.site_people_found; a name never
 * returns to the service or to chat. Ask Josh before any of that changes.
 */
const root = new URL("../../", import.meta.url);

describe("D71/D72 — site_check", () => {
  it("is on the surface, as an operator verb, with exactly two questions", () => {
    for (const list of [CANON_VERBS, GROK_VERBS]) assert.ok((list as readonly string[]).includes("site_check"), "D71: site_check is a canon verb");
    assert.equal(MCP_TOOL_ROLE.site_check, "operator");
    assert.deepEqual([...SITE_CHECK_QUESTIONS], ["icp", "people"], "D72: the checker answers icp and people; a third question is a new decision");
    assert.equal(normalizeLookingFor("  "), DEFAULT_LOOKING_FOR, "D72: an empty looking_for means the owner");
    assert.equal(normalizeLookingFor(" the   service\n manager "), "the service manager");
    assert.equal(questionKey("The Owner"), questionKey("the owner"), "D72: the question key is md5 of the lower case, like Postgres md5(lower(x))");
    assert.match(questionKey("x"), /^[0-9a-f]{32}$/);
    assert.ok(siteCheckBatch("people", "11111111-2222").startsWith("check_people_11111111"));
  });

  it("prices both questions from the table and never lands at $0 for a real batch", () => {
    assert.equal(PRICES.gemini.kind, "paid");
    assert.equal(siteCheckWorstCaseCents("icp", 1000), icpWorstCaseCents(1000));
    assert.equal(siteCheckWorstCaseCents("people", 1000), worstCaseCents("gemini", "extract", 1000) + worstCaseCents("jev", "grade", 1000), "D72: Gemini lists the people, Jev picks");
    assert.ok(siteCheckWorstCaseCents("people", 1000) >= 100, "D72: about $1 per 1,000 sites for the people pages plus Jev");
    assert.equal(siteCheckWorstCaseCents("icp", 0), 0);
    assert.equal(siteCheckWorstCaseCents("people", 0), 0);
  });

  it("asks for a name, queues domains only, never returns a person, never changes a row, never DDLs", async () => {
    const src = await readFile(new URL("src/canon/siteCheck.ts", root), "utf8");
    assert.match(src, /kind: "spend_approval"/, "D51/D71: a card before a model runs");
    assert.match(src, /resolveAs\(`\$\{approvedBy\} via \$\{d\.by\}`, "owner"/, "D71: the name taps the card as an owner");
    assert.match(src, /insert into \$\{PEOPLE_TEXT\} \(domain, batch\)\s+select d\.d/, "D72: the people question queues domains, not names");
    assert.doesNotMatch(src, /returning/i, "D2/D71: no insert returns a row");
    assert.doesNotMatch(src, /\b(delete from|alter table|create table|create index|drop )/i, "D67/D71: no deletes and no runtime DDL");
    assert.doesNotMatch(src, /select[^`]*\b(full_name|first_name|last_name|email|phone)\b/i, "D2/D72: the service never selects a person back");
    for (const m of src.matchAll(/query<\{([^}]*)\}>/g)) {
      assert.doesNotMatch(m[1]!, /\b(full_name|first_name|last_name|email|phone|linkedin_url)\b/, `D2/D71: a row shape read back names a person: ${m[1]}`);
    }
    assert.doesNotMatch(src, /^\s*`?update \$\{scope\.rel\}/m, "D71: the verb never updates the store's rows");
    assert.match(src, /SAMPLE_FLAGGED = 10/, "D2: the ten-sample rule");
    assert.match(src, /SAMPLE_FOUND = 10/, "D2: at most ten found domains, with the title, never the name");
  });

  it("the tables are a migration with the service grants, the client has fetch, extract and ask, and the docs name the verb", async () => {
    const m = await readFile(new URL("supabase/migrations/0023_site_people.sql", root), "utf8");
    for (const t of ["topup.site_people_text", "topup.site_people", "topup.site_extractions", "topup.site_answers"]) assert.ok(m.includes(`create table if not exists ${t}`), `D72: migration creates ${t}`);
    assert.match(m, /create or replace view topup\.site_people_found/, "D72: the people found are a view a table pull reads");
    assert.match(m, /grant select, insert, update on topup\.site_people_text to leadtopup_app/);
    assert.match(m, /grant select on topup\.site_people, topup\.site_extractions, topup\.site_answers, topup\.site_people_found to leadtopup_app/);
    assert.doesNotMatch(m, /^\s*drop /im, "D72: dropping D71's queue is Josh's call, not this migration's");
    const client = await readFile(new URL("src/clients/sitePeople.ts", root), "utf8");
    for (const mode of ["fetch", "extract", "ask"]) assert.ok(client.includes(`mode: "${mode}"`), `D72: the site-people client has the ${mode} mode`);
    const gate = await readFile(new URL("src/clients/icpGate.ts", root), "utf8");
    assert.doesNotMatch(gate, /mode: "people"/, "D72: the held-name people mode of D71 is gone from the gate client");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /`site_check\(/, "D71: CANON.md names the verb");
    assert.match(canon, /looking_for/, "D72: CANON.md names looking_for");
    assert.match(canon, /site_people_found/, "D72: CANON.md says where the people found land");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /`site_check`/, "D71: the babysitter skill tells Grok about the checker");
    const servers = await readFile(new URL("docs/servers.md", root), "utf8");
    assert.match(servers, /^## .*Site people/m, "D72: docs/servers.md documents the site-people function");
    const env = await readFile(new URL(".env.example", root), "utf8");
    assert.match(env, /^SITE_PEOPLE_KEY=$/m, "D3/D72: the function key is a Railway variable, named here, never valued");
  });
});
