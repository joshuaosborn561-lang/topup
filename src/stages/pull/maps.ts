import { copyMapsPool } from "../../canon/mapsPool.js";
import type { Queryable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import type { PollVerdict } from "../common.js";
import type { PullAdapter, PullHandle, PullResult } from "./adapter.js";

function sourceLabel(run: RunRow, campaignId?: number | null): string {
  const base = `topup_${run.client_tag}_${run.lane}_${run.run_id.slice(0, 8)}`;
  return campaignId ? `${base}_c${campaignId}` : base;
}

/**
 * Physical maps pull (D57). Reads the stored pool in
 * `client_<tag>.maps_raw` (and the named ICP view), scoped by plan_id
 * and categories. INSERT … SELECT into the ingest table. Does not call
 * the Maps scraper, does not write dl_status / sg_exclude / skip_*.
 */
export const MAPS_STORED_URL = "stored://maps-pool";

export class MapsPull implements PullAdapter {
  readonly kind = "maps" as const;
  readonly vendor = "maps";

  constructor(
    private readonly db: Queryable & { withRun: <T>(runId: string, fn: (tx: Queryable) => Promise<T>) => Promise<T> },
  ) {}

  async start(run: RunRow, _recipe: Recipe, planRows: number, source?: Recipe["source"]): Promise<PullHandle> {
    if (source?.kind !== "maps") throw new Error("MapsPull needs a maps source");
    if (!source.params.plan_id) throw new Error("maps needs plan_id. Receipts scope the stored pool by plan_id, never by ZIP or client_tag alone. Ask Josh.");
    const campaignId = run.campaign_id;
    const copied = await copyMapsPool(this.db, {
      client_tag: run.client_tag,
      filters: {
        plan_id: source.params.plan_id,
        categories: source.params.categories,
        ...(source.params.icp_view ? { icp_view: source.params.icp_view } : {}),
      },
      max_rows: planRows,
      source_label: sourceLabel(run, campaignId ?? undefined),
      run_id: run.run_id,
    });
    return { handle: `maps-pool:${copied.inserted}:${copied.already_held}`, worstCaseCents: 0 };
  }

  async check(handle: string): Promise<PollVerdict<PullResult>> {
    const matched = /^maps-pool:(\d+)(?::(\d+))?$/.exec(handle);
    if (!matched) return { state: "failed", error: `maps pool handle ${handle} is not a count` };
    return {
      state: "done",
      value: {
        export_url: MAPS_STORED_URL,
        rows_exported: Number(matched[1]),
        cap_reason: null,
        cap_message: null,
        already_held: Number(matched[2] ?? 0),
      },
    };
  }
}
