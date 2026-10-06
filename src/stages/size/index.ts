import { bandComplement, type Getleads, type GetleadsFilters } from "../../clients/getleads.js";
import type { MapsStats } from "../../clients/mapsStats.js";
import type { PermitCounts } from "../../clients/permits.js";
import type { RunRow } from "../../domain/runs.js";
import { campaignSnapshots } from "../../ledger/health.js";
import { Overlap, SIZE_ACROSS_CLIENTS, SIZE_WITHIN_CLIENT } from "../../lib/concurrency.js";
import { runTargetCampaignIds } from "../../recipes/campaigns.js";
import { recipeAuthorises, type GetleadsSource, type MapsSource, type PermitsSource, type Recipe } from "../../recipes/schema.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, park, type StageDeps, type StageOutcome } from "../common.js";
import { routeSize, type SizeLeaf, type SizeSegment } from "../pull/route.js";
import { recycleDays } from "../suppress/recycle.js";
import { combineSizeLine, listCountLine, type CountUnit, type SegmentMeasure, type UnitTotal } from "./combine.js";
import { sizeReport } from "./report.js";

/**
 * Step 2 — Size it (skill lead-list-build; skill tam-sizing; D29, D33).
 *
 * Classify each target campaign's ICP first. LinkedIn-native: getleads `count_contacts` is the
 * free second opinion; AI Ark People Preview is the default primary and is
 * not a leadtopup client yet (D22), so the run says so. Physical maps
 * lists use pipeline_stats `scoped_businesses`. Permit lists use
 * metrics_monthly `total_permits`. Those units are not added together
 * and are not a getleads number. Partition-check a getleads filter. Subtract emails this
 * client sent in the last recycle_after_days (default 90; D35 item 2)
 * and anyone already in a live campaign of this client (D36 item 2).
 * Report the five tam-sizing lines.
 *
 * This step always recounts. Backfill receipts (`claude_backfill`,
 * `claude_backfill_build`) stored the old export in `rows_found` and left
 * `tam_count` blank — never treat either as TAM (D33).
 */
export interface SizeDeps extends StageDeps {
  getleads: Getleads;
  rails: SpendRails;
  maps: MapsStats | null;
  permits: PermitCounts | null;
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
  /** Lists of one client overlap. Lists of other clients overlap those. */
  private readonly overlap = new Overlap(SIZE_WITHIN_CLIENT, SIZE_ACROSS_CLIENTS);

  constructor(private readonly d: SizeDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "size", "sizing", async (attempts) => {
      const campaignIds = await runTargetCampaignIds(this.d.repo, run, recipe);
      const routed = routeSize(recipe, campaignIds);
      if (routed.kind === "park") {
        await this.d.repo.failStep(run.run_id, "size", routed.reason, true);
        return park(this.d, run, "size", routed.reason, attempts);
      }
      if (routed.kind === "skip") {
        return finish(this.d, run, "size", 0, { size_sources: 0 }, routed.line);
      }
      if (routed.kind === "combine") {
        return this.combineLists(run, recipe, routed.segments, campaignIds, attempts);
      }
      if (routed.kind === "maps" || routed.kind === "permits") {
        const label = routed.kind === "maps" ? (routed.source.params.categories[0] ?? "maps") : (routed.source.params.permit_types[0] ?? "permits");
        return this.combineLists(run, recipe, [{ label, campaignIds, route: routed }], campaignIds, attempts);
      }
      const params = routed.source.params;
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

      const days = recycleDays(recipe.suppression.recycle_after_days);
      const held = await this.alreadyHeld(recipe.smartlead_client_id, campaignIds, days, recipe.suppression.exclude_other_live_campaigns);
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
        recycle_after_days: days,
      };

      if (!partition.ok) {
        await this.d.repo.finishStep(run.run_id, "size", { useful_output: 0, counts });
        return gateUnmet("size", `the band filter does not bind: ${partition.bands} (bands) + ${partition.others} (other bands) ≠ ${partition.all} (no band filter), off by ${partition.diff}. The count cannot be trusted (tam-sizing).`, counts);
      }
      if (netNew < recipe.size.useful_floor) {
        // Thin: count the widening options; Josh decides. Never widen unasked.
        const widening: string[] = [];
        for (const [i, w] of routed.source.widening_candidates.entries()) {
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
      const filter = `getleads count_contacts; bands ${params.company_size.join(", ")}; titles ${params.job_titles.length}`;
      const report = sizeReport({
        number: segment.total_matching,
        filter,
        partition,
        secondVendor: "AI Ark People Preview is not a leadtopup client yet (D22); getleads is the free second opinion tam-sizing always wants",
        agree: null,
        netNew,
        held: held.count,
        costUsd: "$0.00",
      });
      const plan =
        need === null
          ? `campaign mirror has no sends in the window, so the pull plans the recipe's max_per_run (${planRows})`
          : `campaigns need ${need} rows for ${recipe.runway.target_days} days; the pull plans ${planRows}`;
      const line = `Size done (linkedin_native, ${campaignIds.length} campaign(s)):\n${report}\n${plan}.${held.note ? ` ${held.note}` : ""}`;
      return finish(this.d, run, "size", netNew, counts, line);
    });
  }

