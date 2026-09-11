import { bandComplement, type Getleads, type GetleadsFilters } from "../../clients/getleads.js";
import type { RunRow } from "../../domain/runs.js";
import { campaignSnapshots } from "../../ledger/health.js";
import { recipeAuthorises, type Recipe } from "../../recipes/schema.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 2 — Size it (skill lead-list-build; skill tam-sizing).
 *
 * Count the segment on getleads (`count_contacts`, free), run the partition
 * check that proves the band filter binds, subtract what this ICP has already
 * been sent (`public.leads` and `leads_staging` for the lane's campaigns),
 * and hold the result against the useful floor. When thin, count each of the
 * recipe's widening candidates and put the numbers on the gate card; the
 * service never widens on its own and never calls a pool exhausted.
 *
 * tam-sizing wants two sources within ~25% before a number is trusted. Only
 * getleads is wired here (DiscoLike, LeadMagic and AI Ark counters are not in
 * docs/servers.md), so the run proceeds on one source and says so, in the
 * thread and in `size_sources: 1`.
 */
export interface SizeDeps extends StageDeps {
  getleads: Getleads;
  rails: SpendRails;
}

export interface Partition {
  bands: number;
  others: number;
  all: number;
  diff: number;
  ok: boolean;
}

/** tam-sizing: count(filter) + count(inverse) == count(no filter), within the recipe's tolerance. */
export function partitionCheck(bands: number, others: number, all: number, tolerance: number): Partition {
  const diff = Math.abs(bands + others - all);
  return { bands, others, all, diff, ok: all === 0 ? bands + others === 0 : diff <= Math.max(1, Math.ceil(all * tolerance)) };
}

/** tam-sizing: two sources agree when they are within `within` of the larger. */
export function sourcesAgree(a: number, b: number, within = 0.25): boolean {
  const hi = Math.max(a, b);
  return hi === 0 ? true : Math.abs(a - b) / hi <= within;
}

/** Rows the lane's campaigns need to reach `target_days` of runway; null when the mirror has no send data. */
export function rowsNeeded(snaps: Array<{ untouched: number; sends_window: number }>, targetDays: number, windowDays: number): number | null {
  let need = 0;
  let anySends = false;
  for (const s of snaps) {
    if (s.sends_window <= 0) continue;
    anySends = true;
    const perDay = s.sends_window / windowDays;
    need += Math.max(0, Math.ceil(perDay * targetDays - s.untouched));
  }
  return anySends ? need : null;
}

export class SizeStage {
  constructor(private readonly d: SizeDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "size", "sizing", async () => {
      if (recipe.source.kind !== "getleads") {
        return finish(this.d, run, "size", 0, { size_sources: 0 }, "Size: the source is a table, not a vendor; nothing to count (the pull reads the table).");
      }
      const params = recipe.source.params;
      const filters = params as GetleadsFilters;
      const count = async (f: GetleadsFilters, label: string) => {
        const r = await this.d.getleads.count(f);
        await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "size", vendor: "getleads", action: "count", rows: r.total_matching, credits: 0, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: null, approvedBy: null });
        return { label, ...r };
      };
      if (!recipeAuthorises(recipe, "size", "getleads")) throw new Error("the recipe does not authorise a getleads count on this lane");

      // Partition check: the band filter must bind.
      const { company_size: _omit, ...withoutBand } = filters;
      const [segment, others, all] = await Promise.all([
        count(filters, "segment"),
        count({ ...filters, company_size: bandComplement(params.company_size) as GetleadsFilters["company_size"] }, "other bands"),
        count(withoutBand as GetleadsFilters, "no band filter"),
      ]);
      const partition = partitionCheck(segment.total_matching, others.total_matching, all.total_matching, recipe.size.partition_tolerance);

      const campaignIds = recipe.routing.map((r) => r.campaign_id);
      const held = await this.alreadyHeld(campaignIds);
      const netNew = Math.max(0, segment.total_matching - held.count);

      const snaps = await campaignSnapshots(this.d.repo.raw(), campaignIds).catch(() => []);
      const need = rowsNeeded(snaps, recipe.runway.target_days, 7);
      const planRows = Math.max(1, Math.min(recipe.runway.max_per_run, need === null ? recipe.runway.max_per_run : Math.max(need, recipe.size.useful_floor), Math.max(netNew, 1)));

      const counts: Record<string, number> = {
        total_matching: segment.total_matching,
        exportable_rows: segment.exportable_rows ?? 0,
        partition_bands: partition.bands,
        partition_other_bands: partition.others,
        partition_all: partition.all,
        partition_diff: partition.diff,
        partition_ok: partition.ok ? 1 : 0,
        already_held: held.count,
        projected_net_new: netNew,
        useful_floor: recipe.size.useful_floor,
        rows_needed: need ?? 0,
        plan_rows: planRows,
        size_sources: 1,
      };

      if (!partition.ok) {
        await this.d.repo.finishStep(run.run_id, "size", { useful_output: 0, counts });
        return gateUnmet("size", `the band filter does not bind: ${partition.bands} (bands) + ${partition.others} (other bands) ≠ ${partition.all} (no band filter), off by ${partition.diff}. The count cannot be trusted (tam-sizing).`, counts);
      }
      if (netNew < recipe.size.useful_floor) {
        // Thin: count the widening options; Josh decides. Never widen unasked.
        const widening: string[] = [];
        for (const [i, w] of recipe.source.widening_candidates.entries()) {
          const wf: GetleadsFilters = {
            ...filters,
            ...(w.company_size ? { company_size: [...new Set([...params.company_size, ...w.company_size])] as GetleadsFilters["company_size"] } : {}),
            ...(w.add_titles ? { job_titles: [...new Set([...params.job_titles, ...w.add_titles])] } : {}),
            ...(w.states ? { states: w.states } : {}),
            ...(w.industries ? { industries: w.industries } : {}),
          };
          const r = await count(wf, `widening ${i + 1}`);
          counts[`widening_${i + 1}_total`] = r.total_matching;
          widening.push(`${describeWidening(w)}: ${r.total_matching} matching (about ${Math.max(0, r.total_matching - held.count)} net new)`);
        }
        await this.d.repo.finishStep(run.run_id, "size", { useful_output: 0, counts });
        return gateUnmet(
          "size",
          `projected net new ${netNew} is under the useful floor ${recipe.size.useful_floor} (${segment.total_matching} matching, ${held.count} already sent to this ICP). ` +
            (widening.length ? `Widening options, counted: ${widening.join("; ")}. Josh decides; nothing widens on its own.` : "The recipe lists no widening candidates; Josh decides."),
          counts,
        );
      }
      const line =
        `Size done: ${segment.total_matching} matching on getleads (partition check ok, off by ${partition.diff}) · ${held.count} already sent to this ICP · *${netNew}* projected net new (floor ${recipe.size.useful_floor}) · ` +
        (need === null ? `campaign mirror has no sends in the window, so the pull plans the recipe's max_per_run (${planRows})` : `campaigns need ${need} rows for ${recipe.runway.target_days} days; the pull plans ${planRows}`) +
        ` · one sizing source (getleads); tam-sizing wants a second, none is wired.` +
        (held.note ? ` · ${held.note}` : "");
      return finish(this.d, run, "size", netNew, counts, line);
    });
  }

  /** Distinct addresses already in this ICP's campaigns: the mirror's public.leads and leads_staging for the lane's campaign ids. */
  private async alreadyHeld(campaignIds: number[]): Promise<{ count: number; note: string | null }> {
    if (campaignIds.length === 0) return { count: 0, note: "recipe routes to no campaigns, so nothing was subtracted" };
    const db = this.d.repo.raw();
    const { rows: has } = await db.query<{ leads: boolean; staging: boolean; campaigns: boolean }>(
      `select to_regclass('public.leads') is not null as leads, to_regclass('public.leads_staging') is not null as staging, to_regclass('public.campaigns') is not null as campaigns`,
    );
    const parts: string[] = [];
    if (has[0].leads && has[0].campaigns) parts.push(`select lower(l.email) as e from public.leads l join public.campaigns c on c.id = l.campaign_id where c.smartlead_campaign_id = any($1::bigint[])`);
    if (has[0].staging) parts.push(`select lower(s.email) as e from public.leads_staging s where s.campaign_id = any($1::bigint[])`);
    if (parts.length === 0) return { count: 0, note: "no campaign mirror or staging table in this database; nothing was subtracted" };
    const { rows } = await db.query<{ n: string }>(`select count(distinct e)::text as n from (${parts.join(" union all ")}) x where e is not null`, [campaignIds]);
    return { count: Number(rows[0]?.n ?? 0), note: parts.length < 2 ? "only one of public.leads / leads_staging exists here" : null };
  }
}

function describeWidening(w: { company_size?: string[]; add_titles?: string[]; states?: string[]; industries?: string[] }): string {
  const bits: string[] = [];
  if (w.company_size) bits.push(`add bands ${w.company_size.join(", ")}`);
  if (w.add_titles) bits.push(`add titles ${w.add_titles.join(", ")}`);
  if (w.states) bits.push(`states ${w.states.join(", ")}`);
  if (w.industries) bits.push(`industries ${w.industries.join(", ")}`);
  return bits.join(" + ") || "unchanged";
}
