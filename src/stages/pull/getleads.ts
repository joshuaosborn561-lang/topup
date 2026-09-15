import { EXPORT_DONE, EXPORT_FAILED, type Getleads, type GetleadsFilters } from "../../clients/getleads.js";
import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import { worstCaseCents } from "../../spend/prices.js";
import type { PollVerdict } from "../common.js";
import type { PullAdapter, PullHandle, PullResult } from "./adapter.js";

/**
 * The LinkedIn-native flavor of step 3 (skill parlay-lead-pulls and the other
 * client pull skills): getleads `export_contacts` with the recipe's filters —
 * band labels, every email status (D35 item 15), `max_per_company` — then poll
 * `check_contact_export` for the URL and the real row count. Included plan:
 * $0, but the ledger row is written all the same.
 */
export class GetleadsPull implements PullAdapter {
  readonly kind = "getleads" as const;
  readonly vendor = "getleads";

  constructor(private readonly getleads: Getleads) {}

  async start(_run: RunRow, recipe: Recipe, planRows: number, source?: Recipe["source"]): Promise<PullHandle> {
    const src = source ?? recipe.source;
    if (src.kind !== "getleads") throw new Error("GetleadsPull needs a getleads source");
    const params = src.params;
    const maxRows = Math.max(1, Math.min(50_000, planRows));
    const started = await this.getleads.startExport(params as GetleadsFilters, { max_rows: maxRows, max_per_company: params.max_per_company });
    return { handle: started.export_id, worstCaseCents: worstCaseCents("getleads", "export", maxRows) };
  }

  async check(handle: string): Promise<PollVerdict<PullResult>> {
    const s = await this.getleads.checkExport(handle);
    if (EXPORT_FAILED.includes(s.job_status)) return { state: "failed", error: `${s.job_status}${s.cap_message ? `: ${s.cap_message}` : ""}` };
    if (EXPORT_DONE.includes(s.job_status) || (s.export_url && s.rows_exported !== null)) {
      if (!s.export_url) return { state: "failed", error: `export ${handle} is ${s.job_status} but has no export_url` };
      return { state: "done", value: { export_url: s.export_url, rows_exported: s.rows_exported ?? 0, cap_reason: s.cap_reason, cap_message: s.cap_message } };
    }
    return { state: "running" };
  }
}
