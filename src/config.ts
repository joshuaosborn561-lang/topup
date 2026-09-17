import { z } from "zod";

/**
 * All configuration comes from the environment. Railway holds the secrets;
 * nothing in this repo carries a real value. `loadConfig({})` yields the
 * shipped defaults, which is what the guards in src/guards assert against.
 */

/** The only Supabase project this service may write to (D6). */
export const ALLOWED_SUPABASE_PROJECT_REF = "azpapwtnrbzywlnxxecz";

const csvIds = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );

const jsonMap = z
  .string()
  .default("{}")
  .transform((s, ctx) => {
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        return v as Record<string, string>;
      }
    } catch {
      /* fall through */
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "expected a JSON object" });
    return z.NEVER;
  });

const numberWithDefault = (d: number) =>
  z
    .string()
    .optional()
    .transform((s) => (s === undefined || s === "" ? d : Number(s)))
    .pipe(z.number().finite());

const bool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((s) => (s === undefined || s === "" ? d : /^(1|true|yes)$/i.test(s)));

const schema = z.object({
  PORT: numberWithDefault(3000),
  NODE_ENV: z.string().default("development"),

  SUPABASE_PROJECT_REF: z.string().default(ALLOWED_SUPABASE_PROJECT_REF),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  DATABASE_URL: z.string().default(""),

  SLACK_BOT_TOKEN: z.string().default(""),
  SLACK_SIGNING_SECRET: z.string().default(""),
  SLACK_OPS_CHANNEL: z.string().default("C0C135EB76H"),
  SLACK_CLIENT_CHANNELS: jsonMap,
  SLACK_OWNER_USER_IDS: csvIds,
  SLACK_OPERATOR_USER_IDS: csvIds,

  MCP_OWNER_TOKEN: z.string().default(""),
  MCP_OPERATOR_TOKEN: z.string().default(""),

  LEADPIPE_MCP_URL: z.string().default(""),
  LEADPIPE_TOKEN: z.string().default(""),
  VERIFIER_BASE_URL: z.string().default(""),
  WIZARD_HEALTH_URL: z.string().default(""),
  /** getleads hosted MCP (steps 2 and 3). The token is whatever getleads issues for a service; see docs/servers.md §11. */
  GETLEADS_MCP_URL: z.string().default(""),
  GETLEADS_TOKEN: z.string().default(""),
  /** Smartlead server on Railway (steps 11 and 12). It has no inbound auth today; the token slot is for when it does. */
  SMARTLEAD_MCP_URL: z.string().default(""),
  SMARTLEAD_TOKEN: z.string().default(""),
  /** Puzzle + email enrichment (skills domain-waterfall, people-waterfall, unresolved-name-routing). Empty = park when a row needs that piece. */
  DOMAIN_WATERFALL_MCP_URL: z.string().default(""),
  DOMAIN_WATERFALL_TOKEN: z.string().default(""),
  PEOPLE_WATERFALL_MCP_URL: z.string().default(""),
  PEOPLE_WATERFALL_TOKEN: z.string().default(""),
  EMAIL_WATERFALL_MCP_URL: z.string().default(""),
  EMAIL_WATERFALL_TOKEN: z.string().default(""),
  NAME_TO_EMAIL_MCP_URL: z.string().default(""),
  NAME_TO_EMAIL_TOKEN: z.string().default(""),
  /** Paid leftover company-size backfill only (D38). Empty = skip the $5 pass. */
  LEADMAGIC_API_KEY: z.string().default(""),
  /** D39 reasoner. Empty = inventory / hold only; no LLM on the critical path. */
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),

  /** Poll cadence and patience for the vendor jobs in steps 3, 4 and 11. */
  JOB_POLL_SECONDS: numberWithDefault(30),
  JOB_DEAD_MINUTES: numberWithDefault(90),

  AUTO_SPEND_CAP_USD: numberWithDefault(5),
  DAILY_VENDOR_CAP_USD: numberWithDefault(25),
  SPEND_CARD_TIMEOUT_MINUTES: numberWithDefault(24 * 60),

  VERIFY_POLL_SECONDS: numberWithDefault(60),
  VERIFY_STALL_PERCENT: numberWithDefault(90),
  VERIFY_STALL_MINUTES: numberWithDefault(12),
  VERIFY_MIN_SPLIT_ROWS: numberWithDefault(50),
  VERIFY_DEAD_MINUTES: numberWithDefault(6 * 60),

  STEP_RETRY_SECONDS: numberWithDefault(30),
  WATCH_CRON: z.string().default("0 */6 * * *"),
  /** Daily digest in the ops channel; 13:00 UTC is 8am Central. Only lanes that changed are named. */
  DIGEST_CRON: z.string().default("0 13 * * *"),
  DRY_RUN: bool(false),
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
    throw new Error(
      `SUPABASE_URL does not point at ${ALLOWED_SUPABASE_PROJECT_REF}. Refusing to boot.`,
    );
  }
}

/** Which integrations are configured. Missing ones are reported on /health, never guessed. */
export function configReadiness(cfg: Config): Record<string, boolean> {
  return {
    supabase: Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_SERVICE_ROLE_KEY),
    database_url: Boolean(cfg.DATABASE_URL),
    slack: Boolean(cfg.SLACK_BOT_TOKEN && cfg.SLACK_SIGNING_SECRET),
    slack_roles: cfg.SLACK_OWNER_USER_IDS.length > 0,
    mcp: Boolean(cfg.MCP_OWNER_TOKEN && cfg.MCP_OPERATOR_TOKEN),
    leadpipe: Boolean(cfg.LEADPIPE_MCP_URL),
    verifier: Boolean(cfg.VERIFIER_BASE_URL),
    wizard: Boolean(cfg.WIZARD_HEALTH_URL),
    getleads: Boolean(cfg.GETLEADS_MCP_URL),
    smartlead: Boolean(cfg.SMARTLEAD_MCP_URL),
    domain_waterfall: Boolean(cfg.DOMAIN_WATERFALL_MCP_URL),
    people_waterfall: Boolean(cfg.PEOPLE_WATERFALL_MCP_URL),
    email_waterfall: Boolean(cfg.EMAIL_WATERFALL_MCP_URL),
    name_to_email: Boolean(cfg.NAME_TO_EMAIL_MCP_URL),
    leadmagic: Boolean(cfg.LEADMAGIC_API_KEY),
    anthropic: Boolean(cfg.ANTHROPIC_API_KEY),
  };
}
