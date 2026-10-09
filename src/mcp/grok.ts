import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { campaignRecord, countSource, heldRead, jobStatus, leftoversRead, listCampaigns, listJobs, SOURCE_LINES, spendRead, type CountDeps, type HeldDeps } from "../canon/index.js";
import type { Repo } from "../db/repo.js";
import type { LaneLedger } from "../ledger/lane.js";
import type { Orchestrator } from "../orchestrator.js";
import { JOB_SOURCES, type JobSpec } from "../jobs/recipe.js";
import { VERB_ORDER, type JobRunner, type Verb } from "../jobs/runner.js";
import { loadClientMap } from "../canon/clients.js";
import { registryRows } from "../canon/registry.js";
import { LEGACY_EMAIL_MAX_TIER_ALIASES, mapEmailMaxTier, mapPersonSource } from "../recipes/legacyLeadmagic.js";
import { EMAIL_TIERS } from "../recipes/schema.js";
import { campaignNameBySmartleadId } from "../ledger/health.js";
import { isColdCall, MAX_ROWS_PER_JOB } from "../policy/rules.js";

/**
 * The reads and the verbs for Grok bot (D52). Reads return what Supabase
 * and the vendors hold, as counts, ids, labels and the written notes, with
 * the rule stated and no verdict. Verbs run one stage of the pipeline on a
 * job and return counts. No tool returns a lead row or a file URL.
 */
export interface GrokDeps {
  repo: Repo;
  ledger: LaneLedger;
  orchestrator: Pick<Orchestrator, "abortRun">;
  jobs: JobRunner;
  count: CountDeps;
  held: HeldDeps | null;
  by: string;
}

export const GROK_READS = ["campaigns", "campaign_record", "sources", "count", "held", "jobs", "job", "spend", "leftovers"] as const;
export const GROK_VERBS = ["pull", "suppress", "icp", "enrich", "verify", "normalize", "qa", "stage", "import", "write_receipt", "abort"] as const;

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const snake = z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case");
const filters = z.record(z.unknown()).describe("The vendor filters as the record stores them in company_filters.");

