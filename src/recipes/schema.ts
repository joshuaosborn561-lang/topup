import { z } from "zod";
import { BANNED_ACTIONS, BANNED_VENDORS } from "../spend/prices.js";

/**
 * Lane recipe (design 3.1). The service can only execute what a recipe says.
 * Validation carries the getleads guards from brief section 9 so a bad recipe
 * fails the suite instead of shredding a pull:
 *
 *   - company_size is exact band labels ("51 to 200"), never numeric bounds
 *   - industry names may not contain commas (they silently shred to nothing)
 *   - email_status may only be ["VALID"]
 *   - fullenrich may not be true without owner_approved_at
 *   - detect_job_change is never a step; PDL / BillionVerifier / Clay never a vendor
 */

export const GETLEADS_BANDS = [
  "1 to 10",
  "11 to 50",
  "51 to 200",
  "201 to 500",
  "501 to 1000",
  "1001 to 5000",
  "5001 to 10000",
  "10001+",
] as const;

export const bandLabel = z.enum(GETLEADS_BANDS);

const noComma = z.string().refine((s) => !s.includes(","), {
  message: "industry names containing commas silently shred in getleads; split into separate values",
});

const getleadsParams = z
  .object({
    job_titles: z.array(z.string().min(1)).min(1),
    company_size: z.array(bandLabel).min(1),
    employee_profiles_on_linkedin: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }).optional(),
    countries: z.array(z.string()).optional(),
    states: z.array(z.string()).optional(),
    cities: z.array(z.string()).optional(),
    industries: z.array(noComma).optional(),
    companyIndustry: z.array(noComma).optional(),
    email_status: z.array(z.literal("VALID")).min(1),
    max_per_company: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((p) => !("employee_count_min" in p) && !("employee_count_max" in p), {
    message: "headcount must be band labels, never numeric bounds",
  });

const wideningCandidate = z
  .object({
    company_size: z.array(bandLabel).optional(),
    add_titles: z.array(z.string()).optional(),
    states: z.array(z.string()).optional(),
    industries: z.array(noComma).optional(),
  })
  .strict();

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("getleads"), params: getleadsParams, widening_candidates: z.array(wideningCandidate).default([]) }),
  z.object({
    kind: z.literal("supabase_table"),
    project_ref: z.string().optional(),
    table: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/, "schema.table"),
    where: z.string().min(1),
  }),
]);

const suppression = z
  .object({
    response_based: z.literal(true),
    client_prior_contacts: z.boolean().default(true),
    bounced_any_client: z.boolean().default(true),
    public_suppression: z.boolean().default(true),
    client_domain_blocklist: z.boolean().default(true),
    same_offer_any_client: z.literal(true),
    same_gift_any_client: z.boolean().default(false),
  })
  .strict();

export const EMAIL_TIERS = ["getleads", "smartlead", "aiark", "leadmagic", "prospeo", "fullenrich"] as const;

const emailFinding = z
  .object({
    enabled: z.boolean(),
    max_tier: z.enum(EMAIL_TIERS).default("aiark"),
    fullenrich: z.boolean().default(false),
    batch_rows: z.number().int().min(1).max(500).default(200),
    steps: z.array(z.string()).default([]),
  })
  .strict()
  .refine((e) => !e.steps.some((s) => BANNED_ACTIONS.includes(s.toLowerCase())), {
    message: "detect_job_change is banned; it bills on every call",
  })
  .refine((e) => !e.steps.some((s) => BANNED_VENDORS.includes(s.toLowerCase())), {
    message: "PDL, BillionVerifier and Clay are out of the stack",
  });

const normalize = z
  .object({
    names_cities: z.boolean().default(true),
    company: z.boolean().default(true),
    location: z.boolean().default(true),
    // skill sports-team-assignment: MLB or NFL, or both (MLB first, NFL second, AirPods when both are blank).
    // pro_only is mandatory for education-sector lanes.
    sports_team: z
      .object({ league: z.enum(["mlb", "nfl", "both"]).default("both"), pro_only: z.boolean().default(false) })
      .nullable()
      .default({ league: "both", pro_only: false }),
  })
  .strict();

/**
 * Step 6 (skill lead-list-build): "A reject rate far above the lane's norm
 * means the source is bad, stop and say so." The norm is per lane and comes
 * from Josh; null means no norm yet, so only the zero-sendable case stops a run.
 */
