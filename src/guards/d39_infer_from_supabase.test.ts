import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { JUDGEMENT_CHOICES } from "../slack/roles.js";

const root = new URL("../../", import.meta.url);

/** D39 — infer the segment from Supabase; stop encoding the ICP as rules. */

describe("D39 — infer the segment from Supabase", () => {
  it("CANON and the decision ledger name D39", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D40\*\*|Canon as of \*\*D39\*\*/);
    assert.match(canon, /receipt plus its outcome is the recipe|lane_exclusions|v_receipt_outcome/);
    assert.match(ledger, /## D39 — /);
    assert.match(ledger, /^\| D39 \|/m);
  });

  it("the migration creates the views, exclusions, reasoning log, and josh_confirmed", async () => {
    const sql = await readFile(new URL("supabase/migrations/0016_d39_infer_from_supabase.sql", root), "utf8");
    assert.match(sql, /azpapwtnrbzywlnxxecz/);
    assert.match(sql, /josh_confirmed/);
    assert.match(sql, /basis_receipt_ids/);
    assert.match(sql, /topup\.lane_exclusions/);
    assert.match(sql, /topup\.v_receipt_outcome/);
    assert.match(sql, /topup\.v_lane_runway/);
    assert.match(sql, /topup\.run_reasoning/);
    assert.match(sql, /topup\.unloaded_inventory/);
    assert.match(sql, /Dave rejected C suite/);
    assert.doesNotMatch(sql, /v_bounce > 0\.08/);
    assert.match(sql, /bounce_rate is display-only/);
  });

  it("0017 keeps bounce_rate off the verdict", async () => {
    const sql = await readFile(new URL("supabase/migrations/0017_d39_ignore_bounce_rate.sql", root), "utf8");
    assert.doesNotMatch(sql, /v_bounce > 0\.08/);
    assert.match(sql, /bounce_rate is display-only/);
    assert.match(sql, /v_sends >= 2000 and v_interested = 0/);
  });

  it("segment and receipt-confirm cards are Josh's tap", () => {
    for (const c of ["approve_segment", "decline_segment", "confirm_receipt", "edit_receipt", "widen_0"]) {
      assert.ok(JUDGEMENT_CHOICES.includes(c), c);
    }
  });

  it("startTopup can open a run from a receipt skeleton when infer parks", async () => {
    const orch = await readFile(new URL("src/orchestrator.ts", root), "utf8");
    assert.match(orch, /skeletonRecipe/);
    assert.match(orch, /approve_segment/);
  });
});
