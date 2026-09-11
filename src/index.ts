import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cron from "node-cron";
import { LeadPipeClient } from "./clients/leadpipe.js";
import { VerifierClient } from "./clients/verifier.js";
import { buildCommands } from "./commands.js";
import { assertSupabaseProject, loadConfig } from "./config.js";
import { Db } from "./db/pool.js";
import { Repo } from "./db/repo.js";
import { buildHealth } from "./health.js";
import { runDigest } from "./ledger/digest.js";
import { LaneLedger } from "./ledger/lane.js";
import { logger } from "./lib/log.js";
import { mcpRouter } from "./mcp/server.js";
import { Orchestrator } from "./orchestrator.js";
import { loadRecipeFiles, syncRecipes } from "./recipes/load.js";
import { SlackPoster } from "./slack/client.js";
import { SlackConsole } from "./slack/console.js";
import { slackRouter } from "./slack/http.js";
import { Roles } from "./slack/roles.js";
import { readersFromEnv } from "./spend/balances.js";
import { railsConfigFrom, SpendRails } from "./spend/rails.js";
import { NormalizeStage } from "./stages/normalize/index.js";
import { VerifyStage } from "./stages/verify/verify.js";

const log = logger("boot");

async function main(): Promise<void> {
  const cfg = loadConfig();
  assertSupabaseProject(cfg);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const recipesRoot = path.resolve(here, "..", "recipes");
  // Recipes are validated before anything else; a bad recipe fails the deploy.
  const recipeFiles = await loadRecipeFiles(recipesRoot);
  log.info("recipes validated", { ids: recipeFiles.map((r) => r.recipe_id) });

  const app = express();
  app.disable("x-powered-by");

  let repo: Repo | null = null;
  let rails: SpendRails | null = null;

  // /health is mounted first and answers even while the rest is still coming up.
  app.get("/health", async (_req, res) => {
    try {
      res.json(await buildHealth({ cfg, repo, rails, recipes: recipeFiles.map((r) => r.recipe_id) }));
    } catch (err) {
      res.status(200).json({ ok: false, service: "leadtopup", error: (err as Error).message });
    }
  });
  app.get("/", (_req, res) => {
    res.type("text/plain").send("leadtopup: see /health");
  });

  const server = app.listen(cfg.PORT, () => log.info("listening", { port: cfg.PORT }));

  if (!cfg.DATABASE_URL) {
    log.warn("DATABASE_URL is not set; running with /health only");
    return;
  }

  const db = new Db(cfg.DATABASE_URL);
  repo = new Repo(db);
  rails = new SpendRails(repo, railsConfigFrom(cfg));
  for (const r of readersFromEnv(process.env)) rails.registerBalanceReader(r);

  const locks = await repo.installLeadLocks();
  const synced = await syncRecipes(repo, recipesRoot);
  log.info("database ready", { lead_tables_locked: locks, recipes_synced: synced });

  const roles = new Roles(cfg.SLACK_OWNER_USER_IDS, cfg.SLACK_OPERATOR_USER_IDS);
  const poster = new SlackPoster(cfg.SLACK_BOT_TOKEN);
  const console_ = new SlackConsole(repo, poster, roles, { opsChannel: cfg.SLACK_OPS_CHANNEL, clientChannels: cfg.SLACK_CLIENT_CHANNELS });

  const verify = new VerifyStage({
    repo,
    rails,
    console: console_,
    leadpipe: new LeadPipeClient(cfg.LEADPIPE_MCP_URL, cfg.LEADPIPE_TOKEN),
    verifier: new VerifierClient(cfg.VERIFIER_BASE_URL),
    cfg: {
      pollMs: cfg.VERIFY_POLL_SECONDS * 1000,
      cardTimeoutMs: cfg.SPEND_CARD_TIMEOUT_MINUTES * 60_000,
      runbook: {
        stallPercent: cfg.VERIFY_STALL_PERCENT,
        stallMinutes: cfg.VERIFY_STALL_MINUTES,
        minSplitRows: cfg.VERIFY_MIN_SPLIT_ROWS,
        deadMinutes: cfg.VERIFY_DEAD_MINUTES,
      },
    },
  });
  const normalize = new NormalizeStage(repo, console_);
  const ledger = new LaneLedger(db);
  console_.attachLedger(ledger);
  const orchestrator = new Orchestrator({ repo, console: console_, verify, normalize, ledger, retryDelayMs: cfg.STEP_RETRY_SECONDS * 1000 });

  if (cfg.SLACK_SIGNING_SECRET) {
    app.use(
      "/slack",
      slackRouter({
        signingSecret: cfg.SLACK_SIGNING_SECRET,
        roles,
        console: console_,
        commands: buildCommands({ repo, orchestrator, ledger }),
        onTap: orchestrator.onTap,
      }),
    );
  } else {
    log.warn("SLACK_SIGNING_SECRET is not set; /slack is not mounted");
  }

  if (cfg.MCP_OWNER_TOKEN && cfg.MCP_OPERATOR_TOKEN) {
    app.use("/mcp", mcpRouter({ repo, orchestrator, console: console_, ledger, ownerToken: cfg.MCP_OWNER_TOKEN, operatorToken: cfg.MCP_OPERATOR_TOKEN }));
  } else {
    log.warn("MCP tokens are not both set; /mcp is not mounted");
  }

  // Cards that nobody answered expire; the waiting stage sees that and parks.
  const expired = await repo.expireCards();
  if (expired.length) log.info("expired cards on boot", { count: expired.length });
  const resumed = await orchestrator.resumeOpenRuns();
  log.info("open runs re-entered", { count: resumed });

  // The runway watch that opens runs on its own lands with the pull stage.
  // Until then the tick only expires stale cards and re-enters open runs.
  cron.schedule(cfg.WATCH_CRON, async () => {
    try {
      const gone = await repo!.expireCards();
      if (gone.length) log.info("expired cards", { count: gone.length });
      await orchestrator.resumeOpenRuns();
    } catch (err) {
      log.error("watch tick failed", { error: (err as Error).message });
    }
  });

  // The daily digest names only lanes whose state changed or whose health crossed a line.
  cron.schedule(cfg.DIGEST_CRON, async () => {
    try {
      await runDigest({ ledger, console: console_ });
    } catch (err) {
      log.error("digest failed", { error: (err as Error).message });
    }
  });

  const shutdown = async (signal: string) => {
    log.info("shutting down", { signal });
    server.close();
    await db.end().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("boot failed", { error: (err as Error).message });
  process.exit(1);
});
