import { McpHttpClient } from "./mcpHttp.js";

/**
 * Smartlead server (docs/servers.md §10). The client can call exactly the
 * tools in SMARTLEAD_ALLOWED and nothing else: no campaign status change, no
 * delete, no purge, no inline lead rows, and never
 * `smartlead_request` (D6). Step 11 starts an import from `leads_staging`
 * and polls it; step 12 reads sequences and campaign settings.
 */
export const SMARTLEAD_ALLOWED = ["start_lead_import", "get_lead_import_status", "get_sequences", "get_campaign", "list_campaign_mailboxes"] as const;
export type SmartleadTool = (typeof SMARTLEAD_ALLOWED)[number];

export interface ImportStarted {
  run_id: string;
}

export interface ImportStatus {
  status: string;
  total_leads: number | null;
  imported_count: number | null;
  duplicate_count: number | null;
  invalid_count: number | null;
  error_message: string | null;
}

export interface SequenceStep {
  seq_number: number | null;
  subject: string;
  body: string;
  /** A/B variants carry their own subject and body. */
  variants: Array<{ subject: string; body: string }>;
}

export interface Smartlead {
  startImport(campaignId: number): Promise<ImportStarted>;
  importStatus(runId: string): Promise<ImportStatus>;
  sequences(campaignId: number): Promise<SequenceStep[]>;
  /** Campaign settings as the server returns them; only known keys are read (step 12 findings). */
  campaign(campaignId: number): Promise<Record<string, unknown>>;
}

export const IMPORT_DONE = ["completed", "complete", "done", "finished", "succeeded", "success"];
export const IMPORT_FAILED = ["failed", "error", "errored"];

export class SmartleadClient implements Smartlead {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  private async call<T = Record<string, unknown>>(tool: SmartleadTool, args: Record<string, unknown>): Promise<T> {
    if (!this.url) throw new Error("SMARTLEAD_MCP_URL is not configured; cannot import or check a campaign");
    if (!SMARTLEAD_ALLOWED.includes(tool)) throw new Error(`Smartlead tool ${tool} is not on the allow list (D6)`);
    return this.mcp.call<T>(tool, args);
  }

  async startImport(campaignId: number): Promise<ImportStarted> {
    const res = await this.call("start_lead_import", { campaign_id: campaignId });
    const id = res.run_id ?? res.id;
    if (typeof id !== "string" && typeof id !== "number") throw new Error(`start_lead_import returned no run_id: ${JSON.stringify(Object.keys(res))}`);
    return { run_id: String(id) };
  }

  async importStatus(runId: string): Promise<ImportStatus> {
    const res = await this.call("get_lead_import_status", { run_id: runId });
    const run = (res.run && typeof res.run === "object" ? (res.run as Record<string, unknown>) : res) as Record<string, unknown>;
    const num = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));
    return {
      status: String(run.status ?? "unknown").toLowerCase(),
      total_leads: num(run.total_leads),
      imported_count: num(run.imported_count),
      duplicate_count: num(run.duplicate_count),
      invalid_count: num(run.invalid_count),
      error_message: typeof run.error_message === "string" ? run.error_message : null,
    };
  }

  async sequences(campaignId: number): Promise<SequenceStep[]> {
    const res = await this.call<unknown>("get_sequences", { campaign_id: campaignId });
    const list = Array.isArray(res) ? res : Array.isArray((res as { sequences?: unknown })?.sequences) ? (res as { sequences: unknown[] }).sequences : Array.isArray((res as { data?: unknown })?.data) ? (res as { data: unknown[] }).data : [];
    return list.map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const variants = Array.isArray(o.seq_variants) ? (o.seq_variants as Array<Record<string, unknown>>) : [];
      return {
        seq_number: o.seq_number === undefined || o.seq_number === null ? null : Number(o.seq_number),
        subject: String(o.subject ?? ""),
        body: String(o.email_body ?? o.body ?? ""),
        variants: variants.map((v) => ({ subject: String(v.subject ?? ""), body: String(v.email_body ?? v.body ?? "") })),
      };
    });
  }

  async campaign(campaignId: number): Promise<Record<string, unknown>> {
    const res = await this.call("get_campaign", { campaign_id: campaignId });
    return (res.campaign && typeof res.campaign === "object" ? (res.campaign as Record<string, unknown>) : res) ?? {};
  }
}
