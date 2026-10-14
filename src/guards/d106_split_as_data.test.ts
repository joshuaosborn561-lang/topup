import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { BUILT_IN_DIMENSIONS, DIMENSION_COLUMNS, parseDimension } from "../canon/dimensions.js";

/**
 * D106 — a lane's split is data on its record: rule, routing, dimensions
 * from a four-kind vocabulary. Since D108 that data is passed by Grokbot
 * with the pool, never stored. Ask Josh before adding a kind, a column or
 * a client branch.
 */
const root = new URL("../../", import.meta.url);

describe("D106 — the split is data in a four-kind vocabulary", () => {
  it("the vocabulary is four kinds over lane columns, and never a lead's address or name as a routing key", () => {
    for (const kind of ["match", "set", "present", "hash_parity"]) {
      const base = { name: "x", column: "title" as const };
      const ok =
        kind === "match" ? { ...base, kind, cases: [{ value: "a", pattern: "b" }], else: "c" }
        : kind === "set" ? { ...base, kind, cases: [{ value: "a", values: ["b"] }], else: "c" }
        : kind === "present" ? { ...base, kind, present: "a", absent: "b" }
        : { ...base, kind, even: "a", odd: "b" };
      assert.ok(parseDimension(ok), `D106: ${kind} is a kind`);
    }
    assert.equal(parseDimension({ name: "x", kind: "present", column: "email", present: "a", absent: "b" }), null, "D106: email is never a routing column");
    assert.ok(!(DIMENSION_COLUMNS as readonly string[]).includes("email") && !(DIMENSION_COLUMNS as readonly string[]).includes("last_name"));
    assert.deepEqual([...BUILT_IN_DIMENSIONS], ["band", "mail_class", "gift", "team_source"]);
  });

  it("no client fact is in code: the stages and canon name no client's title words, industries or campaign ids", async () => {
    for (const rel of ["src/canon/dimensions.ts", "src/canon/laneSplit.ts", "src/stages/route/index.ts", "src/jobs/lanePlan.ts"]) {
      const src = await readFile(new URL(rel, root), "utf8");
      assert.doesNotMatch(src, /nursing|residential care|elderly|primary and secondary|assistant\|coordinator|hospital\|medical/i, `D106: ${rel} carries a client's split words; they belong on the record`);
      assert.doesNotMatch(src, /\b(3763|3897|3921|4036|4037)\d{3}\b/, `D106: ${rel} names a campaign id`);
    }
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon.replace(/\s+/g, " "), /a plain-English rule, the routing, the dimensions it reads/);
    assert.doesNotMatch(canon, /emcor|bcp|insight/i, "D106: client facts stay out of the canon");
  });

  it("the route step computes dimensions from the record, not from code", async () => {
    const split = await readFile(new URL("src/canon/laneSplit.ts", root), "utf8");
    assert.match(split, /parseDimensions\(/);
    const route = await readFile(new URL("src/stages/route/index.ts", root), "utf8");
    assert.match(route, /computeDimensions\(dimDefs, r\)/);
    assert.match(route, /cannot read\. Nothing is guessed/);
    const plan = await readFile(new URL("src/jobs/lanePlan.ts", root), "utf8");
    assert.match(plan, /campaign_ids::bigint\[\] && \$3::bigint\[\]/, "D106: list_build_records.campaign_ids is integer[] on production; the overlap must cast it (found live, 13 Oct 2026)");
    const ledger = await readFile(new URL("DECISIONS.md", root), "utf8");
    assert.match(ledger, /^## D106 — /m);
    assert.match(ledger, /^\| D106 \|/m);
  });
});
