import { z } from "zod";
import { BANNED_ACTIONS, BANNED_VENDORS } from "../spend/prices.js";

/**
 * Lane recipe (design 3.1). The service can only execute what a recipe says.
 * Validation carries the getleads guards from brief section 9 so a bad recipe
 * fails the suite instead of shredding a pull:
 *
 *   - company_size is exact band labels ("51 to 200"), never numeric bounds
 *   - industry names may not contain commas (they silently shred to nothing)
 *   - email_status is optional: omit it to pull every status (D35 item 15)
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

/** getleads email_status values. Omit the field to pull every status (D35 item 15). */
export const GETLEADS_EMAIL_STATUSES = ["VALID", "CATCH_ALL", "UNKNOWN", "INVALID"] as const;

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
    email_status: z.array(z.enum(GETLEADS_EMAIL_STATUSES)).min(1).optional(),
    max_per_company: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((p) => !("employee_count_min" in p) && !("employee_count_max" in p), {
    message: "headcount must be band labels, never numeric bounds",
  })
  .refine((p) => !p.employee_profiles_on_linkedin, {
    message: "cannot send company_size band labels and employee_profiles_on_linkedin together (silent band overlap)",
  });

const wideningCandidate = z
  .object({
    company_size: z.array(bandLabel).optional(),
    add_titles: z.array(z.string()).optional(),
    states: z.array(z.string()).optional(),
    industries: z.array(noComma).optional(),
  })
  .strict();

const mapsParams = z
  .object({
    categories: z.array(z.string().min(1)).min(1),
    states: z.array(z.string()).optional(),
    cities: z.array(z.string()).optional(),
  })
  .strict();

const permitsParams = z
  .object({
    permit_types: z.array(z.string().min(1)).min(1),
    states: z.array(z.string()).optional(),
    counties: z.array(z.string()).optional(),
  })
  .strict();

const aiArkParams = z
  .object({
    titles: z.array(z.string().min(1)).min(1),
    employee_size: z.object({ start: z.number().int().min(1), end: z.number().int().min(1) }).optional(),
    locations: z.array(z.string()).optional(),
  })
  .strict();

const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("getleads"), params: getleadsParams, widening_candidates: z.array(wideningCandidate).default([]) }),
  z.object({ kind: z.literal("ai_ark"), params: aiArkParams }),
  z.object({ kind: z.literal("maps"), params: mapsParams }),
  z.object({ kind: z.literal("permits"), params: permitsParams }),
  z.object({
    kind: z.literal("mixed"),
    note: z.string().min(1),
  }),
  z.object({
    kind: z.literal("supabase_table"),
    project_ref: z.string().optional(),
    table: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/, "schema.table"),
    where: z.string().min(1),
  }),
]);

/**
 * Campaign ICP (D30). Kind picks the size/pull stack; persona is the buyer
 * (it_dm, owner, gc_partner). Both live on the routing rule — a lane can
 * feed campaigns with different ICPs. The recipe source is only the default
 * template a campaign inherits when it does not name its own.
 */
export const ICP_KINDS = ["linkedin_native", "physical"] as const;
const campaignIcp = z
  .object({
    kind: z.enum(ICP_KINDS),
    persona: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case persona (it_dm, owner, gc_partner)"),
  })
  .strict();

const suppression = z
  .object({
    response_based: z.literal(true),
    client_prior_contacts: z.boolean().default(true),
    bounced_any_client: z.boolean().default(true),
    public_suppression: z.boolean().default(true),
    client_domain_blocklist: z.boolean().default(true),
    same_offer_any_client: z.literal(true),
    same_gift_any_client: z.boolean().default(false),
    /** Days since last send by this client. Default 90 (D35 item 2). */
    recycle_after_days: z.number().int().min(1).nullable().optional().default(90),
    /**
     * Pending item 2 addition. When true, also exclude anyone already in
     * another live campaign of this client. Default false until Josh taps.
     */
    exclude_other_live_campaigns: z.boolean().default(false),
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
    message: "PDL, BillionVerifier, Clay and Hunter are out of the stack",
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
    icp: campaignIcp,
    /** Optional override; omitted means inherit the recipe source, sliced to this campaign's band. */
    source: source.optional(),
  })
  .strict();

/**
 * Step 2 (skill lead-list-build): "projected net new is above the useful
 * floor (default 200)". The default is the skill's number; a recipe may set
 * its own. The partition tolerance is how far count(bands) + count(other
 * bands) may sit from count(no band filter) before the filters are judged
 * not to bind (tam-sizing: "prove the filters bind"); 1% is this service's
 * number, named in D26.
 */
const size = z
  .object({
    useful_floor: z.number().int().min(1).default(200),
    partition_tolerance: z.number().min(0).max(0.2).default(0.01),
  })
  .strict()
  .default({ useful_floor: 200, partition_tolerance: 0.01 });

/** Step 12 settings the pre launch check reads from get_campaign. Findings only; the merge tag check is the gate. */
export const CAMPAIGN_SETTING_CHECKS = ["send_as_plain_text", "tracking_off", "stop_on_reply", "bounce_autopause_off", "schedule_mon_thu"] as const;

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
    size,
    qa: z.array(z.string()).default([]),
    /** Step 8 reroute rules name a target (`eos`); this maps that target to a campaign of this client. No entry = the hold card offers no reroute. */
    reroute: z.record(z.number().int().positive()).default({}),
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
export type Source = Recipe["source"];
export type RoutingRule = Recipe["routing"][number];
export type CampaignIcp = RoutingRule["icp"];
export type GetleadsSource = Extract<Source, { kind: "getleads" }>;

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
    case "size":
    case "pull": {
      if (!vendor) return true;
      const kinds = new Set<string>();
      const add = (src: Source | undefined) => {
        if (!src) return;
        if (src.kind === "getleads") kinds.add("getleads");
        if (src.kind === "ai_ark") kinds.add("aiark");
        if (src.kind === "maps" || src.kind === "permits") kinds.add("apify");
      };
      add(recipe.source);
      for (const rule of recipe.routing) add(rule.source);
      return kinds.has(vendor);
    }
    case "puzzle":
      return vendor === undefined || vendor === "aiark" || vendor === "apify" || vendor === "getleads" || vendor === "leadmagic" || vendor === "prospeo";
    case "find_emails": {
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
