import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { campaignHistory } from "../builds/load.js";
import type { Repo } from "../db/repo.js";
import { presentRun, type Role } from "../domain/runs.js";
import { campaignReportFromCounts } from "../stages/size/campaignReport.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import type { SlackConsole } from "../slack/console.js";
import { NEEDS_JOSH } from "../slack/roles.js";
import type { Recipe } from "../recipes/schema.js";
import { MCP_HTTPS_URL, SERVICE_VERSION } from "../version.js";
import { resolveStartTarget } from "../recipes/start.js";
import { CLIENT_OVERVIEW_DESCRIPTION, clientOverview } from "./overview.js";
import { buildTopupQueue, TOPUP_QUEUE_DESCRIPTION } from "./queue.js";
import { CAMPAIGN_NOT_FOUND, clientTagSchema, loadClientTags, presentTopupRecipe, readTopupRecipe, recipeSummaryCounts } from "./recipe.js";
import { SIZE_CLIENT_MAX_WAIT_SECONDS, sizeClient } from "./sizeClient.js";

const log = logger("mcp");

/** Hard ceiling on rows any card may show (D2: ten sample values, never a list). No MCP tool returns a row at all (D48). */
export const SAMPLE_ROWS_MAX = 10;

/**
 * The surface (D48): a handful of tools, every one counts and ids only.
 * None returns a lead row or a file URL. Operator and owner see the same
 * list; owner-only choices are enforced on the card, not by hiding a tool.
 */
export const MCP_TOOL_ROLE: Readonly<Record<string, Role>> = {
  topup_queue: "operator",
  client_overview: "operator",
  campaign_history: "operator",
  size_client: "operator",
  approval_briefing: "operator",
  start_topup: "operator",
  run_status: "operator",
  list_runs: "operator",
  abort_run: "operator",
  resume_run: "operator",
  list_holds: "operator",
  resolve_hold: "operator",
  loads_paused: "operator",
  lane_state: "operator",
  lane_note: "operator",
  add_client_domains: "operator",
};

/** Nothing is hidden: there is no row-returning tool left to hide (D48). */
export const HIDDEN_FROM_OPERATOR: readonly string[] = [];

/** Tools that were on the surface before D48 and are gone. A caller that asks gets this list back. */
export const RETIRED_MCP_TOOLS: readonly string[] = [
  "sample_rows",
  "variant_stats",
  "campaign_registry",
  "recipe_get",
  "missing_piece_groups",
  "register_queue_table",
  "topup_recipe",
  "topup_campaign_builds",
  "topup_provenance_gaps",
];

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
  /** File and inferred recipes the watch walks. The queue and size_client read the same set. */
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