export function registerGrokTools(server: McpServer, d: GrokDeps): void {
  server.registerTool(
    "campaigns",
    {
      description:
        "Every ACTIVE campaign with lifetime sends, positive replies, the rate per 2,000, leads left (untouched), the registry lane, and passes_reply_bar. The rule is on the answer. No other judgement: you pick. client_tag narrows to one client; include_inactive lists the rest. Counts and ids only.",
      inputSchema: { client_tag: snake.optional(), include_inactive: z.boolean().optional() },
    },
    async ({ client_tag, include_inactive }) => text(await listCampaigns(d.repo.raw(), d.repo, client_tag ?? null, { include_inactive })),
  );

  server.registerTool(
    "campaign_record",
    {
      description:
        "How this campaign was pulled, as Supabase holds it: every receipt (company, domain, person and email sources, company_filters as stored, build label, method note, yield by step, segment, dates), the build rows, the stamped leads counted by label and by source leg, the registry row, lifetime sends and positives, the source vocabulary for the values seen, and the written notes. Read it, see where most of the leads came from, repeat that. No verdict, never a lead row.",
      inputSchema: { client_tag: snake, campaign_id: z.number().int() },
    },
    async ({ client_tag, campaign_id }) => text(await campaignRecord(d.repo.raw(), d.repo, client_tag, campaign_id)),
  );

  server.registerTool(
    "sources",
    { description: "The source vocabulary: every value a receipt can carry on its company, domain, person and email legs, what it means, how to repeat it, and what it costs.", inputSchema: {} },
    async () => text({ lines: SOURCE_LINES, note: "A value on a record that is not here is unknown; ask Josh for the line, do not guess." }),
  );

  server.registerTool(
    "count",
    {
      description:
        "A count on one source with the filters you supply, as the record stores them: getleads (free), ai_ark (about five cents; needs approved_by), maps (the stored pool in client_<tag>.maps_raw, scoped by plan_id and categories; ICP view when named; reports pool, already used, net new), permits (PermitStack monthly). Returns the number, every call made, and the cost. The rule is on the answer; you subtract held and apply it.",
      inputSchema: { client_tag: snake, source: z.enum(["getleads", "ai_ark", "maps", "permits"]), filters, approved_by: z.string().optional().describe("Name of the person who approved the paid call.") },
    },
    async ({ client_tag, source, filters: f, approved_by }) => text(await countSource(d.count, { client_tag, source, filters: f, approved_by: approved_by ?? null })),
  );

  server.registerTool(
    "held",
    {
      description:
        "How much of a getleads pool the client already holds: a page of the pool is matched against what the client sent and its live campaigns, scaled to the tam you pass from count. Returns held and net_new with the method. Under 1,000 net new, the TAM for this campaign is exhausted.",
      inputSchema: { client_tag: snake, campaign_id: z.number().int(), filters, tam: z.number().int().min(0), days: z.number().int().min(1).max(365).optional() },
    },
    async ({ client_tag, campaign_id, filters: f, tam, days }) => {
      if (!d.held) return text({ error: "held is not available: the service has no getleads client configured." });
      const client = (await loadClientMap(d.repo.raw()).catch(() => [])).find((c) => c.client_tag === client_tag);
      if (!client) return text({ error: `${client_tag} is not in topup.client_map.` });
      return text(await heldRead(d.held, { client_tag, smartlead_client_id: client.smartlead_client_id, campaign_ids: [campaign_id], filters: f, tam, days }));
    },
  );

  server.registerTool(
    "jobs",
    { description: "Recent jobs and runs, newest first: status, step, who opened it, spend. Counts and ids.", inputSchema: { client_tag: snake.optional(), limit: z.number().int().min(1).max(50).optional() } },
    async ({ client_tag, limit }) => text(await listJobs(d.repo, client_tag ?? null, limit ?? 20)),
  );

  server.registerTool(
    "job",
    { description: "One job or run: its steps with counts, the per-campaign report, every vendor call, the spend cards waiting for a name, and the last ten lane events. Never rows.", inputSchema: { job_id: z.string() } },
    async ({ job_id }) => text(await jobStatus({ repo: d.repo, ledger: d.ledger }, job_id)),
  );

  server.registerTool(
    "spend",
    { description: "Spend today, by vendor over thirty days, month to date, and every spend card waiting for a named approval.", inputSchema: {} },
    async () => text(await spendRead(d.repo)),
  );

  server.registerTool(
    "leftovers",
    {
      description:
        "Where past pulls left rows that may never have been sent, per client: the LeadPipe lane table by status and source label, the client schema (companies, contacts, leads) with how many carry an email or a domain, the waterfall tables, the people-waterfall statuses, and the scratch tables a pull left behind (estimates). Counts only; reading this moves nothing. Name the store before reusing it.",
      inputSchema: { client_tag: snake.optional() },
    },
    async ({ client_tag }) => text(await leftoversRead(d.repo.raw(), client_tag ?? null)),
  );

  server.registerTool(
    "pull",
    {
      description:
        "Open a job for one campaign and start the pull in the background: the source and filters you read off campaign_record, up to max_rows. Returns the job_id at once (status started). Poll job(job_id) until pull/ingest finish. A spend estimate still waits for approved_by on a later pull(job_id). Then suppress, icp, enrich, verify, normalize, qa, stage, import, write_receipt, each on the job_id.",
      inputSchema: {
        client_tag: snake,
        campaign_id: z.number().int(),
        source: z.enum(JOB_SOURCES as unknown as [string, ...string[]]),
        filters,
        max_rows: z.number().int().min(1).max(MAX_ROWS_PER_JOB).describe(`1 to ${MAX_ROWS_PER_JOB} rows per job.`),
        lane: snake.optional().describe("Defaults to the campaign's registry lane."),
        email_max_tier: z.enum([...EMAIL_TIERS, ...LEGACY_EMAIL_MAX_TIER_ALIASES]).optional().describe("Live ceiling, or a stored leadmagic / lm / lead_magic alias which maps to aiark (D58)."),
        name_to_email: z.boolean().optional(),
        icp_kind: z.enum(["linkedin_native", "physical"]).optional(),
        approved_by: z.string().optional(),
        job_id: z.string().optional(),
      },
    },
    async ({ client_tag, campaign_id, source, filters: f, max_rows, lane, email_max_tier, name_to_email, icp_kind, approved_by, job_id }) => {
      let id = job_id ?? null;
      if (!id) {
        const client = (await loadClientMap(d.repo.raw()).catch(() => [])).find((c) => c.client_tag === client_tag);
        if (!client) return text({ error: `${client_tag} is not in topup.client_map.` });
        const registry = registryRows(await d.repo.campaignRegistry(client_tag).catch(() => []));
        const name = (await campaignNameBySmartleadId(d.repo.raw(), campaign_id).catch(() => null)) ?? registry.find((r) => r.campaign_id === campaign_id)?.campaign_name ?? null;
        if (isColdCall(name)) return text({ error: `#${campaign_id} ${name} is marked as cold call; the service ignores it (D54). Ask Josh.` });
        const laneName = lane ?? registry.find((r) => r.campaign_id === campaign_id)?.lane ?? "grok";
        const mappedTier = mapEmailMaxTier(email_max_tier);
        const spec: JobSpec = { client_tag, smartlead_client_id: client.smartlead_client_id, lane: laneName, campaign_id, source: source as JobSpec["source"], filters: f, max_rows, ...(mappedTier.tier ? { email_max_tier: mappedTier.tier } : {}), ...(name_to_email !== undefined ? { name_to_email } : {}), ...(icp_kind ? { icp_kind } : {}) };
        const opened = await d.jobs.open(spec, d.by);
        if (!opened.ok) return text({ error: opened.message });
        id = opened.job_id;
        if (mappedTier.warning) {
          await d.ledger.event({ client_tag, lane: laneName, run_id: id, event: "legacy_tier", line: mappedTier.warning, actor: d.by }).catch(() => undefined);
        }
        const begun = await d.jobs.begin(id, "pull", { by: d.by, approved_by: approved_by ?? null });
        return text(mappedTier.warning ? { ...begun, warning: mappedTier.warning } : begun);
      }
      return text(await d.jobs.begin(id, "pull", { by: d.by, approved_by: approved_by ?? null }));
    },
  );

  for (const verb of VERB_ORDER.filter((v): v is Exclude<Verb, "pull"> => v !== "pull")) {
    server.registerTool(
      verb,
      {
        description: verbDescription(verb),
        inputSchema: { job_id: z.string(), approved_by: z.string().optional().describe("Name of the person who approved the spend, when the previous call returned waiting_approval.") },
      },
      async ({ job_id, approved_by }) => text(await d.jobs.run(job_id, verb, { by: d.by, approved_by: approved_by ?? null })),
    );
  }

  server.registerTool(
    "write_receipt",
    {
      description:
        "Write the receipt for a job so the next top-up can read how this one was pulled: the four source legs, the filters, the counts and a plain-English note. Counts and campaign ids only.",
      inputSchema: {
        job_id: z.string(),
        company_source: z.string(),
        domain_source: z.string().default("already"),
        person_source: z.string(),
        email_source: z.string(),
        email_max_tier: z.string().optional(),
        company_filters: filters,
        how_i_did_it: z.string().min(10),
        notes: z.string().optional(),
        build_label: z.string().optional(),
        rows_found: z.number().int().optional(),
        rows_imported: z.number().int().optional(),
        tam_count: z.number().int().optional(),
      },
    },
    async (input) => {
      const run = await d.repo.getRun(input.job_id);
      if (!run) return text({ error: "no such job" });
      const client = (await loadClientMap(d.repo.raw()).catch(() => [])).find((c) => c.client_tag === run.client_tag);
      const person = mapPersonSource(input.person_source);
      const emailTier = mapEmailMaxTier(input.email_max_tier);
      if (!person.source) return text({ error: "person_source is required." });
      if (input.email_max_tier && !emailTier.tier && !emailTier.legacy) {
        return text({ error: `unknown email_max_tier '${input.email_max_tier}'. Live: ${EMAIL_TIERS.join(", ")}. leadmagic maps to aiark (D58).` });
      }
      const warnings = [person.warning, emailTier.warning].filter((w): w is string => Boolean(w));
      const receipt_id = await d.repo.insertPullReceipt({
        written_by: d.by,
        client_tag: run.client_tag,
        smartlead_client_id: client?.smartlead_client_id ?? null,
        lane: run.lane,
        campaign_ids: run.campaign_id ? [run.campaign_id] : [],
        icp_kind: input.company_source === "getleads" || input.company_source === "ai_ark" ? "linkedin_native" : "physical",
        persona: run.lane,
        company_source: input.company_source,
        company_filters: input.company_filters,
        domain_source: input.domain_source,
        person_source: person.source,
        email_source: input.email_source,
        email_max_tier: emailTier.tier,
        rows_found: input.rows_found ?? null,
        rows_imported: input.rows_imported ?? null,
        tam_count: input.tam_count ?? null,
        how_i_did_it: input.how_i_did_it,
        notes: input.notes ?? null,
        segment: null,
        yield_by_step: run.counts_by_status ?? null,
        spend_cents: Object.values(run.spend_cents_by_vendor ?? {}).reduce((a, b) => a + (Number(b) || 0), 0),
        suppression_scope: null,
        build_label: input.build_label ?? `job_${run.run_id.slice(0, 8)}`,
        granularity: "build",
      });
      await d.ledger.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "receipt", line: `Receipt ${receipt_id.slice(0, 8)} written by ${d.by}: ${input.how_i_did_it.slice(0, 160)}`, actor: d.by }).catch(() => undefined);
      return text({ ok: true, receipt_id, job_id: run.run_id, person_source: person.source, email_max_tier: emailTier.tier, ...(warnings.length ? { warning: warnings.join(" ") } : {}) });
    },
  );

  server.registerTool(
    "abort",
    { description: "Abort any open job or run. Running steps stop, claimed rows go back, open cards close. Nothing is loaded by an aborted job.", inputSchema: { job_id: z.string() } },
    async ({ job_id }) => {
      const res = await d.orchestrator.abortRun(job_id, d.by);
      return text(res.ok ? { ok: true, job_id, released_rows: res.released } : { ok: false, message: res.message });
    },
  );
}

