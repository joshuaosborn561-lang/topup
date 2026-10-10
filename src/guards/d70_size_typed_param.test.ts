import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { sizeSuppressJoinSql } from "../canon/size.js";

/**
 * D70 — size_id 33e8f595 after #47. Ask Josh before leaving $1 untyped.
 */

const root = new URL("../../", import.meta.url);

describe("D70 — size suppress CTE types $1", () => {
  it("CTE names $1::text; pool binds stay at $11 / $12", () => {
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
    assert.match(sql, /\$1::text as plan_id/, "D70: unused $1 must still be typed. Ask Josh.");
    assert.match(sql, /\$2::int\[\]/, "D70: $2 remains interested ids. Ask Josh.");
    assert.match(sql, /\$11::text/, "D70: pool plan_id is $11. Ask Josh.");
    assert.match(sql, /\$12::text\[\]/, "D70: pool categories are $12. Ask Josh.");
  });

  it("CANON names the typed $1 after the $11 shift", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D70\*\*/, "D70: fold into CANON. Ask Josh.");
    assert.match(canon, /\$1::text/, "D70: size types \$1. Ask Josh.");
    assert.match(canon, /\$11/, "D70: pool binds stay at \$11. Ask Josh.");
  });
});
