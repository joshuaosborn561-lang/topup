import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { AiArkPreviewClient } from "./clients/aiArkPreview.js";
import { DomainWaterfallClient } from "./clients/domainWaterfall.js";
import { EmailWaterfallClient } from "./clients/emailWaterfall.js";
import { GetleadsClient } from "./clients/getleads.js";
import { IcpGateClient } from "./clients/icpGate.js";
import { LeadPipeClient } from "./clients/leadpipe.js";
import { MapsStatsClient } from "./clients/mapsStats.js";
import { NameToEmailClient } from "./clients/nameToEmail.js";
import { PeopleWaterfallClient } from "./clients/peopleWaterfall.js";
import { PermitCountsClient } from "./clients/permits.js";
import { SmartleadClient } from "./clients/smartlead.js";
import { VerifierClient } from "./clients/verifier.js";
import { assertSupabaseProject, loadConfig } from "./config.js";
import { Console } from "./console/console.js";
import { loadClientTags } from "./canon/clients.js";
import { Db } from "./db/pool.js";
import { Repo } from "./db/repo.js";
import { buildHealth } from "./health.js";
import { JobRunner, type Stages } from "./jobs/runner.js";
import { isSelfStart } from "./jobs/selfStart.js";
import { LaneLedger } from "./ledger/lane.js";
import { logger } from "./lib/log.js";
import { mcpRouter } from "./mcp/server.js";
import { Orchestrator } from "./orchestrator.js";
import { loadGeoFenceCities } from "./recipes/geoFence.js";
import { readersFromEnv } from "./spend/balances.js";
import { railsConfigFrom, SpendRails } from "./spend/rails.js";
import { FindEmailsStage } from "./stages/find_emails/index.js";
import { IcpStage } from "./stages/icp/index.js";
import { ImportStage } from "./stages/import/index.js";
import { IngestStage } from "./stages/ingest/index.js";
import { NormalizeStage } from "./stages/normalize/index.js";
import { PostImportStage } from "./stages/post_import/index.js";
import { GetleadsPull } from "./stages/pull/getleads.js";
import { PullStage } from "./stages/pull/index.js";
import { MapsPull } from "./stages/pull/maps.js";
import { PermitsPull } from "./stages/pull/permits.js";
import { PuzzleStage } from "./stages/puzzle/index.js";
import { QaStage } from "./stages/qa/index.js";
import { RouteStage } from "./stages/route/index.js";
import { StageStage } from "./stages/stage/index.js";
import { SuppressStage } from "./stages/suppress/index.js";
import { VerifyStage } from "./stages/verify/verify.js";

const log = logger("boot");

