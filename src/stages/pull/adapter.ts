import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import type { PollVerdict } from "../common.js";

/**
 * Step 3 has two flavors (skill lead-list-build / leadgen-mcp-routing):
 * LinkedIn-native lanes pull people (getleads first); physical lanes start
 * from Maps or PermitStack and walk the cascade. Both "end with rows in a
 * table, never in chat". `routePull` picks the adapter; an unwired source
 * parks rather than falling back to getleads.
 */
export interface PullHandle {
  /** Vendor's own id for the job; goes on run_steps.vendor_job_id. */
  handle: string;
  /** Worst case in cents from the service's price table (0 for included plans). */
  worstCaseCents: number;
}

export interface PullResult {
  /** Where the rows are: a signed file URL for LeadPipe to ingest. Never opened by this service. */
  export_url: string;
  rows_exported: number;
  cap_reason: string | null;
  cap_message: string | null;
}

export interface PullAdapter {
  readonly kind: Recipe["source"]["kind"];
  /** Vendor name for the spend ledger and the recipe's authorisation. */
  readonly vendor: string;
  /** Start the pull for up to `planRows` rows. Free adapters still return a handle. `source` is the campaign group's source (D30); the recipe source is the fallback. */
  start(run: RunRow, recipe: Recipe, planRows: number, source?: Recipe["source"]): Promise<PullHandle>;
  /** Poll the job; the stage keeps calling until done or failed. */
  check(handle: string): Promise<PollVerdict<PullResult>>;
}
