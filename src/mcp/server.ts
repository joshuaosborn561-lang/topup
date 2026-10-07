import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { ingestedTable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import { presentRun, type Role } from "../domain/runs.js";
import { variantStats } from "../domain/working.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import type { SlackConsole } from "../slack/console.js";
import { NEEDS_JOSH } from "../slack/roles.js";
import type { Recipe } from "../recipes/schema.js";
import { MCP_HTTPS_URL, SERVICE_VERSION } from "../version.js";
import { campaignSnapshots } from "../ledger/health.js";
import { resolveStartTarget } from "../recipes/start.js";
import { buildTopupQueue, TOPUP_QUEUE_DESCRIPTION } from "./queue.js";
import {
  CAMPAIGN_NOT_FOUND,
  clientTagSchema,
  loadClientTags,
  presentTopupRecipe,
  readCampaignBuilds,
  readProvenanceGaps,
  readTopupRecipe,
  TOPUP_RECIPE_DESCRIPTION,
} from "./recipe.js";

const log = logger("mcp");

/** Hard ceiling on rows any MCP call may return (brief section 8: ten sample rows, never a list). */
export const SAMPLE_ROWS_MAX = 10;

/** Tools and the least role that may call them. Operator sees the rest as "This needs Josh." */
export const MCP_TOOL_ROLE: Readonly<Record<string, Role>> = {
  lane_state: "operator",
  run_status: "operator",
  list_runs: "operator",
  list_holds: "operator",
  resolve_hold: "operator",
  start_topup: "operator",
  loads_paused: "operator",
  register_queue_table: "operator",
  lane_note: "operator",
  add_client_domains: "operator",
  sample_rows: "owner",
  variant_stats: "operator",
  campaign_registry: "operator",
  recipe_get: "operator",
  missing_piece_groups: "operator",
  topup_recipe: "operator",
  topup_campaign_builds: "operator",
  topup_provenance_gaps: "operator",
  topup_queue: "operator",
};

/** Lead-row dump stays owner-only. Cayden can run every other tool (D45). */
export const HIDDEN_FROM_OPERATOR: readonly string[] = ["sample_rows"];

const SPEND_ASK_MIN_CENTS = 500;

export interface McpDeps {
  repo: Repo;
  orchestrator: Orchestrator;
  console: SlackConsole;
  ledger: LaneLedger;
  ownerToken: string;
  operatorToken: string;
  /** D42: from topup.client_map at boot; refreshed per request. */
  clientTags: string[];
  /** File recipes the watch walks. Queue is read-only over the same set. */
  recipes: Recipe[];
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** D41: no login. Missing or unknown token is operator. Owner token still elevates. */
export function roleForToken(header: string | undefined, d: Pick<McpDeps, "ownerToken" | "operatorToken">): Role {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (tokenMatches(token, d.ownerToken)) return "owner";
  if (tokenMatches(token, d.operatorToken)) return "operator";
  return "operator";
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

/** Mask an address so a sample row shows shape, not a sendable email. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Build a server whose tool set is fixed by the caller's role. One per request (stateless). */
export function buildMcpServer(role: Role, d: McpDeps): McpServer {
  const server = new McpServer({ name: "leadtopup", version: SERVICE_VERSION });
  const visible = (tool: string) => role === "owner" || (MCP_TOOL_ROLE[tool] === "operator" && !HIDDEN_FROM_OPERATOR.includes(tool));
  const allowed = (tool: string) => visible(tool);
  const refused = () => text({ error: NEEDS_JOSH, role });
  const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");
  const recipeClient = clientTagSchema(d.clientTags);
  const smartleadCampaignId = z.number().int().describe("Smartlead campaign id");

  server.registerTool(
    "lane_state",
    {
      description:
        "Where a lane is: which of the thirteen steps of skills/lead-list-build it is on and since when, the gate that is unmet if it halted there, what is queued where (counts by status and every registered queue table), who it is blocked on and what they need to do, spend this run and this month, campaign runway and health, and the recent event log. Same answer as /where. Counts only, never rows.",
      inputSchema: { client_tag: snake, lane: snake.optional(), recount: z.boolean().default(false).describe("Re-run the registered queue counts first (live, slower).") },
    },
    async ({ client_tag, lane, recount }) => {
      if (lane) return text(await d.ledger.state(client_tag, lane, { recount }));
      const lanes = await d.ledger.lanes(client_tag);
      const out = [];
      for (const l of lanes) out.push(await d.ledger.state(l.client_tag, l.lane, { recount }));
      return text(out);
    },
  );

  server.registerTool(
    "register_queue_table",
    {
      description:
        "Hand a queue table to the service so the work survives the chat: which schema.table, an optional where predicate, what each row is still missing (domain, person, email or none) and the next method that fills it. The service counts it now and keeps the count current. Operator may call. Never pass rows.",
      inputSchema: {
        client_tag: snake,
        lane: snake,
        queue_name: snake,
        source_table: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/, "schema.table"),
        where_sql: z.string().max(500).optional(),
        missing: z.enum(["domain", "person", "email", "none"]),
        next_method: z.string().max(80).optional(),
        note: z.string().max(500).optional(),
      },
    },
    async (input) => {
      if (!allowed("register_queue_table")) return refused();
      try {
        const r = await d.ledger.registerQueue({ ...input, registered_by: `mcp:${role}` });
        return text({ ok: true, queue: { ...r.entry }, count: r.count, count_error: r.count_error });
      } catch (err) {
        return text({ ok: false, error: (err as Error).message });
      }
    },
  );

  server.registerTool(
    "lane_note",
    {
      description: "Write one line to a lane's event log (what was done, what is intended next). For Claude sessions handing state to the service. Operator may call. No lead data.",
      inputSchema: { client_tag: snake, lane: snake, line: z.string().min(1).max(500), next_intent: z.string().max(300).optional() },
    },
    async ({ client_tag, lane, line, next_intent }) => {
      if (!allowed("lane_note")) return refused();
      await d.ledger.event({ client_tag, lane, event: "note", line, next_intent, actor: `mcp:${role}` });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "add_client_domains",
    {
      description:
        "Optional per-client customer domains (D37: not required to start a run). Adds domains (not addresses) to topup.client_domain_blocklist; existing rows are kept. The global list is campaignintelligence positives, 90 days after the reply. Operator may call. Domains only — never a lead row.",
      inputSchema: {
        client_tag: snake,
        domains: z.array(z.string().min(3).max(253)).min(1).max(5000),
        note: z.string().max(300).optional(),
      },
    },
    async ({ client_tag, domains, note }) => {
      if (!allowed("add_client_domains")) return refused();
      const cleaned = new Set<string>();
      const rejected: string[] = [];
      for (const raw of domains) {
        const d0 = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
        if (!d0 || d0.includes("@") || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d0)) rejected.push(raw.slice(0, 60));
        else cleaned.add(d0);
      }
      const list = [...cleaned];
      const { rowCount } = await d.repo.raw().query(
        `insert into topup.client_domain_blocklist (client_tag, domain, added_by, note)
         select $1, x, $3, $4 from unnest($2::text[]) as x on conflict (client_tag, domain) do nothing`,
        [client_tag, list, `mcp:${role}`, note ?? null],
      );
      const { rows } = await d.repo.raw().query<{ n: string }>(`select count(*)::text as n from topup.client_domain_blocklist where client_tag = $1`, [client_tag]);
      const lanes = await d.ledger.lanes(client_tag).catch(() => []);
      for (const l of lanes) {
        await d.ledger.event({ client_tag, lane: l.lane, event: "note", line: `Customer domain list: ${rowCount ?? 0} domains added (${rows[0]?.n ?? 0} total). Optional; an empty list does not halt (D37).`, actor: `mcp:${role}` }).catch(() => undefined);
      }
      return text({ ok: true, client_tag, added: rowCount ?? 0, total: Number(rows[0]?.n ?? 0), rejected_count: rejected.length, rejected: rejected.slice(0, 10) });
    },
  );

  server.registerTool(
    "run_status",
    { description: "Counts, spend and step state for one run. Never rows.", inputSchema: { run_id: z.string() } },
    async ({ run_id }) => {
      const found = await d.repo.getRun(run_id);
      if (!found) return text({ error: "no such run" });
      const run = presentRun(found);
      const [cards, batches] = await Promise.all([
        d.repo.openCardsForRun(run_id),
        d.repo.raw().query(`select batch, status, rows, last_percent, resumes_used, sendable, rejected, unresolved from topup.verify_batches where run_id = $1 order by batch`, [run_id]),
      ]);
      const { rows: steps } = await d.repo.raw().query(`select step, status, attempts, worst_case_cents, approved_cents, actual_cents, useful_output, counts, last_error from topup.run_steps where run_id = $1`, [run_id]);
      return text({ run, steps, verify_batches: batches.rows, open_cards: cards.map((c) => ({ card_id: c.card_id, kind: c.kind, audience: c.audience })) });
    },
  );

  server.registerTool(
    "list_runs",
    { description: "Recent runs, newest first.", inputSchema: { limit: z.number().int().min(1).max(50).default(20), client_tag: z.string().optional() } },
    async ({ limit, client_tag }) => text((await d.repo.listRuns(limit, client_tag)).map(presentRun)),
  );

  server.registerTool(
    "list_holds",
    { description: "Open cards waiting on a human (spend asks, stalls, parked runs, QA holds).", inputSchema: { client_tag: z.string().optional() } },
    async ({ client_tag }) => text(await d.orchestrator.holds(client_tag)),
  );

  server.registerTool(
    "resolve_hold",
    {
      description: "Tap a card's button from here. Same role rules as Slack: spend and recipe choices need the owner token.",
      inputSchema: { card_id: z.string(), choice: z.string() },
    },
    async ({ card_id, choice }) => {
      if (role === "operator" && (choice === "approve_spend" || choice === "approve_small_spend" || choice === "split")) {
        const card = await d.repo.getCard(card_id);
        const cents = Number(card?.payload?.worst_case_cents ?? 0);
        if (cents >= SPEND_ASK_MIN_CENTS) {
          return text({ ok: false, error: "Spend of $5 or above needs Josh." });
        }
      }
      const result = await d.console.resolveAs(`mcp:${role}`, role, card_id, choice);
      if (!result.ok) return text({ ok: false, reason: result.reason, message: result.message });
      await d.orchestrator.onTap({ card_id: result.card.card_id, kind: result.card.kind, run_id: result.card.run_id, choice: result.choice, by: `mcp:${role}` });
      return text({ ok: true, card_id, choice });
    },
  );

  server.registerTool(
    "start_topup",
    {
      description:
        "Open a top-up run. Pass client_tag + campaign_id (and an optional lead count), or client_tag + lane. dry_run or stop_after size counts and closes as sized, with no pull and no load. stop_after pull parks before ingest. Spend of $5 or above still asks Josh.",
      inputSchema: {
        client_tag: z.string(),
        lane: z.string().optional(),
        campaign_id: z.number().int().optional(),
        count: z.number().int().min(1).optional(),
        dry_run: z.boolean().optional().describe("Size only. Same as stop_after size."),
        stop_after: z.enum(["size", "pull"]).optional().describe("size closes after the count. pull parks before ingest."),
      },
    },
    async ({ client_tag, lane, campaign_id, count, dry_run, stop_after }) => {
      const target = resolveStartTarget({ clientTag: client_tag, lane, campaignId: campaign_id, count });
      if (!target.ok) return text({ ok: false, message: target.message });
      const res = await d.orchestrator.startTopup({
        clientTag: target.clientTag,
        lane: target.lane,
        campaignIds: target.campaignIds,
        requestedCount: target.requestedCount,
        by: `mcp:${role}`,
        trigger: "manual",
        dryRun: dry_run,
        stopAfter: stop_after,
      });
      return text(res.ok ? { ok: true, run_id: res.run.run_id, slack_channel: res.run.slack_channel } : { ok: false, message: res.message });
    },
  );

  server.registerTool(
    "loads_paused",
    {
      description:
        "Global switch. While paused, every run, including ones the watch opens, parks before ingest. Nothing reaches Smartlead. Omit paused to read the flag.",
      inputSchema: { paused: z.boolean().optional().describe("Set true to pause loads, false to resume. Omit to read.") },
    },
    async ({ paused }) => {
      if (!allowed("loads_paused")) return refused();
      if (paused === undefined) return text({ paused: await d.repo.loadsPaused() });
      const now = await d.repo.setLoadsPaused(paused, `mcp:${role}`);
      return text({ paused: now });
    },
  );

  if (role === "owner") server.registerTool(
    "sample_rows",
    {
      description: `Up to ${SAMPLE_ROWS_MAX} sample rows for a client and lead_status, with emails masked. Owner only.`,
      inputSchema: { client_tag: z.string(), lead_status: z.string(), limit: z.number().int().min(1).max(SAMPLE_ROWS_MAX).default(SAMPLE_ROWS_MAX), run_id: z.string().optional() },
    },
    async ({ client_tag, lead_status, limit, run_id }) => {
      if (!allowed("sample_rows")) return refused();
      const table = ingestedTable(client_tag);
      const n = Math.min(limit, SAMPLE_ROWS_MAX);
      const { rows } = await d.repo.raw().query(
        `select id, first_name, last_name, email, job_title, company_name, city, state, lead_status,
                first_name_n, company_n, location, local_sports_team, mv_status, n2b_status, mail_class, verify_path, ev_status, normalize_flags
         from ${table} where lead_status = $1 and ($3::uuid is null or run_id = $3) order by random() limit $2`,
        [lead_status, n, run_id ?? null],
      );
      return text(rows.map((r) => ({ ...r, email: maskEmail(r.email as string) })));
    },
  );

  server.registerTool(
    "variant_stats",
    { description: "Sends and interested replies by variant for a Smartlead campaign (last 30 days). Counts only.", inputSchema: { smartlead_campaign_id: z.number().int() } },
    async ({ smartlead_campaign_id }) => {
      if (!allowed("variant_stats")) return refused();
      return text(await variantStats(d.repo.raw(), smartlead_campaign_id));
    },
  );

  server.registerTool(
    "campaign_registry",
    { description: "Campaigns the service knows about, with their lane, band and working override.", inputSchema: { client_tag: z.string().optional() } },
    async ({ client_tag }) => {
      if (!allowed("campaign_registry")) return refused();
      return text(await d.repo.campaignRegistry(client_tag));
    },
  );

  server.registerTool(
    "recipe_get",
    { description: "The file or inferred recipe the pipeline walks. Recipes change in git or from pull_receipts, never here.", inputSchema: { recipe_id: z.string() } },
    async ({ recipe_id }) => {
      if (!allowed("recipe_get")) return refused();
      const r = await d.repo.getRecipe(recipe_id);
      return text(r ?? { error: "no such recipe" });
    },
  );

  server.registerTool(
    "missing_piece_groups",
    { description: "Rows grouped by what they are missing (domain, person, email) and the next method that fills it. Counts only.", inputSchema: { client_tag: z.string().optional() } },
    async ({ client_tag }) => {
      if (!allowed("missing_piece_groups")) return refused();
      return text(await d.repo.missingPieceGroups(client_tag));
    },
  );

  server.registerTool(
    "topup_recipe",
    {
      description: TOPUP_RECIPE_DESCRIPTION,
      inputSchema: {
        client_tag: recipeClient,
        campaign_id: smartleadCampaignId,
        include_vocab: z.boolean().default(false).describe("Include the ~50-entry vocab and house rules. Default false."),
      },
    },
    async ({ client_tag, campaign_id, include_vocab }) => {
      const recipe = await readTopupRecipe(d.repo.raw(), client_tag, campaign_id);
      if (recipe === CAMPAIGN_NOT_FOUND) return text(CAMPAIGN_NOT_FOUND);
      const snaps = await campaignSnapshots(d.repo.raw(), [campaign_id]).catch(() => []);
      return text(presentTopupRecipe(recipe, { includeVocab: include_vocab, sendsLast14d: snaps[0]?.sends_last_14d ?? null }));
    },
  );

  server.registerTool(
    "topup_campaign_builds",
    {
      description:
        "Builds that fed a campaign, largest first. Counts, source tags and method labels from topup.campaign_builds. Never lead rows.",
      inputSchema: { client_tag: recipeClient, campaign_id: smartleadCampaignId },
    },
    async ({ client_tag, campaign_id }) => text(await readCampaignBuilds(d.repo.raw(), client_tag, campaign_id)),
  );

  server.registerTool(
    "topup_provenance_gaps",
    {
      description: "Campaigns for a client still missing a pull stamp. Counts from topup.provenance_gaps. Never lead rows.",
      inputSchema: { client_tag: recipeClient },
    },
    async ({ client_tag }) => text(await readProvenanceGaps(d.repo.raw(), client_tag)),
  );

  server.registerTool(
    "topup_queue",
    {
      description: TOPUP_QUEUE_DESCRIPTION,
      inputSchema: {
        client_tag: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ client_tag, limit, offset }) => text(await buildTopupQueue(d.repo.raw(), d.repo, d.recipes, { client_tag, limit, offset })),
  );

  return server;
}

/** CORS so Cursor and other HTTPS MCP clients can POST to Railway. */
export function applyMcpCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, MCP-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Session-Id");
}

/** Express router for /mcp. No login (D41). Optional owner token elevates. */
export function mcpRouter(d: McpDeps): Router {
  const router = express.Router();
  router.use((req, res, next) => {
    applyMcpCors(res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });
  router.use(express.json({ limit: "1mb" }));

  const handle = async (req: Request, res: Response) => {
    const role = roleForToken(req.header("authorization"), d);
    const liveTags = await loadClientTags(d.repo.raw()).catch(() => d.clientTags);
    const server = buildMcpServer(role, { ...d, clientTags: liveTags.length ? liveTags : d.clientTags });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error("mcp request failed", { role, error: (err as Error).message });
      if (!res.headersSent) res.status(500).json({ error: "internal error" });
    }
  };

  router.post("/", handle);
  router.get("/", (_req, res) => {
    res.status(405).json({
      error: "stateless server: POST JSON-RPC to /mcp",
      transport: "streamable-http",
      url: MCP_HTTPS_URL,
      version: SERVICE_VERSION,
      auth: "none",
    });
  });
  router.delete("/", (_req, res) => {
    res.status(405).end();
  });
  return router;
}