const verify = z
  .object({
    seg_split: z.literal(true),
    reject_rate_norm: z.number().min(0).max(1).nullable().default(null),
  })
  .strict();

const routingRule = z
  .object({
    when: z.record(z.string()),
    campaign_id: z.number().int().positive(),
  })
  .strict();

export const recipeSchema = z
  .object({
    recipe_id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+\.v\d+$/, "client.lane.vN"),
    client_tag: z.string().regex(/^[a-z][a-z0-9_]*$/),
    lane: z.string().regex(/^[a-z][a-z0-9_]*$/),
    smartlead_client_id: z.number().int().positive(),
    supabase_project: z.literal("azpapwtnrbzywlnxxecz"),
    owner_approved_at: z.string().datetime().nullable().default(null),
    source,
    suppression,
    email_finding: emailFinding,
    verify,
    normalize,
    qa: z.array(z.string()).default([]),
    segments: z.record(z.array(z.string())).default({}),
    routing: z.array(routingRule).default([]),
    required_fields: z.array(z.string()).default([]),
    runway: z
      .object({ floor_days: z.number().int().min(1), target_days: z.number().int().min(1), max_per_run: z.number().int().min(1) })
      .strict(),
    working: z
      .object({ interested_per_2000_sends: z.number().min(0.1), variant_min_sends: z.number().int().min(1) })
      .strict(),
    spend: z.object({ auto_cap_usd: z.number().min(0) }).strict(),
    owner_approvals: z.array(z.string()).default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.email_finding.fullenrich && !r.owner_approved_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email_finding", "fullenrich"],
        message: "FullEnrich is off in every recipe until Josh stamps owner_approved_at on that recipe",
      });
    }
    if (r.email_finding.max_tier === "fullenrich" && !r.email_finding.fullenrich) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email_finding", "max_tier"],
        message: "max_tier fullenrich requires fullenrich: true (and the owner stamp)",
      });
    }
    // Every routing cell must be reachable from the declared segments.
    for (const [i, rule] of r.routing.entries()) {
      for (const [dim, value] of Object.entries(rule.when)) {
        const allowed = r.segments[dim];
        if (!allowed) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routing", i, "when", dim], message: `unknown segment dimension ${dim}` });
        } else if (!allowed.includes(value)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routing", i, "when", dim], message: `${value} is not in segments.${dim}` });
        }
      }
    }
    // Every required merge field must be produced by an enabled normalize step or be a source column.
    const produced = new Set<string>(["job_title", "company_size", "vertical", "first_name", "last_name", "email", "company_name"]);
    if (r.normalize.names_cities) produced.add("first_name_n");
    if (r.normalize.company) produced.add("company_n");
    if (r.normalize.location) produced.add("location");
    if (r.normalize.sports_team) produced.add("local_sports_team");
    for (const f of r.required_fields) {
      if (!produced.has(f)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["required_fields"], message: `${f} is required but no enabled step produces it` });
      }
    }
    if (r.spend.auto_cap_usd > 5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["spend", "auto_cap_usd"], message: "a recipe may lower the $5 auto cap, never raise it" });
    }
  });

export type Recipe = z.infer<typeof recipeSchema>;

export function parseRecipe(input: unknown): Recipe {
  const r = recipeSchema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`invalid recipe:\n  ${issues}`);
  }
  return r.data;
}

/** True when `step` is something this recipe allows the service to execute. */
export function recipeAuthorises(recipe: Recipe, step: string, vendor?: string): boolean {
  switch (step) {
    case "verify":
      return vendor === undefined || vendor === "millionverifier" || vendor === "no2bounce";
    case "normalize":
    case "qa":
    case "route":
    case "stage":
    case "import":
    case "post_import":
    case "suppress":
    case "ingest":
      return true;
    case "pull":
      return recipe.source.kind === "getleads" ? vendor === undefined || vendor === "getleads" : true;
    case "find_emails": {
      if (!recipe.email_finding.enabled) return false;
      if (!vendor) return true;
      const maxIdx = EMAIL_TIERS.indexOf(recipe.email_finding.max_tier);
      const idx = EMAIL_TIERS.indexOf(vendor as (typeof EMAIL_TIERS)[number]);
      if (idx < 0 || idx > maxIdx) return false;
      if (vendor === "fullenrich") return recipe.email_finding.fullenrich && Boolean(recipe.owner_approved_at);
      return true;
    }
    default:
      return false;
  }
}