/** Mask an address so a card sample shows shape, not a sendable email (D2). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

/** Build a server whose tool set is fixed by the caller's role. One per request (stateless). */
export function buildMcpServer(role: Role, d: McpDeps): McpServer {
  const server = new McpServer({ name: "leadtopup", version: SERVICE_VERSION });
  const allowed = (tool: string) => role === "owner" || (MCP_TOOL_ROLE[tool] === "operator" && !HIDDEN_FROM_OPERATOR.includes(tool));
  const refused = () => text({ error: NEEDS_JOSH, role });
  const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");
  const recipeClient = clientTagSchema(d.clientTags);
  const smartleadCampaignId = z.number().int().describe("Smartlead campaign id");
  const by = `mcp:${role}`;

  server.registerTool(
    "topup_queue",
    {
      description: TOPUP_QUEUE_DESCRIPTION,
      inputSchema: { client_tag: z.string().optional(), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).default(0) },
    },
    async ({ client_tag, limit, offset }) => text(await buildTopupQueue(d.repo.raw(), d.repo, d.recipes, { client_tag, limit, offset })),
  );

  server.registerTool(
    "client_overview",
    {
      description: CLIENT_OVERVIEW_DESCRIPTION,
      inputSchema: { client_tag: recipeClient, include_inactive: z.boolean().optional().describe("Also list campaigns that are not ACTIVE. Default false.") },
    },
    async ({ client_tag, include_inactive }) => text(await clientOverview(d.repo.raw(), d.repo, client_tag, { include_inactive })),
  );

  server.registerTool(
    "campaign_history",
    {
      description:
        "Read before any top up. The build record for a campaign: every build that fed it (vendor, exact query or stored pool, counts, interested replies, method note, whether the method was reconstructed), lifetime sends and positives, the build the service would repeat and why, and the live pull recipe. Counts, labels and method text only. Never a lead row.",
      inputSchema: { client_tag: recipeClient, campaign_id: smartleadCampaignId },
    },
    async ({ client_tag, campaign_id }) => {
      const history = await campaignHistory({ db: d.repo.raw(), repo: d.repo }, client_tag, campaign_id);
      const live = await readTopupRecipe(d.repo.raw(), client_tag, campaign_id).catch((): typeof CAMPAIGN_NOT_FOUND => CAMPAIGN_NOT_FOUND);
      return text({
        ...history,
        live_recipe: live === CAMPAIGN_NOT_FOUND ? CAMPAIGN_NOT_FOUND : presentTopupRecipe(live, { includeVocab: false }),
        recipe_summary: recipeSummaryCounts(live, campaign_id),
      });
    },
  );

  server.registerTool(
    "size_client",
    {
      description:
        "Pilot and size one client in one call. Opens a size-only run per lane (every lane the recipes name, or the lanes or campaign_ids given), concurrently; waits up to wait_seconds; returns each lane's one-line-per-campaign report with the policy gate and reason, and Josh's approval briefing. pilot=true scores the 250-row sample and does not size. Nothing is pulled or loaded. Counts only.",
      inputSchema: {
        client_tag: recipeClient,
        lanes: z.array(snake).optional(),
        campaign_ids: z.array(smartleadCampaignId).max(50).optional(),
        pilot: z.boolean().optional(),
        wait_seconds: z.number().int().min(0).max(SIZE_CLIENT_MAX_WAIT_SECONDS).optional(),
      },
    },
    async ({ client_tag, lanes, campaign_ids, pilot, wait_seconds }) => {
      if (!allowed("size_client")) return refused();
      return text(await sizeClient({ repo: d.repo, orchestrator: d.orchestrator, recipes: d.recipes }, { clientTag: client_tag, lanes, campaignIds: campaign_ids, pilot, waitSeconds: wait_seconds, by }));
    },
  );

  server.registerTool(
    "approval_briefing",
    {
      description: "Josh's approval briefing: one line per campaign from the latest sized run of each lane (or one run_id), with what loads, what is skipped and why, the build it repeats, and whether loads are paused. Counts and dollars only.",
      inputSchema: { client_tag: z.string().optional(), run_id: z.string().optional() },
    },
    async ({ client_tag, run_id }) => {
      const runs = run_id ? [await d.repo.getRun(run_id)].filter((r): r is NonNullable<typeof r> => Boolean(r)) : await d.repo.listRuns(50, client_tag);
      const seen = new Set<string>();
      const out: Array<{ run_id: string; client_tag: string; lane: string; status: string; briefing: string | null; campaign_report: ReturnType<typeof campaignReportFromCounts> }> = [];
      for (const run of runs) {
        const key = `${run.client_tag}/${run.lane}`;
        if (!run_id && seen.has(key)) continue;
        const step = await d.repo.getStep(run.run_id, "size").catch(() => null);
        if (!step) continue;
        seen.add(key);
        const counts = step.counts as Record<string, unknown>;
        out.push({ run_id: run.run_id, client_tag: run.client_tag, lane: run.lane, status: presentRun(run).status, briefing: typeof counts.briefing === "string" ? counts.briefing : null, campaign_report: campaignReportFromCounts(counts) });
      }
      const loadsPaused = await d.repo.loadsPaused().catch(() => true);
      return text({ loads_paused: loadsPaused, lanes: out, briefing: out.map((o) => o.briefing ?? `${o.client_tag}/${o.lane}: run ${o.run_id.slice(0, 8)} ${o.status}, no briefing yet`).join("\n\n") });
    },
  );

  server.registerTool(
    "start_topup",
    {
      description:
        "Open a top-up run. Pass client_tag + campaign_id (and an optional lead count), or client_tag + lane. stop_after pilot scores a 250-row sample and does not size TAM. dry_run or stop_after size counts and closes as sized, with no pull and no load. stop_after pull parks before ingest. Every campaign is judged by the policy first; the ones that fail are skipped with their reason. Spend of $5 or above still asks Josh. Loads stay off while loads_paused is on.",
      inputSchema: {
        client_tag: z.string(),
        lane: z.string().optional(),
        campaign_id: z.number().int().optional(),
        count: z.number().int().min(1).optional(),
        dry_run: z.boolean().optional().describe("Size only. Same as stop_after size."),
        stop_after: z.enum(["pilot", "size", "pull"]).optional().describe("pilot scores a sample and does not size TAM. size closes after the count. pull parks before ingest."),
      },
    },
    async ({ client_tag, lane, campaign_id, count, dry_run, stop_after }) => {
      const target = resolveStartTarget({ clientTag: client_tag, lane, campaignId: campaign_id, count });
      if (!target.ok) return text({ ok: false, message: target.message });
      const res = await d.orchestrator.startTopup({ clientTag: target.clientTag, lane: target.lane, campaignIds: target.campaignIds, requestedCount: target.requestedCount, by, trigger: "manual", dryRun: dry_run, stopAfter: stop_after });
      return text(res.ok ? { ok: true, run_id: res.run.run_id } : { ok: false, message: res.message });
    },
  );

  server.registerTool(
    "run_status",
    { description: "Counts, spend, step state, the per-campaign report with gates and reasons, every vendor call's outcome, and open cards for one run. Never rows.", inputSchema: { run_id: z.string() } },
    async ({ run_id }) => {
      const found = await d.repo.getRun(run_id);
      if (!found) return text({ error: "no such run" });
      const run = presentRun(found);
      const [cards, batches] = await Promise.all([
        d.repo.openCardsForRun(run_id),
        d.repo.raw().query(`select batch, status, rows, last_percent, resumes_used, sendable, rejected, unresolved from topup.verify_batches where run_id = $1 order by batch`, [run_id]),
      ]);
      const { rows: steps } = await d.repo.raw().query<{ step: string; counts: Record<string, unknown> }>(
        `select step, status, attempts, worst_case_cents, approved_cents, actual_cents, useful_output, counts, last_error from topup.run_steps where run_id = $1`,
        [run_id],
      );
      const pull = steps.find((step) => step.step === "pull");
      const size = steps.find((step) => step.step === "size");
      const campaign_report = campaignReportFromCounts(pull?.counts ?? size?.counts);
      const sizeCounts = (size?.counts ?? {}) as Record<string, unknown>;
      return text({
        run,
        steps,
        campaign_report,
        vendor_calls: Array.isArray(sizeCounts.vendor_log) ? sizeCounts.vendor_log : [],
        briefing: typeof sizeCounts.briefing === "string" ? sizeCounts.briefing : null,
        verify_batches: batches.rows,
        open_cards: cards.map((c) => ({ card_id: c.card_id, kind: c.kind, audience: c.audience })),
      });
    },
  );

  server.registerTool(
    "list_runs",
    { description: "Recent runs, newest first.", inputSchema: { limit: z.number().int().min(1).max(50).default(20), client_tag: z.string().optional() } },
    async ({ limit, client_tag }) => text((await d.repo.listRuns(limit, client_tag)).map(presentRun)),
  );

  server.registerTool(
    "abort_run",
    { description: "Abort any open run, parked or running. Running steps are cancelled, claimed rows go back to the queue, open cards close, the receipt posts. Nothing is loaded by an aborted run.", inputSchema: { run_id: z.string() } },
    async ({ run_id }) => {
      if (!allowed("abort_run")) return refused();
      const res = await d.orchestrator.abortRun(run_id, by);
      return text(res.ok ? { ok: true, run_id, status: presentRun(res.run).status, released_rows: res.released } : { ok: false, message: res.message });
    },
  );

  server.registerTool(
    "resume_run",
    { description: "Resume a run that is waiting on a human or exhausted its retries: the step it stopped on gets its attempts back and the run is driven again. A closed run is not resumed.", inputSchema: { run_id: z.string() } },
    async ({ run_id }) => {
      if (!allowed("resume_run")) return refused();
      const res = await d.orchestrator.resumeRun(run_id, by);
      return text(res.ok ? { ok: true, run_id, step: res.step, status: presentRun(res.run).status } : { ok: false, message: res.message });
    },
  );

  server.registerTool(
    "list_holds",
    { description: "Open cards waiting on a human (spend asks, stalls, parked runs, QA holds), each with the per-campaign report.", inputSchema: { client_tag: z.string().optional() } },
    async ({ client_tag }) => text(await d.orchestrator.holds(client_tag)),
  );

  server.registerTool(
    "resolve_hold",
    { description: "Tap a card's button from here. Same role rules as Slack: spend and recipe choices need the owner token.", inputSchema: { card_id: z.string(), choice: z.string() } },
    async ({ card_id, choice }) => {
      if (role === "operator" && (choice === "approve_spend" || choice === "approve_small_spend" || choice === "split")) {
        const card = await d.repo.getCard(card_id);
        const cents = Number(card?.payload?.worst_case_cents ?? 0);
        if (cents >= SPEND_ASK_MIN_CENTS) return text({ ok: false, error: "Spend of $5 or above needs Josh." });
      }
      const result = await d.console.resolveAs(by, role, card_id, choice);
      if (!result.ok) return text({ ok: false, reason: result.reason, message: result.message });
      await d.orchestrator.onTap({ card_id: result.card.card_id, kind: result.card.kind, run_id: result.card.run_id, choice: result.choice, by });
      return text({ ok: true, card_id, choice });
    },
  );

  server.registerTool(
    "loads_paused",
    {
      description: "Global switch. While paused, every run, including ones the watch opens, parks before ingest. Nothing reaches Smartlead. Omit paused to read the flag.",
      inputSchema: { paused: z.boolean().optional().describe("Set true to pause loads, false to resume. Omit to read.") },
    },
    async ({ paused }) => {
      if (!allowed("loads_paused")) return refused();
      if (paused === undefined) return text({ paused: await d.repo.loadsPaused() });
      return text({ paused: await d.repo.setLoadsPaused(paused, by) });
    },
  );

  server.registerTool(
    "lane_state",
    {
      description:
        "Where a lane is: which of the thirteen steps of skills/lead-list-build it is on and since when, the gate that is unmet if it halted there, what is queued where, who it is blocked on, spend this run and this month, campaign runway and health, and the recent event log. Counts only, never rows.",
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
    "lane_note",
    { description: "Write one line to a lane's event log (what was done, what is intended next). No lead data.", inputSchema: { client_tag: snake, lane: snake, line: z.string().min(1).max(500), next_intent: z.string().max(300).optional() } },
    async ({ client_tag, lane, line, next_intent }) => {
      if (!allowed("lane_note")) return refused();
      await d.ledger.event({ client_tag, lane, event: "note", line, next_intent, actor: by });
      return text({ ok: true });
    },
  );

  server.registerTool(
    "add_client_domains",
    {
      description: "Optional per-client customer domains (D37: not required to start a run). Adds domains (not addresses) to topup.client_domain_blocklist; existing rows are kept. Domains only, never a lead row.",
      inputSchema: { client_tag: snake, domains: z.array(z.string().min(3).max(253)).min(1).max(5000), note: z.string().max(300).optional() },
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
        [client_tag, list, by, note ?? null],
      );
      const { rows } = await d.repo.raw().query<{ n: string }>(`select count(*)::text as n from topup.client_domain_blocklist where client_tag = $1`, [client_tag]);
      const lanes = await d.ledger.lanes(client_tag).catch(() => []);
      for (const l of lanes) {
        await d.ledger.event({ client_tag, lane: l.lane, event: "note", line: `Customer domain list: ${rowCount ?? 0} domains added (${rows[0]?.n ?? 0} total). Optional; an empty list does not halt (D37).`, actor: by }).catch(() => undefined);
      }
      return text({ ok: true, client_tag, added: rowCount ?? 0, total: Number(rows[0]?.n ?? 0), rejected_count: rejected.length, rejected: rejected.slice(0, 10) });
    },
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
    res.status(405).json({ error: "stateless server: POST JSON-RPC to /mcp", transport: "streamable-http", url: MCP_HTTPS_URL, version: SERVICE_VERSION, auth: "none", retired_tools: RETIRED_MCP_TOOLS });
  });
  router.delete("/", (_req, res) => {
    res.status(405).end();
  });
  return router;
}
