import type { PermitCounts } from "../../clients/permits.js";
import type { RunRow } from "../../domain/runs.js";
import type { Recipe } from "../../recipes/schema.js";
import { worstCaseCents } from "../../spend/prices.js";
import type { PollVerdict } from "../common.js";
import type { PullAdapter, PullHandle, PullResult } from "./adapter.js";

/**
 * Permit pull is the count adapter: `metrics_monthly` only.
 * Search, export, and sync return rows and stay uncalled.
 */
export class PermitsPull implements PullAdapter {
  readonly kind = "permits" as const;
  readonly vendor = "permitstack";

  constructor(private readonly permits: PermitCounts | null) {}

  async start(_run: RunRow, _recipe: Recipe, planRows: number, source?: Recipe["source"]): Promise<PullHandle> {
    if (!this.permits) throw new Error("missing credentials for permitstack");
    if (source?.kind !== "permits") throw new Error("PermitsPull needs a permits source");
    const permitType = source.params.permit_types[0];
    if (!permitType) throw new Error("permit pull needs a permit type");
    const states = [...new Set((source.params.states ?? []).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))];
    if (states.length === 0) throw new Error("permit pull needs a state");
    const counts = await Promise.all(states.map((state) => this.permits!.monthlyTotal({ category: permitType, state })));
    const rows = counts.reduce((sum, counted) => sum + counted.total, 0);
    return { handle: `permits-count:${rows}`, worstCaseCents: worstCaseCents("permitstack", "metrics_monthly", Math.max(1, planRows)) };
  }

  async check(handle: string): Promise<PollVerdict<PullResult>> {
    const matched = /^permits-count:(\d+)$/.exec(handle);
    if (!matched) return { state: "failed", error: `permit count handle ${handle} is not a count` };
    return {
      state: "done",
      value: { export_url: "", rows_exported: Number(matched[1]), cap_reason: null, cap_message: null },
    };
  }
}
