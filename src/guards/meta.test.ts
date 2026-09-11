import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The ledger cannot fork and the canon cannot rot (convention copied from
 * deliverabilitywizard). A decision that is not in CANON.md is not shipped.
 */

const ledgerUrl = new URL("../../DECISIONS.md", import.meta.url);
const canonUrl = new URL("../../CANON.md", import.meta.url);

const ENTRY_HEADER = /^## D(\d+) — /gm;

async function ledgerNumbers(): Promise<number[]> {
  const ledger = await readFile(ledgerUrl, "utf8");
  return [...ledger.matchAll(ENTRY_HEADER)].map((m) => Number(m[1]));
}

describe("meta — decision ledger integrity", () => {
  it("every decision number is unique", async () => {
    const numbers = await ledgerNumbers();
    const seen = new Map<number, number>();
    for (const n of numbers) seen.set(n, (seen.get(n) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([n]) => `D${n}`);
    assert.deepEqual(dupes, [], `DECISIONS.md has duplicate decision headers: ${dupes.join(", ")}. Renumber the newer entry (next free number across main AND open PRs).`);
  });

  it("decision numbers are contiguous from D1", async () => {
    const numbers = await ledgerNumbers();
    const sorted = [...numbers].sort((a, b) => a - b);
    sorted.forEach((n, i) => assert.equal(n, i + 1, `DECISIONS.md skips a number near D${n}; entries are appended in order.`));
  });

  it("CANON.md names the newest decision", async () => {
    const max = Math.max(...(await ledgerNumbers()));
    const canon = await readFile(canonUrl, "utf8");
    assert.match(canon, new RegExp(`Canon as of \\*\\*D${max}\\*\\*`), `CANON.md must say "Canon as of **D${max}**". Fold D${max} into CANON.md in the same PR.`);
  });

  it("the status index covers the newest decision", async () => {
    const max = Math.max(...(await ledgerNumbers()));
    const ledger = await readFile(ledgerUrl, "utf8");
    assert.match(ledger, new RegExp(`^\\| D${max} \\|`, "m"), `The DECISIONS.md status index has no row for D${max}. Add its status line when appending the entry.`);
  });

  it("every guard file names a decision", async () => {
    const { readdir } = await import("node:fs/promises");
    const dir = new URL("./", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".test.ts") && f !== "meta.test.ts");
    for (const f of files) {
      const src = await readFile(new URL(f, dir), "utf8");
      assert.match(src, /D\d+/, `${f} does not cite a decision (Dn). A guard without a decision is an opinion.`);
    }
  });
});
