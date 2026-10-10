import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { STEP_RULES } from "../jobs/rules.js";
import { SIZE_SUPPRESS_BIND_OFFSET, shiftSqlParams, sizeSuppressJoinSql } from "../canon/size.js";
import { emptyMergeFields } from "../spine/gate.js";

/**
 * D69 — job 46b1c941 after #46. Ask Josh before any of this changes.
 */

const root = new URL("../../", import.meta.url);

describe("D69 — rerun replaces hold counts; size suppress binds do not collide", () => {
  it("resetStep wipes result counts; finishStep replaces; normalize emits held_* zeros", async () => {
    const repo = await readFile(new URL("src/db/repo.ts", root), "utf8");
    assert.match(repo, /jsonb_build_object\('approved_by'/, "D69: resetStep keeps approved_by only. Ask Josh.");
    assert.match(repo, /when \$6::jsonb is null then counts/, "D69: finishStep with no patch keeps counts. Ask Josh.");
    assert.match(repo, /end \|\| \$6::jsonb/, "D69: finishStep replaces counts instead of merging. Ask Josh.");
    assert.doesNotMatch(repo, /counts = counts \|\| coalesce\(\$6/, "D69: must not merge stale held_*. Ask Josh.");
    const norm = await readFile(new URL("src/stages/normalize/index.ts", root), "utf8");
    assert.match(norm, /heldDetail\.map\(\(\[f, n\]\) => \[`held_\$\{f\}`/, "D69: every required field is counted. Ask Josh.");
    assert.doesNotMatch(norm, /filter\(\(\[, n\]\) => n > 0\)[\s\S]*finishStep/, "D69: zeros must be written so held_company_n cannot stick. Ask Josh.");
    assert.match(norm, /\$\{valueSql\(f\)\} as "\$\{f\}"/, "D69: hold RETURNING is the same expression as the hold check. Ask Josh.");
    assert.equal(STEP_RULES.normalize, "d69:hold-recompute-size", "D69: normalize hash must change so the 147 reopen. Ask Josh.");
    assert.deepEqual(emptyMergeFields({ company_n: "Acme", company_name: "" }, ["company_n"]), []);
  });

  it("size pool binds start after $10 so $2 stays interested ids", () => {
    assert.equal(SIZE_SUPPRESS_BIND_OFFSET, 10);
    assert.equal(shiftSqlParams("plan_id = $1::text and cat = any($2::text[])", 10), "plan_id = $11::text and cat = any($12::text[])");
    const sql = sizeSuppressJoinSql(
      {
        schema: "client_emcor",
        fromSql: `(select place_id from x where plan_id = $1::text and lower(main_category) = any($2::text[])) pool`,
        params: ["custom-1", ["church"]],
        cats: ["church"],
        companion: true,
      },
      '"lp"."emcor_ingested_leads"',
      [],
    );
    assert.match(sql, /\$2::int\[\]/, "D69: $2 remains interested category ids. Ask Josh.");
    assert.match(sql, /\$11::text/, "D69: pool plan_id is $11. Ask Josh.");
    assert.match(sql, /\$12::text\[\]/, "D69: pool categories are $12. Ask Josh.");
    assert.doesNotMatch(sql, /any\(\$2::text\[\]\)/, "D69: $2 must not be text[] categories. Ask Josh.");
  });

  it("CANON names the replace-on-rerun and the size bind shift", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D70\*\*/, "D70 is current; D69 stays folded. Ask Josh.");
    assert.match(canon, /replaces/, "D69: a rerun replaces step counts. Ask Josh.");
    assert.match(canon, /\$11/, "D69: size pool binds start at $11. Ask Josh.");
  });
});
