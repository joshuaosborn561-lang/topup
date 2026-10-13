import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { loadClientTags } from "../canon/clients.js";
import type { Repo } from "../db/repo.js";
import type { Role } from "../domain/runs.js";
import { logger } from "../lib/log.js";
import { MCP_HTTPS_URL, SERVICE_VERSION } from "../version.js";
import { registerGrokTools, type GrokDeps } from "./grok.js";

const log = logger("mcp");

/** Hard ceiling on rows any card may show (D2: ten sample values, never a list). No MCP tool returns a row at all. */
export const SAMPLE_ROWS_MAX = 10;

/**
 * The surface (D99, D100): twelve tools. Every answer is counts, ids, labels and
 * the written record. None returns a lead row or a file URL. Operator and
 * owner see the same list; a spend is approved by a named person through
 * `topup(job_id, approved_by)`.
 */
export const MCP_TOOL_ROLE: Readonly<Record<string, Role>> = {
  canon: "operator",
  connectors: "operator",
  campaigns: "operator",
  playbook: "operator",
  build_record: "operator",
  topup: "operator",
  load: "operator",
  job: "operator",
  jobs: "operator",
  spend: "operator",
  abort: "operator",
  loads_paused: "operator",
};

/** Tools that were on the surface before and are gone (D53, D99). A caller that asks gets this list back. */
export const RETIRED_MCP_TOOLS: readonly string[] = [
  "campaign_record",
  "sources",
  "count",
  "held",
  "size",
  "leftovers",
  "holds",
  "resolve",
  "note",
  "pull",
  "suppress",
  "icp",
  "site_check",
  "classify_leftover",
  "enrich",
  "verify",
  "normalize",
  "qa",
  "stage",
  "import",
  "write_receipt",
  "confirm_filters",
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
  ownerToken: string;
  operatorToken: string;
  /** D42: from topup.client_map at boot; refreshed per request. */
  clientTags: string[];
  /** CANON.md, served as the server instructions and by the `canon` read. */
  canon: string;
  /** The reads and the verbs (D99). */
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
  const by = `mcp:${role}`;

  server.registerTool(
    "canon",
    { description: "The canon: the connectors you need, the hard rules, the six-step loop, when to stop. Read it once per session, right after connectors. It is also this server's instructions.", inputSchema: {} },
    async () => text(d.canon),
  );

  server.registerTool(
    "loads_paused",
    {
      description: "Global switch. While paused, nothing reaches Smartlead: topup stops at staged and load refuses. Omit paused to read the flag. Only Josh or Cayden flips it; say who.",
      inputSchema: { paused: z.boolean().optional().describe("Set true to pause loads, false to resume. Omit to read."), by: z.string().optional().describe("Who said so.") },
    },
    async ({ paused, by: who }) => {
      if (paused === undefined) return text({ paused: await d.repo.loadsPaused() });
      return text({ paused: await d.repo.setLoadsPaused(paused, who ? `${who} via ${by}` : by) });
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
