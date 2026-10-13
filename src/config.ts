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

  /** LeadPipe: every row moves through it (ingest, export to the verifier). */
  LEADPIPE_MCP_URL: z.string().default(""),
  LEADPIPE_TOKEN: z.string().default(""),
  /** Email Verifier Progression (MillionVerifier then No2Bounce). */
  VERIFIER_BASE_URL: z.string().default(""),
  /** Smartlead server on Railway (import, post-import). Only the D6 allow list is ever called. */
  SMARTLEAD_MCP_URL: z.string().default(""),
  SMARTLEAD_TOKEN: z.string().default(""),
  /**
   * Addresses of the other custom MCPs, only so `connectors` can tell Grokbot
   * where to attach them. This service calls none of them (D99).
   */
  MAPS_MCP_URL: z.string().default(""),
  PERMITSTACK_MCP_URL: z.string().default(""),
  DOMAIN_WATERFALL_MCP_URL: z.string().default(""),
  PEOPLE_WATERFALL_MCP_URL: z.string().default(""),
  EMAIL_WATERFALL_MCP_URL: z.string().default(""),

  /** The ICP website gate's edge functions on campaignintelligence (D60). Keys are the functions' own access keys; empty parks the icp step. */
  SUPABASE_FUNCTIONS_URL: z.string().default("https://azpapwtnrbzywlnxxecz.supabase.co/functions/v1"),
  ICP_SITE_FETCH_KEY: z.string().default(""),
  ICP_LLM_KEY: z.string().default(""),
  ICP_DISCO_KEY: z.string().default(""),
  ICP_JEV_MODEL: z.string().default("typesafe/jev-1.13"),

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
    smartlead: Boolean(cfg.SMARTLEAD_MCP_URL),
    icp_gate: Boolean(cfg.ICP_SITE_FETCH_KEY && cfg.ICP_LLM_KEY),
    transcripts: Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_SERVICE_ROLE_KEY),
  };
}
