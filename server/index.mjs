import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { addRule, dataClient, DATA_URL, findLowCampaigns, getCanon, getClient, getSkill, getToolkit, listClients, listSkills, START_HERE } from "./booklet.mjs";

/**
 * The Lead Topup MCP (D113): the shared instruction booklet for every
 * top-up bot, Josh's and Cayden's. Streamable HTTP at /mcp, stateless, no
 * login (as before, D41). No secret at all: the database half is the
 * Supabase function booklet-data, which uses Supabase's own connection.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 3000);
const ALLOWED_PROJECT = "azpapwtnrbzywlnxxecz";
if (!DATA_URL.startsWith(`https://${ALLOWED_PROJECT}.supabase.co/`)) {
  console.error(JSON.stringify({ tag: "boot", error: `BOOKLET_DATA_URL is not on Supabase project ${ALLOWED_PROJECT}; refusing to start` }));
  process.exit(1);
}
const data = dataClient(DATA_URL);

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const plain = (err) => String(err?.message ?? err).replace(/postgres(ql)?:\/\/\S+/gi, "[database url]").slice(0, 300);
const tag = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case client_tag");

function build() {
  const server = new McpServer({ name: "leadtopup", version: "2.0.0" }, { instructions: START_HERE });
  const safe = (fn) => async (args) => {
    try {
      return await fn(args ?? {});
    } catch (err) {
      return text({ error: plain(err) });
    }
  };

  server.registerTool("start_here", { description: "Call first, every session. Tells any top-up bot what to read before any top-up or list build.", inputSchema: {} }, safe(async () => text(START_HERE)));

  server.registerTool(
    "get_canon",
    {
      description: "The shared rules every top-up bot follows (active rows of topup.bot_rules). They win over skill text. Filter by client (rules for that client plus the general ones) or category.",
      inputSchema: { client: tag.optional(), category: z.string().max(40).optional() },
    },
    safe(async ({ client, category }) => text(await getCanon(data, { client, category }))),
  );

  server.registerTool(
    "add_rule",
    {
      description: "Save a durable rule Josh or Cayden decided, for every bot. Pass supersedes (the old rule's id) to replace a rule: the old one is marked superseded, never deleted. Plain English. Never put a lead row, an email address or an API key in a rule.",
      inputSchema: {
        rule: z.string().min(10).max(4000),
        category: z.string().min(2).max(40),
        client: tag.optional().describe("client_tag, or omit for a rule that applies to every client"),
        source: z.string().min(2).max(200).describe("Who decided it and where, e.g. 'Josh in Grokbot, 16 Oct'"),
        supersedes: z.string().uuid().optional(),
      },
    },
    safe(async (a) => {
      if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i.test(a.rule) || /(sk-|eyJ)[A-Za-z0-9_-]{16,}/.test(a.rule)) {
        return text({ error: "That rule contains an email address or something that looks like a key. Rules never carry either. Nothing was saved." });
      }
      return text(await addRule(data, a));
    }),
  );

  server.registerTool("list_skills", { description: "Josh's skills in the repo, josh-judgment-calls first, with their one-line descriptions. Synced daily from Claude.", inputSchema: {} }, safe(async () => text(await listSkills(ROOT))));

  server.registerTool(
    "get_skill",
    { description: "One skill's full text (SKILL.md), by name from list_skills.", inputSchema: { name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/) } },
    safe(async ({ name }) => {
      const body = await getSkill(ROOT, name);
      return body ? text(body) : text({ error: `no skill named ${name}; call list_skills` });
    }),
  );

  server.registerTool("get_toolkit", { description: "The connector guide: which MCP to use for what. Lives in topup.bot_rules, so a bot that updates it updates this.", inputSchema: {} }, safe(async () => text((await getToolkit(data)) ?? { error: "the toolkit rule is missing from topup.bot_rules; ask Josh" })));

  server.registerTool("list_clients", { description: "Every client: tag, name, Smartlead client id, how many build records, last build date, how many client rules.", inputSchema: {} }, safe(async () => text(await listClients(data))));

  server.registerTool(
    "get_client",
    {
      description: "Everything about one client a top-up needs: campaigns with lanes and status, build history in words with transcript paths, process changes, client rules, and the skills that name them. Counts and ids only; no lead rows.",
      inputSchema: { client_tag: tag, history: z.number().int().min(1).max(50).optional() },
    },
    safe(async ({ client_tag, history }) => {
      const out = await getClient(data, ROOT, client_tag, { history });
      return text(out ?? { error: `${client_tag} is not in topup.client_map; call list_clients` });
    }),
  );

  server.registerTool(
    "find_low_campaigns",
    {
      description: "Which lanes and campaigns are running low for a client: untouched leads, last-7-day send pace, days of runway, lifetime sends, positive replies and the rate per 2,000. Lanes sorted lowest runway first. Read-only.",
      inputSchema: { client_tag: tag },
    },
    safe(async ({ client_tag }) => {
      const out = await findLowCampaigns(data, client_tag);
      return text(out ?? { error: `bad client_tag ${client_tag}` });
    }),
  );

  return server;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/health" || url.pathname === "/") {
      let db = false;
      let activeRules = null;
      try {
        const h = await data("health");
        db = true;
        activeRules = h.active_rules;
      } catch {
        db = false;
      }
      const skills = (await listSkills(ROOT).catch(() => [])).length;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: db, service: "leadtopup booklet (D113)", mcp: "/mcp", db, active_rules: activeRules, skills, commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null }));
      return;
    }
    if (url.pathname === "/mcp") {
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json", allow: "POST" });
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This server is stateless: POST JSON-RPC to /mcp." }, id: null }));
        return;
      }
      const body = await readBody(req);
      const server = build();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close().catch(() => undefined);
        server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found; the MCP is at /mcp, health at /health" }));
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: plain(err) }));
  }
});

http.listen(PORT, () => console.log(JSON.stringify({ tag: "boot", port: PORT, data: DATA_URL })));
