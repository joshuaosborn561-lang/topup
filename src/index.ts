import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cron from "node-cron";
import { GetleadsClient } from "./clients/getleads.js";
import { LeadPipeClient } from "./clients/leadpipe.js";
import { SmartleadClient } from "./clients/smartlead.js";
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
import { FlipStage } from "./stages/flip/index.js";
import { FindEmailsStage } from "./stages/find_emails/index.js";
import { TriggerStage } from "./stages/trigger/index.js";
import { ImportStage } from "./stages/import/index.js";
import { IngestStage } from "./stages/ingest/index.js";
import { NormalizeStage } from "./stages/normalize/index.js";
import { PostImportStage } from "./stages/post_import/index.js";
import { GetleadsPull } from "./stages/pull/getleads.js";
import { PullStage } from "./stages/pull/index.js";
import { QaStage } from "./stages/qa/index.js";
import { RouteStage } from "./stages/route/index.js";
import { SizeStage } from "./stages/size/index.js";
import { StageStage } from "./stages/stage/index.js";
import { SuppressStage } from "./stages/suppress/index.js";
import { VerifyStage } from "./stages/verify/verify.js";
import { RunwayWatch } from "./watch/index.js";

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

  const leadpipe = new LeadPipeClient(cfg.LEADPIPE_MCP_URL, cfg.LEADPIPE_TOKEN);
  const getleads = new GetleadsClient(cfg.GETLEADS_MCP_URL, cfg.GETLEADS_TOKEN);
  const smartlead = new SmartleadClient(cfg.SMARTLEAD_MCP_URL, cfg.SMARTLEAD_TOKEN);
  const jobs = { pollMs: cfg.JOB_POLL_SECONDS * 1000, deadMs: cfg.JOB_DEAD_MINUTES * 60_000 };
  const verify = new VerifyStage({
    repo,
    rails,
    console: console_,
    leadpipe,
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
  const base = { repo, console: console_ };
  const pull = new PullStage({ ...base, rails, adapters: [new GetleadsPull(getleads)], cfg: jobs });
  const orchestrator = new Orchestrator({
    repo,
    console: console_,
    ledger,
    retryDelayMs: cfg.STEP_RETRY_SECONDS * 1000,
    stages: {
      trigger: new TriggerStage(base),
      size: new SizeStage({ ...base, getleads, rails }),
      pull,
      ingest: new IngestStage({ ...base, leadpipe, pull, rails, cfg: jobs }),
      suppress: new SuppressStage({ ...base, ledger }),
      findEmails: new FindEmailsStage(base),
      verify,
      normalize,
      qa: new QaStage({ ...base, ledger }),
      route: new RouteStage({ ...base, ledger }),
      stage: new StageStage(base),
      import: new ImportStage({ ...base, smartlead, rails, cfg: jobs }),
      postImport: new PostImportStage({ ...base, smartlead, rails }),
      flip: new FlipStage(base),
    },
  });

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

  const watch = new RunwayWatch({
    db,
    repo,
    orchestrator,
    console: console_,
    recipes: recipeFiles,
    dryRun: cfg.DRY_RUN,
    ledger,
  });
  // Look once on boot so a deploy does not wait for the next cron hour.
  try {
    await watch.tick();
  } catch (err) {
    log.error("watch tick on boot failed", { error: (err as Error).message });
  }
  cron.schedule(cfg.WATCH_CRON, async () => {
    try {
      const gone = await repo!.expireCards();
      if (gone.length) log.info("expired cards", { count: gone.length });
      await orchestrator.resumeOpenRuns();
      await watch.tick();
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
