import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { CHOICE_ROLE, JUDGEMENT_CHOICES } from "../console/roles.js";

/**
 * D18 — the line is judgement. Anything that spends is a person's yes; the
 * service never resolves a card on its own.
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
  it("every choice that spends is owner-only", () => {
    for (const c of JUDGEMENT_CHOICES) {
      assert.equal(CHOICE_ROLE[c], "owner", `D18: ${c} must need a named owner approval. Do not automate a decision to save a card; ask Josh.`);
    }
    assert.ok(JUDGEMENT_CHOICES.includes("approve_spend"), "D51: approve_spend is the named approval.");
  });

  it("only the console resolves a card; no stage, verb or scheduler does it for a human", async () => {
    const offenders: string[] = [];
    for (const f of await walk(new URL("src/", root))) {
      const p = f.pathname.replace(root.pathname, "");
      if (p.endsWith(".test.ts") || p === "src/console/console.ts" || p === "src/db/repo.ts") continue;
      const src = await readFile(f, "utf8");
      if (/\.resolveCard\(/.test(src)) offenders.push(p);
    }
    assert.deepEqual(offenders, [], `D18: a card is resolved outside the console in ${offenders.join(", ")}. Cards are resolved by a person's name through the console, never by code.`);
  });
});