/** The canon, served to Grok as the MCP instructions and by the `canon` read (D53). */
function readCanon(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const p of [path.resolve(here, "..", "CANON.md"), path.resolve(here, "..", "..", "CANON.md")]) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      /* next candidate */
    }
  }
  log.warn("CANON.md not found next to the build; the canon read answers with a pointer");
  return "CANON.md is not on this image. Read it in the repository joshuaosborn561-lang/topup.";
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  assertSupabaseProject(cfg);
  const canon = readCanon();

  const app = express();
  app.disable("x-powered-by");

  let repo: Repo | null = null;
  let rails: SpendRails | null = null;

  // /health is mounted first and answers even while the rest is still coming up.
  app.get("/health", async (_req, res) => {
    try {
      const body = await buildHealth({ cfg, repo, rails });
      const missing = Array.isArray((body as { missing_tables?: unknown }).missing_tables);
      res.status(missing ? 503 : 200).json(body);
    } catch (err) {
      res.status(200).json({ ok: false, service: "leadtopup", error: (err as Error).message });
    }
  });
  app.get("/", (_req, res) => {
    res.type("text/plain").send("leadtopup: see /health · MCP POST /mcp (HTTPS Streamable HTTP) · the canon is CANON.md");
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
  await repo.ensureCore08().catch((err) => log.error(`sized status ensure failed: ${(err as Error).message}`));
  await repo.ensureIcpKind().catch((err) => log.error(`icp kind ensure failed: ${(err as Error).message}`));
  log.info("database ready", { lead_tables_locked: locks });

  const console_ = new Console(repo);
  const ledger = new LaneLedger(db);
  console_.attachLedger(ledger);

  const leadpipe = new LeadPipeClient(cfg.LEADPIPE_MCP_URL, cfg.LEADPIPE_TOKEN);
  const getleads = new GetleadsClient(cfg.GETLEADS_MCP_URL, cfg.GETLEADS_TOKEN);
  const aiArk = cfg.AI_ARK_TOKEN ? new AiArkPreviewClient(cfg.AI_ARK_TOKEN, cfg.AI_ARK_PREVIEW_URL) : null;
  const maps = cfg.MAPS_MCP_URL ? new MapsStatsClient(cfg.MAPS_MCP_URL) : null;
  const permitCounts = cfg.PERMITSTACK_MCP_URL ? new PermitCountsClient(cfg.PERMITSTACK_MCP_URL) : null;
  const smartlead = new SmartleadClient(cfg.SMARTLEAD_MCP_URL, cfg.SMARTLEAD_TOKEN);
  const domain = cfg.DOMAIN_WATERFALL_MCP_URL ? new DomainWaterfallClient(cfg.DOMAIN_WATERFALL_MCP_URL, cfg.DOMAIN_WATERFALL_TOKEN) : null;
  const people = cfg.PEOPLE_WATERFALL_MCP_URL ? new PeopleWaterfallClient(cfg.PEOPLE_WATERFALL_MCP_URL, cfg.PEOPLE_WATERFALL_TOKEN) : null;
  const emailWaterfall = cfg.EMAIL_WATERFALL_MCP_URL ? new EmailWaterfallClient(cfg.EMAIL_WATERFALL_MCP_URL, cfg.EMAIL_WATERFALL_TOKEN) : null;
  const nameToEmail = cfg.NAME_TO_EMAIL_MCP_URL ? new NameToEmailClient(cfg.NAME_TO_EMAIL_MCP_URL, cfg.NAME_TO_EMAIL_TOKEN) : null;
  const jobs = { pollMs: cfg.JOB_POLL_SECONDS * 1000, deadMs: cfg.JOB_DEAD_MINUTES * 60_000 };
  const icpGate = cfg.ICP_SITE_FETCH_KEY && cfg.ICP_LLM_KEY ? new IcpGateClient(cfg.SUPABASE_FUNCTIONS_URL, { fetch: cfg.ICP_SITE_FETCH_KEY, llm: cfg.ICP_LLM_KEY, disco: cfg.ICP_DISCO_KEY }) : null;
  const base = { repo, console: console_ };

  const pull = new PullStage({
    ...base,
    rails,
    adapters: [new GetleadsPull(getleads, (ref) => loadGeoFenceCities(db, ref)), new MapsPull(db), new PermitsPull(permitCounts)],
    maps,
    permits: permitCounts,
    cfg: jobs,
  });
  const stages: Stages = {
    pull,
    ingest: new IngestStage({ ...base, leadpipe, pull, rails, cfg: jobs }),
    suppress: new SuppressStage({ ...base, ledger }),
    icp: new IcpStage({ ...base, rails, gate: icpGate, cfg: { jevModel: cfg.ICP_JEV_MODEL, pollMs: 20_000, deadMs: jobs.deadMs } }),
    puzzle: new PuzzleStage({ ...base, ledger, rails, domain, people, cfg: jobs }),
    findEmails: new FindEmailsStage({ ...base, rails, nameToEmail, emailWaterfall, cfg: jobs }),
    verify: new VerifyStage({
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
    }),
    normalize: new NormalizeStage(repo, console_),
    qa: new QaStage({ ...base, ledger }),
    route: new RouteStage({ ...base, ledger }),
    stage: new StageStage(base),
    import: new ImportStage({ ...base, smartlead, rails, cfg: jobs }),
    postImport: new PostImportStage({ ...base, smartlead, rails }),
  };
  const orchestrator = new Orchestrator({ repo, console: console_, ledger, stages });

  const clientTags = await loadClientTags(db).catch((err) => {
    log.warn("client_map tags unavailable at boot", { error: (err as Error).message });
    return [] as string[];
  });
  log.info("client_map tags", { count: clientTags.length });
  await repo.repairCampaignRegistry().catch((err) => log.warn("registry repair at boot failed", { error: (err as Error).message }));

  app.use(
    "/mcp",
    mcpRouter({
      repo,
      orchestrator,
      console: console_,
      ledger,
      ownerToken: cfg.MCP_OWNER_TOKEN,
      operatorToken: cfg.MCP_OPERATOR_TOKEN,
      clientTags,
      canon,
      grok: {
        repo,
        ledger,
        orchestrator,
        jobs: new JobRunner({ repo, stages, console: console_, ledger }),
        count: { getleads, aiArk, maps, permits: permitCounts, rails, db },
        held: {
          db,
          getleads,
          rails,
          fetchText: async (url: string) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`export could not be read: HTTP ${res.status}`);
            return res.text();
          },
          sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
          now: () => Date.now(),
        },
      },
    }),
  );

  // Cards that nobody answered expire; the waiting stage sees that and parks.
  const expired = await repo.expireCards();
  if (expired.length) log.info("expired cards on boot", { count: expired.length });
  const closedAborts = await repo.closeRunsResolvedAbort().catch((err) => {
    log.warn("close resolved aborts failed", { error: (err as Error).message });
    return [];
  });
  if (closedAborts.length) log.info("closed runs whose abort had already resolved", { runs: closedAborts.map((r) => `${r.client_tag}/${r.lane}`) });
  const closedWatch = await repo.closeWatchRestartsAfterAbort().catch((err) => {
    log.warn("close watch restarts failed", { error: (err as Error).message });
    return [];
  });
  if (closedWatch.length) log.info("closed empty watch restarts after abort (D61)", { runs: closedWatch.map((r) => `${r.client_tag}/${r.lane}`) });
  const open = await repo.openRuns();
  const leftoverWatch = open.filter((r) => isSelfStart(r.opened_by, r.trigger));
  if (leftoverWatch.length) {
    log.warn("open runs were opened by the watch; nothing will drive them (D61)", { count: leftoverWatch.length });
  }
  log.info("open runs wait for their next verb; nothing is driven on boot (D51, D61)", { count: open.length });

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
