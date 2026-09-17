import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { BACKFILL_PAID_CAP_CENTS } from "../recipes/elsewhereSize.js";
import { isInferredRecipe } from "../recipes/infer.js";
import { PRICES, worstCaseCents } from "../spend/prices.js";

/** D38 — infer ICP from the list + tags; backfill bands; getleads is unlimited. */

const root = new URL("../../", import.meta.url);

describe("D38 — infer from the list; backfill missing bands", () => {
  it("startTopup no longer refuses to invent; it resolves or infers", async () => {
    const orch = await readFile(new URL("src/orchestrator.ts", root), "utf8");
    assert.match(orch, /resolveOrInfer/);
    assert.doesNotMatch(orch, /the service never invents one/);
  });

  it("CANON and the spine skill name infer-from-list and the $5 backfill ceiling", async () => {
    const canon = await readFile(new URL("CANON.md", root), "utf8");
    assert.match(canon, /Canon as of \*\*D39\*\*|Canon as of \*\*D38\*\*/);
    assert.match(canon, /inferred from the list|infer from the list|list \+ receipt tags/);
    assert.match(canon, /whole backfill.*\$5|\$5.*whole backfill|whole backfill is \$5/s);
    const skill = await readFile(new URL("skills/lead-list-build/SKILL.md", root), "utf8");
    assert.match(skill, /Default \(D39\)|Default \(D38\)/);
    assert.match(skill, /whole backfill is \$5/);
    assert.match(skill, /Josh signs off on the segment before anything is pulled/);
  });

  it("getleads is included / $0; paid leftover backfill is capped at $5 total", () => {
    assert.equal(PRICES.getleads.kind, "included");
    assert.equal(worstCaseCents("getleads", "export", 10_000), 0);
    assert.equal(BACKFILL_PAID_CAP_CENTS, 500);
    assert.equal(worstCaseCents("leadmagic", "company_search", 1), 5);
    assert.ok(isInferredRecipe({ recipe_id: "parlay.it_dm_tickets.v0", owner_approvals: ["inferred_from_list"] }));
  });

  it("trigger wires the leftover paid pass; $5 is the whole-backfill ceiling", async () => {
    const trigger = await readFile(new URL("src/stages/trigger/index.ts", root), "utf8");
    assert.match(trigger, /leadmagicCompanyBand/);
    assert.match(trigger, /paidWorstCaseCents/);
    const boot = await readFile(new URL("src/index.ts", root), "utf8");
    assert.match(boot, /LEADMAGIC_API_KEY/);
    const env = await readFile(new URL(".env.example", root), "utf8");
    assert.match(env, /LEADMAGIC_API_KEY/);
  });

  it("the cache migration exists and health requires the table", async () => {
    const sql = await readFile(new URL("supabase/migrations/0015_company_size_cache.sql", root), "utf8");
    assert.match(sql, /topup\.company_size_cache/);
    const health = await readFile(new URL("src/health.ts", root), "utf8");
    assert.match(health, /topup\.company_size_cache/);
  });
});
