import type { MapsQuote } from "../../clients/mapsStats.js";
import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import { worstCaseCents } from "../../spend/prices.js";
import type { PollVerdict } from "../common.js";
import type { PullAdapter, PullHandle, PullResult } from "./adapter.js";

/**
 * Physical maps pull. `estimate_cost` is the price quote (it writes a plan
 * and does not scrape). The rows, when the spend card has cleared, come
 * from `sync_to_supabase` on data already scraped. `plan_leads` and
 * `run_leads` stay uncalled.
 */
export class MapsPull implements PullAdapter {
  readonly kind = "maps" as const;
  readonly vendor = "maps";

  constructor(private readonly maps: MapsQuote | null) {}

  async start(run: RunRow, _recipe: Recipe, planRows: number, source?: Recipe["source"]): Promise<PullHandle> {
    if (!this.maps) throw new Error("missing credentials for maps");
    if (source?.kind !== "maps") throw new Error("MapsPull needs a maps source");
    const category = source.params.categories[0];
    if (!category) throw new Error("maps pull needs a category");
    const state = source.params.states?.find((s) => /^[A-Za-z]{2}$/.test(s.trim()));
    const rows = await this.maps.syncExisting({
      category,
      clientTag: run.client_tag,
      ...(state ? { state: state.trim().toUpperCase() } : {}),
    });
    return { handle: `maps-sync:${rows}`, worstCaseCents: worstCaseCents("maps", "sync", Math.max(1, planRows)) };
  }

  async check(handle: string): Promise<PollVerdict<PullResult>> {
    const matched = /^maps-sync:(\d+)$/.exec(handle);
    if (!matched) return { state: "failed", error: `maps sync handle ${handle} is not a count` };
    return {
      state: "done",
      value: { export_url: "", rows_exported: Number(matched[1]), cap_reason: null, cap_message: null },
    };
  }
}
