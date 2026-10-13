import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildMethod } from "../canon/method.js";
import { listCampaigns } from "../canon/campaigns.js";
import { loadClientMap } from "../canon/clients.js";
import { connectorsCheck, type ConnectorUrls } from "../canon/connectors.js";
import { jobStatus, listJobs, spendRead } from "../canon/jobs.js";
import type { Repo } from "../db/repo.js";
import { LEADPIPE_RULE } from "../grok/allowlist.js";
import { campaignNameBySmartleadId } from "../ledger/health.js";
import type { LaneLedger } from "../ledger/lane.js";
import { poolSource, type JobSpec } from "../jobs/settings.js";
import { APPROVER_RULE, type TopupRunner } from "../jobs/runner.js";

/**
 * The tools Grokbot calls (D99). Reads return counts, ids, labels and the
 * written record. `topup` opens a job on the pool the bot handed over and
 * quotes it; with approved_by it runs the paid tail and loads. No tool
 * returns a lead row or a file URL.
 */
export interface GrokDeps {
  repo: Repo;
  ledger: LaneLedger;
  jobs: TopupRunner;
  connectorUrls: ConnectorUrls;
  readTranscript?: (path: string) => Promise<string>;
  by: string;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");

export function registerGrokTools(server: McpServer, d: GrokDeps): void {
  server.registerTool(
    "connectors",
    {
      description:
        "Run this once at the start of every session, before anything else. Pass the names of the connectors or tools you have attached (your own tool list). The answer says which required connectors are missing and how to attach each in Grokbot (custom MCPs carry their Railway HTTPS address), and which optional ones a transcript may call for. A missing required connector stops the top-up: tell Josh what to connect and wait. Also restates the hard rule: every row moves through LeadPipe, never through chat.",
      inputSchema: { have: z.array(z.string()).describe("Connector or tool names as you see them, e.g. [\"Supabase\", \"Context_Saver\", \"getleads\", \"Smartlead\", \"Email_Verifier_Progression\", \"Top_Up\"].") },
    },
    async ({ have }) => text(connectorsCheck(have, d.connectorUrls)),
  );

  server.registerTool(
    "campaigns",
    {
      description:
        "Every ACTIVE campaign with lifetime sends, positive replies, the rate per 2,000, leads left (untouched), and passes_reply_bar. A campaign is low when untouched is under about two weeks of sends. client_tag narrows to one client; include_inactive lists the rest. Counts and ids only.",
      inputSchema: { client_tag: snake.optional(), include_inactive: z.boolean().optional() },
    },
    async ({ client_tag, include_inactive }) => text(await listCampaigns(d.repo.raw(), d.repo, client_tag ?? null, { include_inactive })),
  );

  server.registerTool(
    "build_record",
    {
      description:
        "How this campaign's list was built, from the saved transcript: the build record (narrative, date, who), the method as the ordered tool calls with their arguments as typed (paged; from/limit), what the person asked for in their words, and the process changes written since that build. Replay those calls with your own connectors, the same filters, titles, geography and sources, with the process changes applied on top. no_recorded_build=true means stop and wait for Josh to record the build. " + LEADPIPE_RULE,
      inputSchema: {
        client_tag: snake,
        campaign_id: z.number().int(),
        transcript_path: z.string().optional().describe("When the campaign has more than one transcript, which one."),
        from: z.number().int().min(1).optional().describe("First step to return (1-based). Default 1."),
        limit: z.number().int().min(1).max(120).optional().describe("Steps per page. Default 40."),
      },
    },
    async ({ client_tag, campaign_id, transcript_path, from, limit }) => text(await buildMethod({ db: d.repo.raw(), readTranscript: d.readTranscript }, { client_tag, campaign_id, transcript_path, from, limit })),
  );

  server.registerTool(
    "topup",
    {
      description:
        "Top up one campaign with the pool you built by replaying its record. First call: client_tag, campaign_id and the pool (source.kind=file_url with the signed CSV URL(s) LeadPipe or the vendor gave you, or source.kind=table with a schema.table you built in SQL on campaignintelligence and an optional where). The service ingests it through LeadPipe, removes everyone the client already has anywhere, removes unsubscribes and the DNC list, and answers with the new-lead count and the worst-case cost. Nothing paid runs. Show that count and cost to Josh or Cayden. When one of them says yes: topup(job_id, approved_by=\"Josh\" or \"Cayden\") runs the ICP website check, verification, normalization, QA, staging and the load into the campaign, then writes the record. Loads paused: it stops at staged; load(job_id) later. Refuses a campaign with no recorded build, a cold-call campaign, and a second open job on the campaign. Never sets a campaign ACTIVE. " + LEADPIPE_RULE,
      inputSchema: {
        client_tag: snake.optional(),
        campaign_id: z.number().int().optional(),
        source: poolSource.optional(),
        job_id: z.string().optional().describe("An open job: with approved_by, run the approved tail; without, re-read it with job(job_id) instead."),
        approved_by: z.string().optional().describe("Josh or Cayden, by name, after they said yes to the quoted count and cost."),
      },
    },
    async ({ client_tag, campaign_id, source, job_id, approved_by }) => {
      if (job_id) {
        if (!approved_by) return text({ error: `job ${job_id} is open. Pass approved_by with the name of the person who said yes to the quote, or read job(job_id). ${APPROVER_RULE}` });
        return text(await d.jobs.begin(job_id, "approve", { by: d.by, approved_by }));
      }
      if (!client_tag || campaign_id == null || !source) return text({ error: "topup needs client_tag, campaign_id and source (the pool), or job_id with approved_by." });
      const client = (await loadClientMap(d.repo.raw()).catch(() => [])).find((c) => c.client_tag === client_tag);
      if (!client) return text({ error: `${client_tag} is not in topup.client_map. Adding a client is a row in that table. Ask Josh.` });
      const name = await campaignNameBySmartleadId(d.repo.raw(), campaign_id).catch(() => null);
      const spec: JobSpec = { client_tag, smartlead_client_id: client.smartlead_client_id, campaign_id, source };
      const opened = await d.jobs.open(spec, d.by, name);
      if (!opened.ok) return text({ error: opened.message });
      return text(await d.jobs.begin(opened.job_id, "quote", { by: d.by }));
    },
  );

  server.registerTool(
    "load",
    {
      description: "Load a job that was approved and staged while loads were paused: import into the campaign through Smartlead, then the post-import check, then the record. Refuses while loads_paused is on. Never sets a campaign ACTIVE.",
      inputSchema: { job_id: z.string() },
    },
    async ({ job_id }) => text(await d.jobs.begin(job_id, "load", { by: d.by })),
  );

  server.registerTool(
    "jobs",
    { description: "Recent top-up jobs, newest first: status, step, who opened it, spend. Counts and ids.", inputSchema: { client_tag: snake.optional(), limit: z.number().int().min(1).max(50).optional() } },
    async ({ client_tag, limit }) => text(await listJobs(d.repo, client_tag ?? null, limit ?? 20)),
  );

  server.registerTool(
    "job",
    { description: "One job: its steps with counts, the quote or spend card waiting for a name, and the last ten events. Poll it after topup or load. Never rows.", inputSchema: { job_id: z.string() } },
    async ({ job_id }) => text(await jobStatus({ repo: d.repo, ledger: d.ledger }, job_id)),
  );

  server.registerTool(
    "spend",
    { description: "Spend today, by vendor over thirty days, month to date, and every card waiting for a named approval.", inputSchema: {} },
    async () => text(await spendRead(d.repo)),
  );

  server.registerTool(
    "abort",
    { description: "Abort an open job. Running steps stop, claimed rows go back, open cards close. Nothing is loaded by an aborted job.", inputSchema: { job_id: z.string() } },
    async ({ job_id }) => {
      const res = await d.jobs.abort(job_id, d.by);
      return text(res.ok ? { ok: true, job_id, released_rows: res.released } : { ok: false, message: res.message });
    },
  );
}
