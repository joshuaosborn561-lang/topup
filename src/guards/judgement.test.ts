import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CHOICE_ROLE, JUDGEMENT_CHOICES } from "../slack/roles.js";

/**
 * D18 — the line is judgement. Anything that spends, widens, scales or flips
 * is Josh's tap; the service never resolves a card on its own.
 */

const root = new URL("../../", import.meta.url);

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else if (e.name.endsWith(".ts")) out.push(u);
  }
  return out;
}

describe("judgement — D18", () => {
  it("every choice that spends, widens, scales or flips is owner-only", () => {
    for (const c of JUDGEMENT_CHOICES) {
      assert.equal(CHOICE_ROLE[c], "owner", `D18: ${c} must need Josh. Do not automate a decision to save a card; ask Josh.`);
    }
    for (const c of ["approve_yield", "decline_yield", "scale_pilot", "stop_pilot"]) {
      assert.ok(JUDGEMENT_CHOICES.includes(c), `D21: ${c} is the pilot gate; nothing scales without that second tap.`);
    }
  });

  it("only the console resolves a card; no stage or scheduler does it for a human", async () => {
    const offenders: string[] = [];
    for (const f of await walk(new URL("src/", root))) {
      const p = f.pathname.replace(root.pathname, "");
      if (p.endsWith(".test.ts") || p === "src/slack/console.ts" || p === "src/db/repo.ts") continue;
      const src = await readFile(f, "utf8");
      if (/\.resolveCard\(/.test(src)) offenders.push(p);
    }
    assert.deepEqual(offenders, [], `D18: a card is resolved outside the console in ${offenders.join(", ")}. Cards are resolved by a Slack tap or an MCP token, never by code.`);
  });
});
