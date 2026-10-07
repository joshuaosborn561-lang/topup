import { EXPORT_DONE, EXPORT_FAILED, exportRowLimit, type Getleads, type GetleadsFilters } from "../../clients/getleads.js";
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
    const maxRows = exportRowLimit(planRows);
    const started = await this.getleads.startExport(params as GetleadsFilters, { max_rows: maxRows, max_per_company: params.max_per_company });
    const ids = started.export_ids?.length ? started.export_ids : [started.export_id];
    const handle = ids.length === 1 ? ids[0]! : `multi:${JSON.stringify(ids)}`;
    return { handle, worstCaseCents: worstCaseCents("getleads", "export", maxRows) };
  }

  async check(handle: string): Promise<PollVerdict<PullResult>> {
    if (handle.startsWith("multi:")) return this.checkSplit(handle.slice("multi:".length));
    const s = await this.getleads.checkExport(handle);
    if (EXPORT_FAILED.includes(s.job_status)) return { state: "failed", error: `${s.job_status}${s.cap_message ? `: ${s.cap_message}` : ""}` };
    if (EXPORT_DONE.includes(s.job_status) || (s.export_url && s.rows_exported !== null)) {
      if (!s.export_url) return { state: "failed", error: `export ${handle} is ${s.job_status} but has no export_url` };
      return { state: "done", value: { export_url: s.export_url, rows_exported: s.rows_exported ?? 0, cap_reason: s.cap_reason, cap_message: s.cap_message } };
    }
    return { state: "running" };
  }

  private async checkSplit(json: string): Promise<PollVerdict<PullResult>> {
    const ids = JSON.parse(json) as string[];
    const parts = await Promise.all(ids.map((id) => this.getleads.checkExport(id)));
    const failed = parts.find((part) => EXPORT_FAILED.includes(part.job_status));
    if (failed) return { state: "failed", error: `${failed.job_status}${failed.cap_message ? `: ${failed.cap_message}` : ""}` };
    const ready = parts.every((part) => EXPORT_DONE.includes(part.job_status) || (part.export_url && part.rows_exported !== null));
    if (!ready) return { state: "running" };
    const urls = parts.map((part) => part.export_url).filter((url): url is string => Boolean(url));
    if (urls.length !== parts.length) return { state: "failed", error: "a split export finished without an export_url" };
    return {
      state: "done",
      value: {
        export_url: urls.join("\n"),
        rows_exported: parts.reduce((sum, part) => sum + (part.rows_exported ?? 0), 0),
        cap_reason: parts.find((part) => part.cap_reason)?.cap_reason ?? null,
        cap_message: parts.find((part) => part.cap_message)?.cap_message ?? null,
      },
    };
  }
}
