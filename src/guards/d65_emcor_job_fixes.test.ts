import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GROK_READS } from "../mcp/grok.js";
import { shouldReopenStep } from "../jobs/runner.js";
import { qaHoldGroupsSql } from "../stages/qa/index.js";
import { isRoleInbox } from "../stages/normalize/roleInbox.js";
import { sizeSuppressJoinSql } from "../canon/size.js";

/**
 * D65 — job 46b1c941 after #42. Ask Josh before any of this changes.
 */

const root = new URL("../../", import.meta.url);

describe("D65 — EMCOR job 46b1c941 follow-up", () => {
  it("size is async (size_id + poll) and the suppress pass is aggregate SQL", async () => {
    const size = await readFile(new URL("src/canon/size.ts", root), "utf8");
    assert.match(size, /class SizeRunner/, "D65: size returns a size_id and runs in the background. Ask Josh.");
    assert.match(size, /size_id/, "D65: poll size(size_id). Ask Josh.");
    assert.match(size, /left join pos/, "D65: suppress is a join. Ask Josh.");
    assert.match(size, /SIZE_STATEMENT_TIMEOUT_MS/, "D65: the size query times out instead of hanging the MCP call. Ask Josh.");
    const grok = await readFile(new URL("src/mcp/grok.ts", root), "utf8");
    assert.match(grok, /size_id/, "D65: the size tool accepts size_id to poll. Ask Josh.");
    assert.ok((GROK_READS as readonly string[]).includes("size"));
    const sql = sizeSuppressJoinSql({ schema: "client_emcor", fromSql: "x pool", params: [], cats: [], companion: false }, null, []);
    assert.doesNotMatch(sql, /when exists \(select 1 from public\.leads l where lower\(l\.email\) = r\.e/);
  });

  it("approval is idempotent per step/approver/amount", async () => {
    const repo = await readFile(new URL("src/db/repo.ts", root), "utf8");
    assert.match(repo, /greatest\(coalesce\(approved_cents/, "D65: approveStep must not add the same cents twice. Ask Josh.");
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.match(runner, /spend approval already recorded/, "D65: a second tap of the same amount skips the event. Ask Josh.");
    assert.match(runner, /approvedBy/, "D65: the named approver is part of the key. Ask Josh.");
  });

  it("QA hold count is this job's rows, not the lane table and not field×rows", async () => {
    const sql = qaHoldGroupsSql("lp.emcor_ingested_leads");
    assert.match(sql, /where run_id = \$1 and lead_status = 'qa_hold'/, "D65: QA holds are scoped to the job. Ask Josh.");
    assert.match(sql, /job_holds/, "D65: count rows of the job, then aggregate fields. Ask Josh.");
    assert.doesNotMatch(sql, /left join lateral jsonb_array_elements_text/, "D65: must not multiply the count by merge_field_empty. Ask Josh.");
    const qa = await readFile(new URL("src/stages/qa/index.ts", root), "utf8");
    assert.match(qa, /147 × 4 fields was 588/, "D65: the guard names the card bug. Ask Josh.");
  });

  it("a step marked done with work still queued can be reopened", async () => {
    assert.equal(
      shouldReopenStep({ step: "puzzle", status: "done", useful_output: 0, counts: { needs_person: 19, people_ran: 0 }, queued: { needs_person: 19 } }),
      true,
      "D65: 19 needs_person after a false done must reopen. Ask Josh.",
    );
    assert.equal(
      shouldReopenStep({ step: "puzzle", status: "done", useful_output: 19, counts: { people_ran: 1 }, queued: {} }),
      false,
    );
    const runner = await readFile(new URL("src/jobs/runner.ts", root), "utf8");
    assert.match(runner, /shouldReopenStep/, "D65: enrich must reopen a false done. Ask Josh.");
    assert.match(runner, /reopened/, "D65: reopen closes the leftover parked card. Ask Josh.");
    assert.match(runner, /resetStep/, "D65: reopen resets the step. Ask Josh.");
  });

  it("Lane E role-inbox takes company from the Maps name; greeting fallback defaults off", async () => {
    assert.equal(isRoleInbox("info@example.test"), true);
    assert.equal(isRoleInbox("office@example.test"), true);
    const norm = await readFile(new URL("src/stages/normalize/index.ts", root), "utf8");
    assert.match(norm, /maps_business_name/, "D65: company comes from the Maps title. Ask Josh.");
    assert.match(norm, /first_name_fallback/, "D65: greeting is configurable. Ask Josh.");
    assert.match(norm, /merge_field_empty/, "D65: normalize re-processes this job's merge-field holds. Ask Josh.");
    const schema = await readFile(new URL("src/recipes/schema.ts", root), "utf8");
    assert.match(schema, /first_name_fallback/, "D65: the recipe key exists. Ask Josh.");
    const recipe = await readFile(new URL("src/jobs/recipe.ts", root), "utf8");
    assert.doesNotMatch(recipe, /first_name_fallback:/, "D65: the job default is unchanged (Josh deciding). Ask Josh.");
    const copy = await readFile(new URL("src/canon/mapsPool.ts", root), "utf8");
    assert.match(copy, /pick\("company_name", "company", "name", "title"\)/, "D65: maps copy can fill company from title. Ask Josh.");
  });
});