  /**
   * Each segment is its own list. getleads, maps, and permit lists are
   * counted in their own units. A list this build cannot count stays out.
   * Totals are reported only when every list was counted. Held addresses
   * are subtracted once, and only from a people total.
   */
  private async combineLists(run: RunRow, recipe: Recipe, segments: SizeSegment[], campaignIds: number[], attempts: number): Promise<StageOutcome> {
    const rows = await Promise.all(segments.map((seg) => this.measureSegment(run, recipe, seg)));
    const measures = rows.map((row) => row.measure);
    const perList = rows.flatMap((row) => (row.partition ? [{ label: row.measure.label, total: row.measure.total, partition: row.partition }] : []));

    const combined = combineSizeLine(measures);
    if (combined.kind === "incomplete") {
      await this.d.repo.failStep(run.run_id, "size", combined.text, true);
      return park(this.d, run, "size", combined.text, attempts);
    }

    const people = combined.units.find((unit) => unit.unit === "people");
    const physical = combined.units.some((unit) => unit.unit === "businesses" || unit.unit === "permits");
    if (!physical) {
      return this.finishPeople(run, recipe, segments, campaignIds, attempts, people?.total ?? 0, perList, measures);
    }
    return this.finishPhysical(run, recipe, campaignIds, measures, combined.units);
  }

  /** People lists only. Held addresses come off once. The useful floor applies. */
  private async finishPeople(
    run: RunRow,
    recipe: Recipe,
    segments: SizeSegment[],
    campaignIds: number[],
    _attempts: number,
    total: number,
    perList: Array<{ label: string; total: number; partition: Partition }>,
    _measures: SegmentMeasure[],
  ): Promise<StageOutcome> {
    const days = recycleDays(recipe.suppression.recycle_after_days);
    const held = await this.alreadyHeld(recipe.smartlead_client_id, campaignIds, days, recipe.suppression.exclude_other_live_campaigns);
    const netNew = Math.max(0, total - held.count);
    const snaps = await campaignSnapshots(this.d.repo.raw(), campaignIds).catch(() => []);
    const need = rowsNeeded(snaps, recipe.runway.target_days, 7);
    const planRows = Math.max(1, Math.min(recipe.runway.max_per_run, need === null ? recipe.runway.max_per_run : Math.max(need, recipe.size.useful_floor), Math.max(netNew, 1)));
    const counts: Record<string, number> = {
      total_matching: total,
      projected_net_new: netNew,
      already_held: held.count,
      useful_floor: recipe.size.useful_floor,
      rows_needed: need ?? 0,
      plan_rows: planRows,
      size_sources: segments.length,
      recycle_after_days: days,
    };
    perList.forEach((list, i) => {
      counts[`segment_${i + 1}_total`] = list.total;
    });

    if (netNew < recipe.size.useful_floor) {
      await this.d.repo.finishStep(run.run_id, "size", { useful_output: 0, counts });
      return gateUnmet(
        "size",
        `combined projected net new ${netNew} is under the useful floor ${recipe.size.useful_floor} (${total} matching across ${segments.length} segment lists, ${held.count} already sent). Josh decides; nothing widens on its own.`,
        counts,
      );
    }

    const partition = perList.reduce(
      (acc, list) => ({
        bands: acc.bands + list.partition.bands,
        others: acc.others + list.partition.others,
        all: acc.all + list.partition.all,
        diff: acc.diff + list.partition.diff,
        ok: acc.ok && list.partition.ok,
      }),
      { bands: 0, others: 0, all: 0, diff: 0, ok: true },
    );
    const report = sizeReport({
      number: total,
      filter: `${segments.length} segment lists combined: ${perList.map((l) => `${l.label} ${l.total}`).join("; ")}`,
      partition,
      secondVendor: "AI Ark People Preview is not a leadtopup client yet (D22); getleads is the free second opinion tam-sizing always wants",
      agree: null,
      netNew,
      held: held.count,
      costUsd: "$0.00",
    });
    const detail = perList.map((l) => `${l.label}: ${l.total} matching`).join("\n");
    const plan =
      need === null
        ? `campaign mirror has no sends in the window, so the pull plans the recipe's max_per_run (${planRows})`
        : `campaigns need ${need} rows for ${recipe.runway.target_days} days; the pull plans ${planRows}`;
    const line = `Size done (${segments.length} segment lists combined):\n${detail}\n${report}\n${plan}.${held.note ? ` ${held.note}` : ""}`;
    return finish(this.d, run, "size", netNew, counts, line);
  }

