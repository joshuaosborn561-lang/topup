import { getleadsParamsFromFilters } from "./filters.js";
import { icpViewOf, mapsPoolFromFilters } from "../canon/mapsPool.js";
import { MAX_ROWS_PER_JOB } from "../policy/rules.js";
import { liveEmailMaxTier, mapEmailMaxTier } from "../recipes/legacyLeadmagic.js";
import { EMAIL_TIERS, parseRecipe, type Recipe } from "../recipes/schema.js";

/**
 * A job recipe (D52): the one-campaign spec the stages run, built from what
 * Grok read on the record and chose. Nothing here is inferred from a lane,
 * a client name or an old receipt; the source and the filters are Grok's
 * inputs, the rest are the service defaults every list gets (suppression,
 * verify split, normalize, required fields).
 */
export type JobSource = "getleads" | "maps" | "permits" | "table";

export interface JobSpec {
  client_tag: string;
  smartlead_client_id: number;
  lane: string;
  campaign_id: number;
  source: JobSource;
  /** The vendor filters as the receipt stored them (job_titles, company_size, industries, countries, categories, permit_types, states, schema/table/where). */
  filters: Record<string, unknown>;
  max_rows: number;
  icp_kind?: "linkedin_native" | "physical";
  persona?: string;
  /** Live ceiling, or a legacy `leadmagic` / `lm` / `lead_magic` alias (D58 maps to aiark). */
  email_max_tier?: string;
  name_to_email?: boolean;
}

export const JOB_SOURCES: readonly JobSource[] = ["getleads", "maps", "permits", "table"];

function strings(v: unknown): string[] {
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
}

function sourceFor(spec: JobSpec): Recipe["source"] {
  const f = spec.filters;
  switch (spec.source) {
    case "getleads": {
      const parsed = getleadsParamsFromFilters(f);
      if (!parsed.ok) throw new Error(parsed.error);
      return { kind: "getleads", params: parsed.params, widening_candidates: [] } as Recipe["source"];
    }
    case "maps": {
      const pool = mapsPoolFromFilters(f, spec.client_tag);
      if ("error" in pool) throw new Error(pool.error);
      const categories = pool.categories;
      if (categories.length === 0) throw new Error("maps needs categories. Read them off the record's company_filters (maps, categories).");
      const icp_view = pool.icp_view ?? icpViewOf(f, spec.client_tag);
      return {
        kind: "maps",
        params: {
          categories,
          plan_id: pool.plan_id,
          ...(icp_view ? { icp_view } : {}),
        },
      } as Recipe["source"];
    }
    case "permits": {
      const permit_types = strings(f.permit_types ?? f.permits ?? f.permit_type);
      if (permit_types.length === 0) throw new Error("permits needs permit_types. Read them off the record's company_filters (permits, permit_types).");
      return { kind: "permits", params: { permit_types, ...(strings(f.states).length ? { states: strings(f.states) } : {}), ...(strings(f.counties).length ? { counties: strings(f.counties) } : {}) } } as Recipe["source"];
    }
    case "table": {
      const table = typeof f.table === "string" ? f.table : typeof f.schema === "string" && typeof f.name === "string" ? `${f.schema}.${f.name}` : null;
      const where = typeof f.where === "string" && f.where.trim() ? f.where.trim() : "true";
      if (!table) throw new Error("table needs table as schema.table (and an optional where).");
      return { kind: "supabase_table", table, where } as Recipe["source"];
    }
  }
}

/** The lane the job recipe row is filed under: its own name, so no lane lookup ever returns a job recipe as a lane's recipe. */
export function jobLane(spec: Pick<JobSpec, "campaign_id">, stamp: number): string {
  return `job_${spec.campaign_id}_${stamp}`;
}

export function jobRecipeId(spec: Pick<JobSpec, "client_tag" | "campaign_id">, stamp: number): string {
  return `${spec.client_tag}.${jobLane(spec, stamp)}.v1`;
}

export function jobRecipe(spec: JobSpec, stamp = Date.now()): Recipe {
  if (!Number.isInteger(spec.max_rows) || spec.max_rows < 1 || spec.max_rows > MAX_ROWS_PER_JOB) throw new Error(`max_rows must be a whole number from 1 to ${MAX_ROWS_PER_JOB} (D53)`);
  if (spec.email_max_tier) {
    const mapped = mapEmailMaxTier(spec.email_max_tier);
    if (!mapped.tier) {
      throw new Error(
        `unknown email_max_tier '${spec.email_max_tier}'. Live: ${EMAIL_TIERS.join(", ")}. leadmagic / lm / lead_magic is a legacy alias for aiark (D58). Ask Josh.`,
      );
    }
  }
  const icp = { kind: spec.icp_kind ?? (spec.source === "getleads" ? "linkedin_native" : "physical"), persona: spec.persona ?? spec.lane };
  const raw: unknown = {
    recipe_id: jobRecipeId(spec, stamp),
    client_tag: spec.client_tag,
    lane: spec.lane,
    smartlead_client_id: spec.smartlead_client_id,
    supabase_project: "azpapwtnrbzywlnxxecz",
    owner_approved_at: new Date(stamp).toISOString(),
    source: sourceFor(spec),
    suppression: {
      response_based: true,
      client_prior_contacts: true,
      bounced_any_client: true,
      public_suppression: true,
      client_domain_blocklist: true,
      same_offer_any_client: true,
      same_gift_any_client: false,
    },
    email_finding: { enabled: true, max_tier: liveEmailMaxTier(spec.email_max_tier), fullenrich: false, name_to_email: spec.name_to_email ?? false },
    verify: { seg_split: true, reject_rate_norm: null },
    normalize: { names_cities: true, company: true, location: true, sports_team: { league: "both", pro_only: false } },
    qa: [],
    segments: { slot: [String(spec.campaign_id)] },
    routing: [{ when: { slot: String(spec.campaign_id) }, campaign_id: spec.campaign_id, icp }],
    required_fields: ["first_name_n", "company_n", "location", "local_sports_team", "job_title"],
    runway: { floor_days: 7, target_days: 30, max_per_run: spec.max_rows },
    working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
    spend: { auto_cap_usd: 0 },
    owner_approvals: ["icp_change", "new_campaign", "spend_over_cap", "copy"],
  };
  return parseRecipe(raw);
}
