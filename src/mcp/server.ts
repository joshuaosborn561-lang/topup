import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { loadClientTags } from "../canon/clients.js";
import type { Console } from "../console/console.js";
import { NEEDS_JOSH } from "../console/roles.js";
import type { Repo } from "../db/repo.js";
import type { Role } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import type { Orchestrator } from "../orchestrator.js";
import { MCP_HTTPS_URL, SERVICE_VERSION } from "../version.js";
import { registerGrokTools, type GrokDeps } from "./grok.js";

const log = logger("mcp");

/** Hard ceiling on rows any card may show (D2: ten sample values, never a list). No MCP tool returns a row at all. */
export const SAMPLE_ROWS_MAX = 10;

/**
 * The surface (D53): the canon, the reads, the verbs. Every answer is
 * counts, ids, labels and written notes. None returns a lead row or a file
 * URL. Operator and owner see the same list; approve_spend needs the owner
 * token or a named approval relayed through a verb (D51).
 */
export const MCP_TOOL_ROLE: Readonly<Record<string, Role>> = {
  canon: "operator",
  campaigns: "operator",
  campaign_record: "operator",
  sources: "operator",
  count: "operator",
  held: "operator",
  jobs: "operator",
  job: "operator",
  spend: "operator",
  leftovers: "operator",
  holds: "operator",
  loads_paused: "operator",
  pull: "operator",
  suppress: "operator",
  icp: "operator",
  enrich: "operator",
  verify: "operator",
  normalize: "operator",
  qa: "operator",
  stage: "operator",
  import: "operator",
  write_receipt: "operator",
  abort: "operator",
  resolve: "operator",
  note: "operator",
};

/** Tools that were on the surface before D53 and are gone. A caller that asks gets this list back. */
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
  "topup_queue",
  "client_overview",
  "campaign_history",
  "size_client",
  "approval_briefing",
  "start_topup",
  "run_status",
  "list_runs",
  "abort_run",
  "resume_run",
  "list_holds",
  "resolve_hold",
  "lane_state",
  "lane_note",
  "add_client_domains",
];

export interface McpDeps {
  repo: Repo;
  orchestrator: Orchestrator;
  console: Console;
  ledger: LaneLedger;
  ownerToken: string;
  operatorToken: string;
  /** D42: from topup.client_map at boot; refreshed per request. */
  clientTags: string[];
  /** CANON.md, served as the server instructions and by the `canon` read. */
  canon: string;
  /** The reads and the verbs (D52). */
  grok: Omit<GrokDeps, "by">;
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
  const server = new McpServer({ name: "leadtopup", version: SERVICE_VERSION }, { instructions: d.canon });
  const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");
  const by = `mcp:${role}`;

  server.registerTool(
    "canon",
    { description: "The canon: the few rules, the reads, the verbs, how to read a record, when to stop. Read it once per session. It is also this server's instructions.", inputSchema: {} },
    async () => text(d.canon),
  );

  server.registerTool(
    "holds",
    { description: "Open cards waiting on a person: spend asks with the worst case, parked jobs, QA holds, stalls. Each names its job. Counts and ids.", inputSchema: { client_tag: snake.optional() } },
    async ({ client_tag }) => text(await d.orchestrator.holds(client_tag)),
  );

  server.registerTool(
    "resolve",
    {
      description:
        "Resolve a card by id: approve_spend or decline_spend (owner token, or pass approved_by on the verb instead), accept / purge / reroute on a QA hold, resume_run on a parked job, abort. The console checks the role once (D18); the effect on the job is returned.",
      inputSchema: { card_id: z.string(), choice: z.string() },
    },
    async ({ card_id, choice }) => {
      const result = await d.console.resolveAs(by, role, card_id, choice);
      if (!result.ok) return text({ ok: false, reason: result.reason, message: result.message === NEEDS_JOSH ? `${NEEDS_JOSH} Pass approved_by on the verb with the name of the person who said yes.` : result.message });
      const applied = await d.orchestrator.applyResolution({ card_id: result.card.card_id, kind: result.card.kind, run_id: result.card.run_id, choice: result.choice, by });
      return text({ ok: true, card_id, choice, effect: applied.effect });
    },
  );

  server.registerTool(
    "loads_paused",
    {
      description: "Global switch. While paused, import refuses and nothing reaches Smartlead. Omit paused to read the flag. Only a person flips it; say who.",
      inputSchema: { paused: z.boolean().optional().describe("Set true to pause loads, false to resume. Omit to read."), by: z.string().optional().describe("Who said so.") },
    },
    async ({ paused, by: who }) => {
      if (paused === undefined) return text({ paused: await d.repo.loadsPaused() });
      return text({ paused: await d.repo.setLoadsPaused(paused, who ? `${who} via ${by}` : by) });
    },
  );

  server.registerTool(
    "note",
    { description: "Write one line to a lane's event log (what was done, what is intended next). No lead data.", inputSchema: { client_tag: snake, lane: snake, line: z.string().min(1).max(500), next_intent: z.string().max(300).optional() } },
    async ({ client_tag, lane, line, next_intent }) => {
      await d.ledger.event({ client_tag, lane, event: "note", line, next_intent, actor: by });
      return text({ ok: true });
    },
  );

  registerGrokTools(server, { ...d.grok, by });

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