  /**
   * Maps businesses and permit counts stay apart. Held emails are not
   * subtracted. The people useful-floor does not gate this result.
   */
  private async finishPhysical(
    run: RunRow,
    recipe: Recipe,
    campaignIds: number[],
    measures: SegmentMeasure[],
    units: UnitTotal[],
  ): Promise<StageOutcome> {
    const businesses = units.find((unit) => unit.unit === "businesses")?.total ?? 0;
    const permitTotal = units.find((unit) => unit.unit === "permits")?.total ?? 0;
    const people = units.find((unit) => unit.unit === "people");
    const hasMaps = units.some((unit) => unit.unit === "businesses");
    const hasPermits = units.some((unit) => unit.unit === "permits");
    let peopleNet = people?.total ?? 0;
    let heldNote: string | null = null;
    if (people) {
      const days = recycleDays(recipe.suppression.recycle_after_days);
      const held = await this.alreadyHeld(recipe.smartlead_client_id, campaignIds, days, recipe.suppression.exclude_other_live_campaigns);
      peopleNet = Math.max(0, people.total - held.count);
      heldNote = held.note;
    }
    const counts: Record<string, number> = {
      businesses,
      permit_total: permitTotal,
      size_sources: measures.length,
    };
    if (people) {
      counts.people_matching = people.total;
      counts.projected_net_new = peopleNet;
    }
    measures.forEach((list, i) => {
      if (list.counted) counts[`segment_${i + 1}_total`] = list.total;
    });
    const dfw = recipe.source.kind === "mixed" && recipe.source.note.includes("Counts use TX because the receipt geo is DFW.");
    const lines = [
      `Size done (${measures.length} lists counted by unit):`,
      ...measures.map(listCountLine),
      hasMaps ? `Maps businesses: ${businesses}` : null,
      hasPermits ? `Permits: ${permitTotal}` : null,
      people ? `People: ${people.total} matching, ${peopleNet} net new` : null,
      "Maps businesses and permit counts stay separate.",
      dfw ? "Counts use TX because the receipt geo is DFW." : null,
      heldNote,
      "Cost of sizing: $0.00",
    ].filter((line): line is string => Boolean(line));
    return finish(this.d, run, "size", hasMaps ? businesses : 0, counts, lines.join("\n"));
  }

  /** One list. Vendor calls take a slot so this client's other lists, and other clients, overlap. */
  private async measureSegment(
    run: RunRow,
    recipe: Recipe,
    seg: SizeSegment,
  ): Promise<{ measure: SegmentMeasure; partition?: Partition }> {
    const unit = unitFor(seg.route);
    if (seg.route.kind === "park") {
      return { measure: { label: seg.label, unit, counted: false, total: 0, detail: null, reason: seg.route.reason } };
    }
    if (seg.route.kind === "skip") {
      return { measure: { label: seg.label, unit, counted: true, total: 0, detail: null, reason: null }, partition: { bands: 0, others: 0, all: 0, diff: 0, ok: true } };
    }
    if (seg.route.kind === "maps") {
      const source = seg.route.source;
      const measured = await this.overlap.run(run.client_tag, () => this.measureMaps(run, recipe, source));
      return {
        measure: measured.ok
          ? { label: seg.label, unit: "businesses", counted: true, total: measured.total, detail: measured.detail, reason: null }
          : { label: seg.label, unit: "businesses", counted: false, total: 0, detail: null, reason: measured.reason },
      };
    }
    if (seg.route.kind === "permits") {
      const source = seg.route.source;
      const measured = await this.overlap.run(run.client_tag, () => this.measurePermits(run, recipe, source));
      return {
        measure: measured.ok
          ? { label: seg.label, unit: "permits", counted: true, total: measured.total, detail: measured.detail, reason: null }
          : { label: seg.label, unit: "permits", counted: false, total: 0, detail: null, reason: measured.reason },
      };
    }
    const source = seg.route.source;
    const measured = await this.overlap.run(run.client_tag, () => this.measureGetleads(run, recipe, source));
    if (!measured.ok) {
      return { measure: { label: seg.label, unit: "people", counted: false, total: 0, detail: null, reason: measured.reason } };
    }
    return {
      measure: { label: seg.label, unit: "people", counted: true, total: measured.total, detail: null, reason: null },
      partition: measured.partition,
    };
  }

