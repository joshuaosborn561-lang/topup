import { z } from "zod";
import { DAILY_VENDOR_CAP_USD, OPERATOR_SPEND_CAP_USD } from "./policy/rules.js";

/**
 * All configuration comes from the environment. Railway holds the secrets;
 * nothing in this repo carries a real value. `loadConfig({})` yields the
 * shipped defaults, which is what the guards in src/guards assert against.
 */

/** The only Supabase project this service may write to (D6). */
export const ALLOWED_SUPABASE_PROJECT_REF = "azpapwtnrbzywlnxxecz";

const numberWithDefault = (d: number) =>
  z
    .string()
    .optional()
    .transform((s) => (s === undefined || s === "" ? d : Number(s)))
    .pipe(z.number().finite());

const schema = z.object({
  PORT: numberWithDefault(3000),
  NODE_ENV: z.string().default("development"),

  SUPABASE_PROJECT_REF: z.string().default(ALLOWED_SUPABASE_PROJECT_REF),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  DATABASE_URL: z.string().default(""),

  /** D41: no login. The owner token elevates a caller to owner; operator is the default. */
  MCP_OWNER_TOKEN: z.string().default(""),
  MCP_OPERATOR_TOKEN: z.string().default(""),

  LEADPIPE_MCP_URL: z.string().default(""),
  LEADPIPE_TOKEN: z.string().default(""),
  VERIFIER_BASE_URL: z.string().default(""),
  WIZARD_HEALTH_URL: z.string().default(""),
  /** getleads hosted MCP. The token is whatever getleads issues for a service; see docs/servers.md §11. */
  GETLEADS_MCP_URL: z.string().default(""),
  GETLEADS_TOKEN: z.string().default(""),
  /** AI Ark People Preview. Empty means count(source="ai_ark") says so instead of counting. */
  AI_ARK_TOKEN: z.string().default(""),
  AI_ARK_PREVIEW_URL: z.string().default("https://api.ai-ark.com/api/developer-portal/v1/people/preview"),
  /** Smartlead server on Railway (import, post-import). It has no inbound auth today; the token slot is for when it does. */
  SMARTLEAD_MCP_URL: z.string().default(""),
  SMARTLEAD_TOKEN: z.string().default(""),
  /** Maps counter. `pipeline_stats` only. Unset uses the public MCP. An empty string leaves the counter off. */
  MAPS_MCP_URL: z.string().default("https://google-maps-mcp-production-88a3.up.railway.app/mcp"),
  /** Permit counter. `metrics_monthly` only. Unset uses the public MCP. An empty string leaves the counter off. */
  PERMITSTACK_MCP_URL: z.string().default("https://permitstack-mcp-production.up.railway.app/mcp"),
  /** Puzzle + email enrichment. Empty = park when a row needs that piece. */
  DOMAIN_WATERFALL_MCP_URL: z.string().default(""),
  DOMAIN_WATERFALL_TOKEN: z.string().default(""),
  PEOPLE_WATERFALL_MCP_URL: z.string().default(""),
  PEOPLE_WATERFALL_TOKEN: z.string().default(""),
  EMAIL_WATERFALL_MCP_URL: z.string().default(""),
  EMAIL_WATERFALL_TOKEN: z.string().default(""),
  NAME_TO_EMAIL_MCP_URL: z.string().default(""),
  NAME_TO_EMAIL_TOKEN: z.string().default(""),

  /** The ICP gate's edge functions on campaignintelligence (D60). Keys are the functions' own access keys; empty leaves the icp verb parked. */
  SUPABASE_FUNCTIONS_URL: z.string().default("https://azpapwtnrbzywlnxxecz.supabase.co/functions/v1"),
  ICP_SITE_FETCH_KEY: z.string().default(""),
  ICP_LLM_KEY: z.string().default(""),
  ICP_DISCO_KEY: z.string().default(""),
  ICP_JEV_MODEL: z.string().default("typesafe/jev-1.13"),
  SITE_PEOPLE_KEY: z.string().default(""),
  SITE_PEOPLE_GEMINI_MODEL: z.string().default("gemini-3.1-flash-lite"),
  SITE_PEOPLE_FETCH_PARALLEL: numberWithDefault(2),
  SITE_PEOPLE_FETCH_WORKERS: numberWithDefault(25),
  SITE_PEOPLE_FETCH_PER_CALL: numberWithDefault(50),
  SITE_PEOPLE_FETCH_PER_HOST: numberWithDefault(2),
  SITE_PEOPLE_EXTRACT_PARALLEL: numberWithDefault(4),
  SITE_PEOPLE_EXTRACT_WORKERS: numberWithDefault(7),
  SITE_PEOPLE_EXTRACT_PER_CALL: numberWithDefault(28),
  SITE_PEOPLE_ASK_PARALLEL: numberWithDefault(4),
  SITE_PEOPLE_ASK_WORKERS: numberWithDefault(7),
  SITE_PEOPLE_ASK_PER_CALL: numberWithDefault(28),
  SITE_PEOPLE_GEMINI_RPM: numberWithDefault(200),

  /** Poll cadence and patience for the vendor jobs. */
  JOB_POLL_SECONDS: numberWithDefault(30),
  JOB_DEAD_MINUTES: numberWithDefault(90),

  /** D51: zero. Every paid call waits for a named approval. The daily cap is a backstop. */
  AUTO_SPEND_CAP_USD: numberWithDefault(OPERATOR_SPEND_CAP_USD),
  DAILY_VENDOR_CAP_USD: numberWithDefault(DAILY_VENDOR_CAP_USD),
  SPEND_CARD_TIMEOUT_MINUTES: numberWithDefault(24 * 60),

  VERIFY_POLL_SECONDS: numberWithDefault(60),
  VERIFY_STALL_PERCENT: numberWithDefault(90),
  VERIFY_STALL_MINUTES: numberWithDefault(12),
  VERIFY_MIN_SPLIT_ROWS: numberWithDefault(50),
  VERIFY_DEAD_MINUTES: numberWithDefault(6 * 60),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${issues.join("\n  ")}`);
  }
  return parsed.data;
}

/**
 * Boot-time refusal. The service will not start against a Supabase project
 * other than campaignintelligence; three projects exist and mixing them has
 * cost real hours (brief section 8).
 */
export function assertSupabaseProject(cfg: Config): void {
  if (cfg.SUPABASE_PROJECT_REF !== ALLOWED_SUPABASE_PROJECT_REF) {
    throw new Error(
      `SUPABASE_PROJECT_REF is ${cfg.SUPABASE_PROJECT_REF}; this service only writes to ` +
        `${ALLOWED_SUPABASE_PROJECT_REF} (campaignintelligence). Refusing to boot.`,
    );
  }
  if (cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes(ALLOWED_SUPABASE_PROJECT_REF)) {
    throw new Error(`SUPABASE_URL does not point at ${ALLOWED_SUPABASE_PROJECT_REF}. Refusing to boot.`);
  }
}

/** Which integrations are configured. Missing ones are reported on /health, never guessed. */
export function configReadiness(cfg: Config): Record<string, boolean> {
  return {
    supabase: Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_SERVICE_ROLE_KEY),
    database_url: Boolean(cfg.DATABASE_URL),
    mcp: true,
    owner_token: Boolean(cfg.MCP_OWNER_TOKEN),
    leadpipe: Boolean(cfg.LEADPIPE_MCP_URL),
    verifier: Boolean(cfg.VERIFIER_BASE_URL),
    wizard: Boolean(cfg.WIZARD_HEALTH_URL),
    getleads: Boolean(cfg.GETLEADS_MCP_URL),
    ai_ark: Boolean(cfg.AI_ARK_TOKEN),
    smartlead: Boolean(cfg.SMARTLEAD_MCP_URL),
    maps: Boolean(cfg.MAPS_MCP_URL),
    permits: Boolean(cfg.PERMITSTACK_MCP_URL),
    domain_waterfall: Boolean(cfg.DOMAIN_WATERFALL_MCP_URL),
    people_waterfall: Boolean(cfg.PEOPLE_WATERFALL_MCP_URL),
    email_waterfall: Boolean(cfg.EMAIL_WATERFALL_MCP_URL),
    name_to_email: Boolean(cfg.NAME_TO_EMAIL_MCP_URL),
    icp_gate: Boolean(cfg.ICP_SITE_FETCH_KEY && cfg.ICP_LLM_KEY),
    site_people: Boolean(cfg.SITE_PEOPLE_KEY),
  };
}
