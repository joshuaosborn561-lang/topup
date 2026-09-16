import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { positiveReplySql } from "../stages/suppress/recycle.js";

/** D37 — campaignintelligence positives are the global list; they expire. */

const root = new URL("../../", import.meta.url);

describe("D37 — 90-day global positive-reply list", () => {
  it("positives expire after the reply; DNC and wrong person stay forever", async () => {
    const sql = positiveReplySql("$10");
    assert.match(sql, /public\.leads/);
    assert.match(sql, /public\.sends/);
    assert.match(sql, /replied_at/);
    assert.match(sql, /positive_reply/);
    const suppress = await readFile(new URL("src/stages/suppress/index.ts", root), "utf8");
    assert.match(suppress, /positiveReplySql/);
    assert.doesNotMatch(suppress, /clientDomainListCard/);
    assert.doesNotMatch(suppress, /no customer list on file/);
    assert.match(suppress, /category Do Not Contact, any client, forever/);
    assert.match(suppress, /category Wrong Person, any client, forever/);
  });

  it("CANON and the spine skill drop the empty-list halt", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D37\*\*/);
    assert.match(canon, /expire 90 days after the reply/);
    assert.doesNotMatch(canon, /empty customer domain list halts/);
    const skill = await readFile(new URL("skills/lead-list-build/SKILL.md", root), "utf8");
    assert.match(skill, /90 days after the reply/);
    assert.doesNotMatch(skill, /halt with a Cayden card/);
    assert.doesNotMatch(skill, /confirmed_empty/);
  });

  it("the Slack app manifest names the six slash commands", async () => {
    const manifest = JSON.parse(await readFile(new URL("slack/app-manifest.json", root), "utf8")) as {
      features: { slash_commands: Array<{ command: string; url: string }> };
      settings: { interactivity: { request_url: string } };
    };
    const cmds = manifest.features.slash_commands.map((c) => c.command).sort();
    assert.deepEqual(cmds, ["/holds", "/runs", "/suppress", "/topup", "/where", "/working"]);
    for (const c of manifest.features.slash_commands) {
      assert.match(c.url, /\/slack\/commands$/);
    }
    assert.match(manifest.settings.interactivity.request_url, /\/slack\/interactions$/);
  });
});
