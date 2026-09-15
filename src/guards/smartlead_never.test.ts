import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D6 — the service never starts, pauses or stops a campaign, never deletes
 * anything in Smartlead, and never removes an API-added block-list entry.
 * Only Josh flips a campaign active. This scan fails the build the moment a
 * forbidden endpoint or verb shows up in source. Ask Josh; the answer is no.
 */

const srcRoot = new URL("../", import.meta.url);

const FORBIDDEN: Array<[string, RegExp]> = [
  ["campaign status change", /campaigns\/[^"'`\s]*\/status/i],
  ["campaign status payload", /status\s*:\s*["'](START|PAUSED|STOPPED)["']/],
  ["Smartlead delete", /method\s*:\s*["']DELETE["'][^\n]*smartlead|smartlead[^\n]*method\s*:\s*["']DELETE["']/i],
  ["block-list removal", /block[-_ ]?list[^\n]{0,60}(remove|delete)|(remove|delete)[^\n]{0,60}block[-_ ]?list/i],
  ["lead deletion", /leads\/[^"'`\s]*\/delete|delete[-_]?lead/i],
];

async function walk(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const u = new URL(e.isDirectory() ? `${e.name}/` : e.name, dir);
    if (e.isDirectory()) out.push(...(await walk(u)));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(u);
  }
  return out;
}

describe("D6 — Smartlead is never started, paused, stopped or deleted from here", () => {
  it("no forbidden Smartlead endpoint or verb in source", async () => {
    const files = await walk(srcRoot);
    const hits: string[] = [];
    for (const f of files) {
      const src = await readFile(f, "utf8");
      for (const [name, re] of FORBIDDEN) if (re.test(src)) hits.push(`${f.pathname.replace(srcRoot.pathname, "src/")}: ${name}`);
    }
    assert.deepEqual(hits, [], "D6: source would change campaign status, delete in Smartlead, or remove a block-list entry. Only Josh does that, by hand.");
  });
});
