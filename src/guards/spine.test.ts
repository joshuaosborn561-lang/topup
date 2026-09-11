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

  it("the gates Josh named first are named on the spine", () => {
    for (const n of [1, 2, 3, 5, 6, 7, 11]) assert.ok(SPINE[n - 1].gate, `D24: step ${n} has a gate ("the first ones to get right")`);
    assert.equal(SPINE[5].gate, "sendable rule and stall runbook");
    assert.equal(SPINE[6].gate, "every merge field populated");
    assert.equal(SPINE[10].gate, "count assert");
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
    assert.deepEqual(stepForStage("verify")?.n, 6);
    assert.deepEqual(stepForStage("normalize")?.n, 7);
  });

  it("labels never invent a name: without a title from the skill a step is just its number", () => {
    for (const s of SPINE) {
      const label = stepLabel(s.n);
      if (s.title) assert.equal(label, `Step ${s.n} — ${s.title}`);
      else assert.equal(label, `Step ${s.n}`);
    }
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

  it("agrees with skills/lead-list-build/SKILL.md when the skill is in the repo", async (t) => {
    let text: string;
    try {
      text = await readFile(SKILL, "utf8");
    } catch {
      t.skip("skills/lead-list-build/SKILL.md is not in this repository. Titles, the owner of step 2, the gates for 4, 8, 9, 10, 12, 13 and the placement of trigger/stage stay open until Josh adds it.");
      return;
    }
    const found = new Map<number, string>();
    for (const m of text.matchAll(/^#{1,4}\s*(?:step\s*)?(\d{1,2})\s*[.:)\u2014-]\s*(.+?)\s*$/gim)) found.set(Number(m[1]), m[2].trim());
    assert.equal(found.size, 13, `D24: expected thirteen numbered step headings in the skill, found ${found.size}`);
    for (const s of SPINE) {
      assert.ok(s.title, `D24: the skill is present; step ${s.n} needs its title copied into src/spine/steps.ts`);
      assert.equal(s.title, found.get(s.n), `D24: step ${s.n} title differs from the skill`);
    }
  });
});

async function walk(dir: URL): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p.pathname);
  }
  return out;
}
