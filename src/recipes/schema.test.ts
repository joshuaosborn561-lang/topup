import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GETLEADS_BANDS, parseRecipe, recipeAuthorises } from "./schema.js";

/** D7, D8, D13 — a bad recipe fails the suite instead of shredding a pull or spending. */

/** A base recipe shaped like the first lane recipe this service shipped. A fixture, not a lead row. */
async function parlay(): Promise<Record<string, unknown>> {
  return structuredClone(BASE);
}

const BASE: Record<string, unknown> = {
  recipe_id: "parlay.it_dm.v3",
  client_tag: "parlay",
  lane: "it_dm",
  smartlead_client_id: 418274,
  supabase_project: "azpapwtnrbzywlnxxecz",
  owner_approved_at: null,
  source: {
    kind: "getleads",
    params: { job_titles: ["IT Director", "CIO", "IT Manager"], company_size: ["11 to 50", "51 to 200"], countries: ["United States"], max_per_company: 3 },
    widening_candidates: [{ company_size: ["201 to 500"] }, { add_titles: ["COO", "Director of Operations"] }],
  },
  suppression: { response_based: true, client_prior_contacts: true, bounced_any_client: true, public_suppression: true, client_domain_blocklist: true, same_offer_any_client: true, same_gift_any_client: false },
  email_finding: { enabled: false, max_tier: "aiark", fullenrich: false, batch_rows: 200 },
  verify: { seg_split: true, reject_rate_norm: null },
  normalize: { names_cities: true, company: true, location: true, sports_team: { league: "both", pro_only: false } },
  qa: ["junk_titles", "retail_school_purge", "regulated_gift_hold", "nonprofit_to_eos", "company_name_acronym_hold"],
  segments: { band: ["11_50", "51_200"], mail_class: ["SEG", "OTHER"], gift: ["team", "airpods"] },
  routing: [
    { when: { gift: "airpods", band: "11_50" }, campaign_id: 3929973, icp: { kind: "linkedin_native", persona: "it_dm" } },
    { when: { gift: "airpods", band: "51_200" }, campaign_id: 3929974, icp: { kind: "linkedin_native", persona: "it_dm" } },
    { when: { band: "11_50", mail_class: "OTHER" }, campaign_id: 3847839, icp: { kind: "linkedin_native", persona: "it_dm" } },
    { when: { band: "11_50", mail_class: "SEG" }, campaign_id: 3847846, icp: { kind: "linkedin_native", persona: "it_dm" } },
    { when: { band: "51_200", mail_class: "OTHER" }, campaign_id: 3847837, icp: { kind: "linkedin_native", persona: "it_dm" } },
    { when: { band: "51_200", mail_class: "SEG" }, campaign_id: 3847844, icp: { kind: "linkedin_native", persona: "it_dm" } },
  ],
  required_fields: ["first_name_n", "company_n", "location", "local_sports_team", "job_title", "company_size", "vertical"],
  runway: { floor_days: 7, target_days: 30, max_per_run: 10000 },
  working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
  spend: { auto_cap_usd: 0 },
  owner_approvals: ["icp_change", "new_campaign", "spend_over_cap", "copy"],
};

function withPath(base: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const copy = structuredClone(base);
  let cur: Record<string, unknown> = copy;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[path[path.length - 1]] = value;
  return copy;
}

describe("recipe schema", () => {
  it("a base lane recipe validates", async () => {
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
    const withProfiles = structuredClone(base) as { source: { params: Record<string, unknown> } };
    withProfiles.source.params.employee_profiles_on_linkedin = { min: 11, max: 200 };
    assert.throws(() => parseRecipe(withProfiles), /employee_profiles_on_linkedin/);
  });

  it("D13 — industry names with commas are rejected", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["source", "params", "industries"], ["Banking, Finance"])), /commas/);
    assert.doesNotThrow(() => parseRecipe(withPath(base, ["source", "params", "industries"], ["Banking", "Finance"])));
    assert.doesNotThrow(() =>
      parseRecipe(withPath(base, ["source", "params", "industries"], ["Transportation, Logistics, Supply Chain and Storage"])),
    );
  });

  it("D35 item 15 — every email status may be pulled; unknown names are rejected", async () => {
    const base = await parlay();
    assert.doesNotThrow(() => parseRecipe(withPath(base, ["source", "params", "email_status"], ["VALID", "CATCH_ALL"])));
    assert.throws(() => parseRecipe(withPath(base, ["source", "params", "email_status"], ["GUESSED"])), /invalid recipe/);
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
    assert.throws(() => parseRecipe(withPath(base, ["email_finding", "steps"], ["hunter"])), /out of the stack/);
  });

  it("D1 — a recipe must name campaignintelligence", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["supabase_project"], "kemvxzhcxvynmoutwdrh")), /invalid recipe/);
  });

  it("D9 — a recipe may lower the auto cap, never raise it", async () => {
    const base = await parlay();
    assert.throws(() => parseRecipe(withPath(base, ["spend", "auto_cap_usd"], 6)), /never raise/);
    assert.doesNotThrow(() => parseRecipe(withPath(base, ["spend", "auto_cap_usd"], 0)));
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
    assert.equal(r.suppression.recycle_after_days, 180, "D63: 6-month send window");
    assert.equal(r.suppression.exclude_other_live_campaigns, true, "D36 item 2: never two live campaigns of the same client");
    assert.equal(r.email_finding.name_to_email, false, "D36 item 71: Name to Email is paused");
    assert.equal(r.verify.drop_gateway_catchalls, false, "D36 item 58: Insight-only; Parlay still segments");
    assert.equal(r.working.variant_min_sends, 1000, "D35 item 12: variant bar is 1,000 sends");
    assert.equal("email_status" in (await parlay()).source.params, false, "D35 item 15: omit email_status to pull every status");
    assert.equal("employee_profiles_on_linkedin" in (await parlay()).source.params, false);
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
