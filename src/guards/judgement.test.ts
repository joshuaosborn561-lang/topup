import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CHOICE_ROLE, JUDGEMENT_CHOICES, OWNER_SPEND_FLOOR_CENTS, requiredRole, SPEND_CHOICES } from "../slack/roles.js";

/**
 * D18 — the line is judgement. Anything that spends, widens, scales or flips
 * is a human tap; the service never resolves a card on its own. D47 moves
 * the tap to Cayden for everything except spend above $50, which is Josh's.
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
  it("every choice that spends, widens, scales or flips is a human tap; only spend above $50 is Josh's (D47)", () => {
    for (const c of JUDGEMENT_CHOICES) {
      assert.ok(CHOICE_ROLE[c], `D18: ${c} must be a card choice a human taps. Do not automate a decision to save a card.`);
      assert.equal(CHOICE_ROLE[c], "operator", `D47: ${c} must not wait on Josh by default; only a spend gate above $50 does. Ask Josh.`);
    }
    for (const c of ["approve_yield", "decline_yield", "scale_pilot", "stop_pilot"]) {
      assert.ok(JUDGEMENT_CHOICES.includes(c), `D21: ${c} is the pilot gate; nothing scales without that second tap.`);
    }
    assert.equal(OWNER_SPEND_FLOOR_CENTS, 5000, "D47: the only thing that waits on Josh is a spend gate above $50. Ask Josh before moving the floor.");
    for (const c of SPEND_CHOICES) {
      assert.equal(requiredRole(c, { worst_case_cents: 5001 }), "owner", `D47: ${c} above $50 needs Josh`);
      assert.equal(requiredRole(c, { worst_case_cents: 5000 }), "operator", `D47: ${c} at $50 is Cayden's`);
      assert.equal(requiredRole(c, {}), "owner", `D47: ${c} with no amount on the card is never guessed down`);
    }
    assert.equal(requiredRole("decline_spend", { worst_case_cents: 999_999 }), "operator", "D47: declining never spends; Cayden may decline any amount");
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
