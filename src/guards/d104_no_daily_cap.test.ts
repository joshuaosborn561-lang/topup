import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { loadConfig } from "../config.js";
import { SpendRails } from "../spend/rails.js";

/**
 * D104 — no daily cap: what the approver says yes to is the limit. A parked
 * step waits for a named call. Ask Josh before putting a cap back.
 */
const root = new URL("../../", import.meta.url);

describe("D104 — no daily cap; parked waits for a name", () => {
  it("an approved amount runs whatever was spent today; an unapproved one still asks", () => {
    const rails = new SpendRails({} as never, { autoCapCents: 0, driftTolerance: 0.1 });
    const req = { runId: "r", clientTag: "c", step: "find_emails" as const, vendor: "aiark", action: "find_email", rows: 10_000, recipeAuthorised: true };
    assert.equal(rails.decide({ ...req, approvedCents: 50_000 }, 10_000_000).kind, "proceed", "D104: no daily cap blocks an approved amount");
    assert.equal(rails.decide(req, 0).kind, "ask", "D51: nothing unapproved runs");
    assert.ok(!("DAILY_VENDOR_CAP_USD" in loadConfig({})), "D104: the daily cap is not read");
  });

  it("the rails source has no daily cap and a parked step is closed as parked", async () => {
    const rails = await readFile(new URL("src/spend/rails.ts", root), "utf8");
    assert.doesNotMatch(rails, /dailyCapCents/, "D104: no daily cap in the spend rails");
    const common = await readFile(new URL("src/stages/common.ts", root), "utf8");
    assert.match(common, /failStep\(run\.run_id, stage, reason, true\)/, "D104: park() closes the step as parked");
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.match(runner, /r\.parked \|\| !\(r\.interrupted/, "D104: boot skips a parked job");
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /no\s+daily cap/i);
    assert.match(canon, /\(D104\)/);
  });
});