  /** One category. Several states are counted and summed. No state means the count is not limited to one. */
  private async measureMaps(
    run: RunRow,
    recipe: Recipe,
    source: MapsSource,
  ): Promise<{ ok: true; total: number; detail: string } | { ok: false; reason: string }> {
    if (!recipeAuthorises(recipe, "size", "maps")) return { ok: false, reason: "the recipe does not authorise a maps count on this lane" };
    if (!this.d.maps) return { ok: false, reason: "MAPS_MCP_URL is not configured" };
    if (source.params.categories.length !== 1) return { ok: false, reason: "a maps list is one category" };
    const category = source.params.categories[0]!;
    const states = stateCodes(source.params.states);
    try {
      if (states.length === 0) {
        const n = await this.d.maps.scopedBusinesses({ category, clientTag: run.client_tag });
        await this.recordCount(run, "maps", n);
        return { ok: true, total: n, detail: "(not limited to a state)" };
      }
      const counts = await Promise.all(states.map((state) => this.d.maps!.scopedBusinesses({ category, state, clientTag: run.client_tag })));
      for (const n of counts) await this.recordCount(run, "maps", n);
      return { ok: true, total: counts.reduce((sum, n) => sum + n, 0), detail: `in ${states.join(", ")}` };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  /** One permit type. A missing state is not counted. `months` is left to the API default. */
  private async measurePermits(
    run: RunRow,
    recipe: Recipe,
    source: PermitsSource,
  ): Promise<{ ok: true; total: number; detail: string } | { ok: false; reason: string }> {
    if (!recipeAuthorises(recipe, "size", "permitstack")) {
      return { ok: false, reason: "the recipe does not authorise a permit count on this lane" };
    }
    if (!this.d.permits) return { ok: false, reason: "PERMITSTACK_MCP_URL is not configured" };
    if (source.params.permit_types.length !== 1) return { ok: false, reason: "a permit list is one permit type" };
    const category = source.params.permit_types[0]!;
    const states = stateCodes(source.params.states);
    if (states.length === 0) return { ok: false, reason: "permit count needs a state on the receipt" };
    try {
      const counts = await Promise.all(states.map((state) => this.d.permits!.monthlyTotal({ category, state })));
      for (const counted of counts) await this.recordCount(run, "permitstack", counted.total);
      const months = counts.find((counted) => counted.months)?.months ?? null;
      const window = months ? ` over ${months} months` : "";
      return { ok: true, total: counts.reduce((sum, counted) => sum + counted.total, 0), detail: `in ${states.join(", ")}${window}` };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  private async recordCount(run: RunRow, vendor: "maps" | "permitstack", rows: number): Promise<void> {
    await this.d.rails.record({
      runId: run.run_id,
      clientTag: run.client_tag,
      step: "size",
      vendor,
      action: "count",
      rows,
      credits: 0,
      worstCaseCents: 0,
      balanceBefore: null,
      balanceAfter: null,
      vendorJobId: null,
      approvedBy: null,
    });
  }

  /** One getleads list: three counts and the partition check. Does not finish the step. */
  private async measureGetleads(
    run: RunRow,
    recipe: Recipe,
    source: GetleadsSource,
  ): Promise<{ ok: true; total: number; partition: Partition } | { ok: false; reason: string }> {
    if (!recipeAuthorises(recipe, "size", "getleads")) {
      return { ok: false, reason: "the recipe does not authorise a getleads count on this lane" };
    }
    const params = source.params;
    const filters = params as GetleadsFilters;
    const count = async (f: GetleadsFilters) => {
      const r = await this.d.getleads.count(f);
      await this.d.rails.record({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "size",
        vendor: "getleads",
        action: "count",
        rows: r.total_matching,
        credits: 0,
        worstCaseCents: 0,
        balanceBefore: null,
        balanceAfter: null,
        vendorJobId: null,
        approvedBy: null,
      });
      return r;
    };
    const { company_size: _omit, ...withoutBand } = filters;
    const [segment, others, all] = await Promise.all([
      count(filters),
      count({ ...filters, company_size: bandComplement(params.company_size) as GetleadsFilters["company_size"] }),
      count(withoutBand as GetleadsFilters),
    ]);
    const partition = partitionCheck(segment.total_matching, others.total_matching, all.total_matching, recipe.size.partition_tolerance);
    if (!partition.ok) {
      return {
        ok: false,
        reason: `the band filter does not bind: ${partition.bands} (bands) + ${partition.others} (other bands) ≠ ${partition.all} (no band filter), off by ${partition.diff}`,
      };
    }
    return { ok: true, total: segment.total_matching, partition };
  }

  /** Distinct addresses this client sent in the recycle window, plus live-campaign holds (D36). Matches step 5. */
  private async alreadyHeld(clientId: number, campaignIds: number[], days: number, excludeLive: boolean): Promise<{ count: number; note: string | null }> {
    if (campaignIds.length === 0) return { count: 0, note: "this run targets no campaigns, so nothing was subtracted" };
    const db = this.d.repo.raw();
    const { rows: has } = await db.query<{ leads: boolean; sends: boolean; staging: boolean; campaigns: boolean }>(
      `select to_regclass('public.leads') is not null as leads, to_regclass('public.sends') is not null as sends,
              to_regclass('public.leads_staging') is not null as staging, to_regclass('public.campaigns') is not null as campaigns`,
    );
    if (!has[0].leads || !has[0].sends) {
      return { count: 0, note: "no public.leads/sends mirror here; nothing was subtracted" };
    }
    const live = excludeLive && has[0].campaigns;
    const { rows } = await db.query<{ n: string }>(
      `select count(distinct e)::text as n from (
         select lower(l.email) as e
         from public.leads l
         join public.sends s on s.lead_id = l.id
         where l.smartlead_client_id = $1 and l.email is not null
           and s.sent and s.sent_at is not null
           and s.sent_at >= now() - ($2::int * interval '1 day')
         ${live ? `union
         select lower(l.email) as e
         from public.leads l
         join public.campaigns c on c.id = l.campaign_id
         where l.smartlead_client_id = $1 and l.email is not null
           and upper(coalesce(c.status, '')) not in ('STOPPED', 'COMPLETED')` : ""}
         ${live && has[0].staging ? `union
         select lower(st.email) as e
         from public.leads_staging st
         join public.campaigns c on c.smartlead_campaign_id = st.campaign_id
         where c.smartlead_client_id = $1 and st.email is not null
           and upper(coalesce(c.status, '')) not in ('STOPPED', 'COMPLETED')` : ""}
       ) x`,
      [clientId, days],
    );
    return {
      count: Number(rows[0]?.n ?? 0),
      note: excludeLive
        ? `subtracted addresses this client sent in the last ${days} days, plus anyone already in a live campaign`
        : `subtracted addresses this client sent in the last ${days} days`,
    };
  }
}

function unitFor(route: SizeLeaf): CountUnit {
  if (route.kind === "maps") return "businesses";
  if (route.kind === "permits") return "permits";
  return "people";
}

function stateCodes(states: string[] | undefined): string[] {
  return [...new Set((states ?? []).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))];
}

function describeWidening(w: { company_size?: string[]; add_titles?: string[]; states?: string[]; industries?: string[] }): string {
  const bits: string[] = [];
  if (w.company_size) bits.push(`add bands ${w.company_size.join(", ")}`);
  if (w.add_titles) bits.push(`add titles ${w.add_titles.join(", ")}`);
  if (w.states) bits.push(`states ${w.states.join(", ")}`);
  if (w.industries) bits.push(`industries ${w.industries.join(", ")}`);
  return bits.join(" + ") || "unchanged";
}
