import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { GETLEADS_BANDS, parseRecipe, recipeAuthorises } from "./schema.js";

/** D7, D8, D13 — a bad recipe fails the suite instead of shredding a pull or spending. */

async function parlay(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL("../../recipes/parlay/it_dm.json", import.meta.url), "utf8"));
}

function withPath(base: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const copy = structuredClone(base);
  let cur: Record<string, unknown> = copy;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[path[path.length - 1]] = value;
  return copy;
}

describe("recipe schema", () => {
  it("the shipped Parlay recipe validates", async () => {
    const r = parseRecipe(await parlay());
    assert.equal(r.recipe_id, "parlay.it_dm.v3");
    assert.equal(r.email_finding.fullenrich, false);
  });

  it("D13 — headcount is band labels, never numeric bounds", async () => {
    const base = await parlay();
    assert.ok(GETLEADS_BANDS.includes("51 to 200"));
    assert.throws(() => parseRecipe(withPath(base, ["source", "params", "company_size"], ["51-200"])), /invalid recipe/);
    assert.throws(() => parseRecipe(withPath(base, ["source", "params", "company_size"], [51, 200])), /invalid recipe/);
    const withBounds = structuredClone(base) as { source: { params: Record<string, unknown> } };
    withBounds.source.params.employee_count_min = 51;
    assert.throws(() => parseRecipe(withBounds), /invalid recipe/);
  });

  it("D13 — industry names with commas are rejected", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["source", "params", "industries"], ["Banking, Finance"])), /commas/);
    assert.doesNotThrow(() => parseRecipe(withPath(base, ["source", "params", "industries"], ["Banking", "Finance"])));
  });

  it("D13 — only VALID email status", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["source", "params", "email_status"], ["VALID", "CATCH_ALL"])), /invalid recipe/);
  });

  it("D7 — FullEnrich needs the owner stamp on that recipe", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["email_finding", "fullenrich"], true)), /owner_approved_at/);
    const stamped = withPath(withPath(base, ["email_finding", "fullenrich"], true), ["owner_approved_at"], "2026-09-11T00:00:00Z");
    assert.doesNotThrow(() => parseRecipe(stamped));
    assert.throws(() => parseRecipe(withPath(base, ["email_finding", "max_tier"], "fullenrich")), /fullenrich/);
  });

  it("D8 — detect_job_change and banned vendors cannot be recipe steps", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["email_finding", "steps"], ["detect_job_change"])), /banned/);
    assert.throws(() => parseRecipe(withPath(base, ["email_finding", "steps"], ["pdl"])), /out of the stack/);
  });

  it("D1 — a recipe must name campaignintelligence", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["supabase_project"], "kemvxzhcxvynmoutwdrh")), /invalid recipe/);
  });

  it("D9 — a recipe may lower the auto cap, never raise it", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["spend", "auto_cap_usd"], 6)), /never raise/);
    assert.doesNotThrow(() => parseRecipe(withPath(base, ["spend", "auto_cap_usd"], 2)));
  });

  it("routing cells must come from declared segments; required fields must be produced", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["routing", "0", "when", "gift"], "watch")), /not in segments/);
    assert.throws(() => parseRecipe(withPath(withPath(base, ["normalize", "sports_team"], null), ["required_fields"], ["local_sports_team"])), /no enabled step produces/);
  });

  it("recipeAuthorises names what the service may do; email finding is off in Parlay", async () => {
    const r = parseRecipe(await parlay());
    assert.equal(recipeAuthorises(r, "verify", "millionverifier"), true);
    assert.equal(recipeAuthorises(r, "verify", "leadmagic"), false);
    assert.equal(recipeAuthorises(r, "find_emails", "aiark"), true, "leftover names still go through the cascade up to max_tier");
    assert.equal(recipeAuthorises(r, "find_emails", "fullenrich"), false);
    assert.equal(recipeAuthorises(r, "pull", "getleads"), true);
    assert.equal(r.routing[0]?.icp.kind, "linkedin_native");
    assert.equal(r.routing[0]?.icp.persona, "it_dm");
    assert.equal(
      new Set(r.routing.map((rule) => `${rule.icp.kind}:${rule.icp.persona}`)).size,
      1,
      "Parlay's six campaigns share one persona today; another offer would add a second",
    );
    assert.equal(r.suppression.recycle_after_days, 90);
  });

  it("D30 — every routing rule names its own ICP; the recipe does not", async () => {
    const base = await parlay();
    assert.equal("icp" in base, false);
    assert.throws(() => parseRecipe({ ...base, icp: { kind: "linkedin_native" } }), /invalid recipe/);
    assert.throws(() => parseRecipe(withPath(base, ["routing", "0", "icp"], undefined)), /invalid recipe/);
    assert.throws(
      () => parseRecipe(withPath(base, ["routing", "0", "icp"], { kind: "linkedin_native", persona: "IT DM" })),
      /persona/,
    );
  });
});
