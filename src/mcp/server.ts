import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { ingestedTable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import type { Role } from "../domain/runs.js";
import { variantStats } from "../domain/working.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import type { SlackConsole } from "../slack/console.js";
import { NEEDS_JOSH } from "../slack/roles.js";

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
  register_queue_table: "owner",
  lane_note: "owner",
  add_client_domains: "operator",
  sample_rows: "owner",
  variant_stats: "owner",
  campaign_registry: "owner",
  recipe_get: "owner",
  missing_piece_groups: "owner",
};

export interface McpDeps {
  repo: Repo;
  orchestrator: Orchestrator;
  console: SlackConsole;
  ledger: LaneLedger;
  ownerToken: string;
  operatorToken: string;
}

function tokenMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function roleForToken(header: string | undefined, d: Pick<McpDeps, "ownerToken" | "operatorToken">): Role | null {
  const token = header?.replace(/^Bearer\s+/i, "").trim();
  if (tokenMatches(token, d.ownerToken)) return "owner";
  if (tokenMatches(token, d.operatorToken)) return "operator";
  return null;
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
  const server = new McpServer({ name: "leadtopup", version: "0.1.0" });
  const allowed = (tool: string) => role === "owner" || MCP_TOOL_ROLE[tool] === "operator";
  const refused = () => text({ error: NEEDS_JOSH, role });
  const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");

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
        "Hand a queue table to the service so the work survives the chat: which schema.table, an optional where predicate, what each row is still missing (domain, person, email or none) and the next method that fills it. The service counts it now and keeps the count current. Owner only. Never pass rows.",
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
      description: "Write one line to a lane's event log (what was done, what is intended next). For Claude sessions handing state to the service. Owner only. No lead data.",
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
      const run = await d.repo.getRun(run_id);
      if (!run) return text({ error: "no such run" });
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
    async ({ limit, client_tag }) => text(await d.repo.listRuns(limit, client_tag)),
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
      const result = await d.console.resolveAs(`mcp:${role}`, role, card_id, choice);
      if (!result.ok) return text({ ok: false, reason: result.reason, message: result.message });
      await d.orchestrator.onTap({ card_id: result.card.card_id, kind: result.card.kind, run_id: result.card.run_id, choice: result.choice, by: `mcp:${role}` });
      return text({ ok: true, card_id, choice });
    },
  );

  server.registerTool(
    "start_topup",
    { description: "Open a top-up run for a client lane. Spend still asks before it happens.", inputSchema: { client_tag: z.string(), lane: z.string() } },
    async ({ client_tag, lane }) => {
      const res = await d.orchestrator.startTopup({ clientTag: client_tag, lane, by: `mcp:${role}`, trigger: "manual" });
      return text(res.ok ? { ok: true, run_id: res.run.run_id, slack_channel: res.run.slack_channel } : { ok: false, message: res.message });
    },
  );

  server.registerTool(
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
    { description: "Sends and interested replies by variant for a Smartlead campaign (last 30 days). Owner only.", inputSchema: { smartlead_campaign_id: z.number().int() } },
    async ({ smartlead_campaign_id }) => {
      if (!allowed("variant_stats")) return refused();
      return text(await variantStats(d.repo.raw(), smartlead_campaign_id));
    },
  );

  server.registerTool(
    "campaign_registry",
    { description: "Campaigns the service knows about, with their lane, band and working override. Owner only.", inputSchema: { client_tag: z.string().optional() } },
    async ({ client_tag }) => {
      if (!allowed("campaign_registry")) return refused();
      return text(await d.repo.campaignRegistry(client_tag));
    },
  );

  server.registerTool(
    "recipe_get",
    { description: "The recipe as loaded from the repo. Owner only. Recipes change in git, never here.", inputSchema: { recipe_id: z.string() } },
    async ({ recipe_id }) => {
      if (!allowed("recipe_get")) return refused();
      const r = await d.repo.getRecipe(recipe_id);
      return text(r ?? { error: "no such recipe" });
    },
  );

  server.registerTool(
    "missing_piece_groups",
    { description: "Rows grouped by what they are missing (domain, person, email) and the next method that fills it. Owner only.", inputSchema: { client_tag: z.string().optional() } },
    async ({ client_tag }) => {
      if (!allowed("missing_piece_groups")) return refused();
      return text(await d.repo.missingPieceGroups(client_tag));
    },
  );

  return server;
}

/** Express router for /mcp. Bearer token picks the role; no token, no answer. */
export function mcpRouter(d: McpDeps): Router {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  const handle = async (req: Request, res: Response) => {
    const role = roleForToken(req.header("authorization"), d);
    if (!role) {
      res.status(401).json({ error: "owner or operator token required" });
      return;
    }
    const server = buildMcpServer(role, d);
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
    res.status(405).json({ error: "stateless server: POST JSON-RPC to /mcp" });
  });
  router.delete("/", (_req, res) => {
    res.status(405).end();
  });
  return router;
}
