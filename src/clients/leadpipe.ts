import { McpHttpClient } from "./mcpHttp.js";

/**
 * LeadPipe (existing ingestion service). Called, never forked. We use it to
 * turn a filtered slice of lp.<tag>_ingested_leads into a signed CSV URL
 * (server to server) and, in later stages, to ingest and import.
 */
export interface ExportResult {
  signed_url: string;
  row_count: number;
}

export interface LeadPipe {
  exportIngested(clientTag: string, where: Record<string, string>, columns: string[]): Promise<ExportResult>;
}

export class LeadPipeClient implements LeadPipe {
  private readonly mcp: McpHttpClient;

  constructor(
    private readonly url: string,
    token: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    this.mcp = new McpHttpClient(url, token, fetchImpl);
  }

  async exportIngested(clientTag: string, where: Record<string, string>, columns: string[]): Promise<ExportResult> {
    if (!this.url) throw new Error("LEADPIPE_MCP_URL is not configured; cannot export rows for verification");
    const res = await this.mcp.call<Record<string, unknown>>("lp_export", {
      client_tag: clientTag,
      table: "ingested_leads",
      format: "csv",
      columns,
      where,
    });
    const url = (res.signed_url ?? res.url) as string | undefined;
    const count = Number(res.row_count ?? res.rows ?? NaN);
    if (!url || !Number.isFinite(count)) {
      throw new Error(`lp_export returned no signed_url/row_count: ${JSON.stringify(Object.keys(res))}`);
    }
    return { signed_url: url, row_count: count };
  }
}
