import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { describe, it } from "node:test";
import { STEPS } from "../domain/runs.js";
import { SPINE, UNPLACED_STAGES, stepForStage, stepLabel } from "../spine/steps.js";

/**
 * D24 — the state machine is the thirteen steps of skills/lead-list-build.
 * The spine table is the only place a step gets a number, an owner, a gate
 * and a title; every internal stage maps onto it; and when the skill file is
 * in the repo the table must agree with it. Ask Josh before changing any of
 * this: the skill wins on the order of steps and their gates.
 */

const root = new URL("../../", import.meta.url);
const SKILL = new URL("skills/lead-list-build/SKILL.md", root);

describe("the spine — D24", () => {
  it("has exactly thirteen steps, numbered 1..13 in order", () => {
    assert.equal(SPINE.length, 13, "D24: the skill has thirteen steps; the spine must too");
    SPINE.forEach((s, i) => assert.equal(s.n, i + 1));
  });

  it("owners are as Josh assigned them: code runs 3–12, Josh owns 1 and 13, Cayden clears 5 and 8, Josh taps 9 when copy is needed", () => {
    const by = (n: number) => SPINE[n - 1];
    assert.equal(by(1).owner, "josh");
    assert.equal(by(13).owner, "josh");
    for (let n = 3; n <= 12; n++) assert.equal(by(n).owner, "code", `D24: step ${n} is run by code`);
    assert.equal(by(5).also?.who, "cayden");
    assert.equal(by(8).also?.who, "cayden");
    assert.equal(by(9).also?.who, "josh");
    assert.equal(by(3).also?.who, "josh", "D21/D24: company-first lanes need Josh's yield tap and pilot tap at step 3");
  });

  it("every step has a gate, and the gates Josh named first say what he said", () => {
    for (const s of SPINE) assert.ok(s.gate.length > 10, `D25: step ${s.n} has its gate copied from the skill`);
    assert.match(SPINE[0].gate, /signs off on the segment before anything is pulled/);
    assert.match(SPINE[1].gate, /useful floor/);
    assert.match(SPINE[2].gate, /titles audited, spend within the approved ceiling/);
    assert.match(SPINE[4].gate, /raw, removed by reason, net new/);
    assert.match(SPINE[5].gate, /sendable count and reject rate reported/);
    assert.match(SPINE[6].gate, /every merge field the copy uses is populated or the row is held/);
    assert.match(SPINE[10].gate, /counts match on every campaign/);
    assert.match(SPINE[11].gate, /receipt posted/);
  });

  it("every internal pipeline stage sits on exactly one step, or is listed as unplaced (a question for Josh)", () => {
    const seen = new Map<string, number[]>();
    for (const s of SPINE) for (const p of s.pipeline) seen.set(p, [...(seen.get(p) ?? []), s.n]);
    for (const stage of STEPS) {
      const on = seen.get(stage) ?? [];
      if (UNPLACED_STAGES.includes(stage)) {
        assert.equal(on.length, 0, `D24: ${stage} is listed unplaced but also sits on step ${on.join(",")}`);
        assert.equal(stepForStage(stage), null);
      } else {
        assert.equal(on.length, 1, `D24: ${stage} must sit on exactly one step (found ${on.join(",") || "none"}); place it or add it to UNPLACED_STAGES and ask Josh`);
      }
    }
    assert.equal(UNPLACED_STAGES.length, 0, "D25: the skill places every stage; an unplaced stage is a question for Josh, not a state");
    assert.equal(stepForStage("trigger")?.n, 1, "D25: a run opens against the signed-off segment (the recipe)");
    assert.equal(stepForStage("pull")?.n, 3);
    assert.equal(stepForStage("ingest")?.n, 4, "D25: Ingest is its own step in the skill");
    assert.equal(stepForStage("suppress")?.n, 5);
    assert.equal(stepForStage("verify")?.n, 6);
    assert.equal(stepForStage("normalize")?.n, 7);
    assert.equal(stepForStage("qa")?.n, 8);
    assert.equal(stepForStage("route")?.n, 9);
    assert.equal(stepForStage("stage")?.n, 10, "D25: Stage is step 10 in the skill");
    assert.equal(stepForStage("import")?.n, 11);
    assert.equal(stepForStage("post_import")?.n, 12);
  });

  it("labels never invent a name: the label is the number and the skill's title", () => {
    for (const s of SPINE) assert.equal(stepLabel(s.n), `Step ${s.n} — ${s.title}`);
    assert.equal(stepLabel(null), "no step (idle)");
  });

  it("only the ledger writes lane_state.step", async () => {
    const files = await walk(new URL("src/", root));
    for (const f of files) {
      if (f.endsWith("ledger/lane.ts") || f.endsWith(".test.ts")) continue;
      const text = await readFile(f, "utf8");
      assert.doesNotMatch(text, /topup\.lane_state/, `D24: ${f} touches topup.lane_state directly; go through LaneLedger so every step change is an event`);
    }
  });

  it("agrees with skills/lead-list-build/SKILL.md: titles, owners and gates are the skill's, word for word", async () => {
    const text = await readFile(SKILL, "utf8");
    const found = parseSkill(text);
    assert.equal(found.size, 13, `D25: expected thirteen "## Step N." headings in the skill, found ${found.size}`);
    for (const s of SPINE) {
      const k = found.get(s.n);
      assert.ok(k, `D25: the skill has no heading for step ${s.n}`);
      assert.equal(s.title, k.title, `D25: step ${s.n} title differs from the skill heading`);
      assert.equal(s.owner, k.owner, `D25: step ${s.n} owner differs from the skill heading "(${k.ownerText})"`);
      if (k.gate) assert.equal(s.gate, k.gate, `D25: step ${s.n} gate differs from the skill's "Gate:" line`);
      else assert.ok(s.n === 13, `D25: only step 13 has no "Gate:" line in the skill; step ${s.n} is missing one`);
      // The heading also names the second human, when there is one.
      const alsoText = k.ownerText.toLowerCase();
      if (s.owner === "code" && alsoText.includes("cayden")) assert.equal(s.also?.who, "cayden", `D25: step ${s.n} heading names Cayden`);
      if (s.owner === "code" && alsoText.includes("josh")) assert.equal(s.also?.who, "josh", `D25: step ${s.n} heading names Josh`);
    }
  });
});

/** `## Step N. Title (owner, …)` headings and the `Gate:` line that follows each. */
function parseSkill(text: string): Map<number, { title: string; owner: "code" | "josh" | "cayden"; ownerText: string; gate: string | null }> {
  const out = new Map<number, { title: string; owner: "code" | "josh" | "cayden"; ownerText: string; gate: string | null }>();
  const headings = [...text.matchAll(/^##\s+Step\s+(\d{1,2})\.\s+(.+?)\s*\(([^)]*)\)\s*$/gm)];
  headings.forEach((m, i) => {
    const n = Number(m[1]);
    const body = text.slice(m.index! + m[0].length, headings[i + 1]?.index ?? text.length);
    const gate = body.match(/^Gate:\s*(.+?)\s*$/m)?.[1] ?? null;
    const ownerText = m[3].trim();
    const first = ownerText.split(/[,;]/)[0].trim().toLowerCase();
    const owner = first.startsWith("code") ? "code" : first.startsWith("josh") ? "josh" : first.startsWith("cayden") ? "cayden" : null;
    assert.ok(owner, `D25: cannot read the owner of step ${n} from "(${ownerText})"`);
    out.set(n, { title: m[2].trim(), owner, ownerText, gate });
  });
  return out;
}

async function walk(dir: URL): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p.pathname);
  }
  return out;
}