function verbDescription(verb: Exclude<Verb, "pull">): string {
  switch (verb) {
    case "suppress":
      return "Run suppression on the job's rows: the response-based global list, the client's prior contacts, bounces, the public list and the client's own domain list. Returns raw, dropped by reason, net new.";
    case "icp":
      return "The ICP website gate (skill icp-website-gate): fetch each distinct domain's site with our own edge function (free), let Jev pick a category (about $0.11 per 1,000 sites), ask DiscoLike about the sites we could not read (about $0.0038 each), and write the verdict onto the rows. Only icp_gate = yes moves on; flagged rows are suppressed with a reason and stay in the table. The first call returns the estimate; approved_by runs it. Rows with no domain are left: enrich(job_id) then icp(job_id) again. Needs a label set for the client in topup.icp_variants.";
    case "enrich":
      return "Fill the gaps on the job's rows: domains through the domain waterfall, people through the people waterfall, emails through the email waterfall up to the job's max tier. Paid tiers return an estimate first; approved_by runs them.";
    case "verify":
      return "Verify the job's emails (MillionVerifier, then No2Bounce on the catch-alls). Paid; the first call returns the estimate, approved_by runs it. Returns sendable and reject rate.";
    case "normalize":
      return "Normalize names, companies and locations and assign the local sports team on the job's rows. Free.";
    case "qa":
      return "The merge-field QA gate on the job's rows: every field the copy uses is populated or the row is held. Returns held counts by reason.";
    case "stage":
      return "Route the job's rows into the campaign and stage them for import. Returns counts per campaign.";
    case "import":
      return "Import the staged rows into the Smartlead campaign through LeadPipe, then the post-import check. Refuses while loads_paused is on. Never sets a campaign ACTIVE.";
  }
}
