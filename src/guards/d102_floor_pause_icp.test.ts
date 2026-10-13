import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * D102 — below the 1,000 floor the quote still posts and the approver
 * decides; loads start paused until an approver flips them; the ICP label
 * set is a precondition for a yes; lane-table writes carry the run. Ask
 * Josh before changing any of the four.
 */
const root = new URL("../../", import.meta.url);

async function sources(rel: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  const base = new URL(rel, root);
  for (const f of await readdir(base, { recursive: true })) {
    const name = String(f);
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    out.push([`${rel}${name}`, await readFile(new URL(name, base), "utf8")]);
  }
  return out;
}

describe("D102 — the floor, the pause, the label set", () => {
  it("the canon and the standing orders say the approver decides under the floor, and say loads start paused", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /\*\*Under 1,000 new leads after dedupe\*\* the quote says the floor is not\s+met/, "D102: rule 9 reports the floor");
    assert.match(canon, /they decide \(D102\)/, "D102: rule 9 leaves the call to the approver");
    assert.doesNotMatch(canon, /exhausted\* and stop/, "D102: the canon no longer tells the bot to stop under the floor");
    assert.match(canon, /Loads start paused \(D102\)/);
    assert.match(canon, /topup\.icp_variants/, "D102: the ICP label set precondition is in the canon");
    const skill = await readFile(new URL("skills/grok-bot-babysitter/SKILL.md", root), "utf8");
    assert.match(skill, /they decide \(D102\)/);
    assert.doesNotMatch(skill, /say the TAM is exhausted; stop/);
    assert.match(skill, /Loads start paused \(D102\)/);
    const flags = await readFile(new URL("supabase/migrations/0028_service_flags.sql", root), "utf8");
    assert.match(flags, /loads_paused/, "D102: the flag the service reads");
    assert.match(flags, /true/, "D102: loads start paused; the migration seeds the flag");
  });

  it("the runner posts the quote below the floor, says loads are paused, and resumes a job cut off before its card", async () => {
    const src = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.match(src, /below_floor: belowFloor/, "D102: the quote payload says when it is under the floor");
    assert.match(src, /they decide \(D102\)/, "D102: the answer leaves the call to the approver");
    assert.match(src, /private async pauseNote\(\)/, "D102: the quote answer says loads are paused");
    assert.match(src, /r\.interrupted \|\| r\.phase === "quote"/, "D102: boot resumes a quote with no card yet");
    assert.match(src, /icp_ready === false/, "D102: a yes is refused until the client's ICP label set exists");
    assert.match(src, /coalesce\(qa_flags->>'pool_label', source_label\)/, "D102: abort gives a table pool its label back");
    assert.match(src, /That is a database error, not a missing build/, "D102: a database error is never 'no recorded build'");
  });

  it("every lane-table write a stage makes carries the run id (migration 0002's write lock refuses the rest)", async () => {
    const bare = /(?:\bdb|raw\(\))\.query(?:<[^>]*>)?\(\s*`\s*(?:update|delete from) \$\{/;
    for (const [name, src] of [...(await sources("src/stages/")), ...(await sources("src/jobs/"))]) {
      assert.ok(!bare.test(src), `D102: ${name} updates or deletes lane rows through the plain pool; use repo.withRun(runId, tx => ...). Ask Josh.`);
    }
    const verify = await readFile(new URL("src/stages/verify/verify.ts", root), "utf8");
    assert.match(verify, /withRun\(runId, \(tx\) =>\s+tx\.query\(\s+`update \$\{table\} t set mail_class/, "D102: the mail-class fill runs under the job's run id");
  });
});
