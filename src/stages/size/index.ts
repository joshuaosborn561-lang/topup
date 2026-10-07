import { type Getleads, type GetleadsFilters } from "../../clients/getleads.js";
import type { MapsStats } from "../../clients/mapsStats.js";
import type { PermitCounts } from "../../clients/permits.js";
import type { RunRow } from "../../domain/runs.js";
import { campaignSnapshots } from "../../ledger/health.js";
import { Overlap, SIZE_ACROSS_CLIENTS, SIZE_WITHIN_CLIENT } from "../../lib/concurrency.js";
import { logger } from "../../lib/log.js";
import { runTargetCampaignIds } from "../../recipes/campaigns.js";
import { countSlices, loadGeoFenceCities } from "../../recipes/geoFence.js";
import { recipeAuthorises, type GetleadsSource, type MapsSource, type PermitsSource, type Recipe } from "../../recipes/schema.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, park, type StageDeps, type StageOutcome } from "../common.js";
import { campaignSizeRoutes, type SizeLeaf, type SizeRoute, type SizeSegment } from "../pull/route.js";
import { recycleDays } from "../suppress/recycle.js";
import { combineSizeLine, listCountLine, type CountUnit, type SegmentMeasure, type UnitTotal } from "./combine.js";
import { sizeReport } from "./report.js";

const log = logger("size");

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
  /** Records with a null, unknown, or unlisted band. They are in the unfiltered total and in neither bucket. */
  unknown: number;
  all: number;
  diff: number;
  ok: boolean;
}

/**
 * tam-sizing: count(bands) + count(other bands) + unknown band == count(no filter).
 * A gap is the unknown-band bucket, not a broken filter. Overlap past the
 * tolerance means the band filter double-counted and the count cannot be trusted.
 */
export function partitionCheck(bands: number, others: number, all: number, tolerance: number): Partition {
  const unknown = all - bands - others;
  const overlap = Math.max(0, -unknown);
  const diff = Math.abs(unknown);
  const tol = all === 0 ? 0 : Math.max(1, Math.ceil(all * tolerance));
  const ok = all === 0 ? bands + others === 0 : overlap <= tol;
  return { bands, others, unknown, all, diff, ok };
}

/** tam-sizing: two sources agree when they are within `within` of the larger. */
/**
 * A positive unknown bucket is part of the total, so the count stands.
 * Overlap parks for the operator. It does not ask Josh.
 */
export function bandMismatchReason(partition: Partition): string | null {
  if (partition.ok) return null;
  return `the band filter overlaps: ${partition.bands} (bands) + ${partition.others} (other bands) exceed ${partition.all} (no band filter) by ${partition.diff}. The count cannot be trusted (tam-sizing).`;
}

/**
 * Records outside the in-ICP bands, including a null or unknown band.
 * This is the unfiltered total minus the in-band count. A complement
 * query is not used: an empty complement is sent as no filter, so
 * "other bands" comes back equal to the total and the check can never pass.
 */
export function outsideBandCount(all: number, inBand: number): number {
  return Math.max(0, all - inBand);
}

/**
 * Size from the in-band count. Other bands are the rest of the total, so
 * a null band sits inside "other" and the buckets add up. If they still
 * do not, keep the in-band count and warn. Do not park the run.
 */
export function bandSizeDecision(
  inBand: number,
  all: number,
  tolerance: number,
): { total: number; partition: Partition; warning: string | null } {
  const others = outsideBandCount(all, inBand);
  const partition = partitionCheck(inBand, others, all, tolerance);
  return { total: inBand, partition, warning: bandMismatchReason(partition) };
}

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
      return this.sizeEach(run, recipe, campaignIds, attempts);
    });
  }

  /**
   * One TAM and one requested count per target campaign. A lane with
   * several campaigns does not collapse them. A campaign that cannot be
   * sized is skipped and named. The run parks only when none remain.
   * An unknown headcount band is part of the total, not a Josh gate.
   */
  private async sizeEach(run: RunRow, recipe: Recipe, campaignIds: number[], attempts: number): Promise<StageOutcome> {
    if (campaignIds.length === 0) {
      const reason = "no target campaigns to size";
      await this.d.repo.failStep(run.run_id, "size", reason, true);
      return park(this.d, run, "size", reason, attempts);
    }
    const snaps = await campaignSnapshots(this.d.repo.raw(), campaignIds).catch(() => []);
    const counts: Record<string, number> = { size_sources: 0 };
    const lines: string[] = [];
    const pre = skippedSizeRoutes(recipe, campaignIds);
    const skipped = [...pre.skipped];
    for (const id of campaignIds) {
      if (pre.skipped.some((line) => line.startsWith(`#${id}:`))) counts[`skipped_${id}`] = 1;
    }
    let peopleNet = 0;
    let peopleCampaigns = 0;
    let sized = 0;
    for (const id of pre.run) {
      const routed = campaignSizeRoutes(recipe, [id])[0]?.route;
      if (!routed || routed.kind === "park") {
        skipped.push(`#${id}: ${routed && routed.kind === "park" ? routed.reason : "no size route"}`);
        counts[`skipped_${id}`] = 1;
        continue;
      }
      if (routed.kind === "skip") {
        counts[`tam_${id}`] = 0;
        counts[`plan_rows_${id}`] = 0;
        lines.push(`#${id}: nothing to count`);
        sized += 1;
        continue;
      }
      const segments = segmentsFor(routed, id);
      const rows = await Promise.all(segments.map((seg) => this.measureSegment(run, recipe, seg)));
      const bad = rows.filter((row) => !row.measure.counted);
      if (bad.length) {
        skipped.push(`#${id}: ${bad.map((row) => row.measure.reason ?? "could not be counted").join("; ")}`);
        counts[`skipped_${id}`] = 1;
        continue;
      }
      const people = rows.filter((row) => row.measure.unit === "people").reduce((sum, row) => sum + row.measure.total, 0);
      const businesses = rows.filter((row) => row.measure.unit === "businesses").reduce((sum, row) => sum + row.measure.total, 0);
      const permits = rows.filter((row) => row.measure.unit === "permits").reduce((sum, row) => sum + row.measure.total, 0);
      const hasPeople = rows.some((row) => row.measure.unit === "people");
      let net = people;
      if (hasPeople) {
        const days = recycleDays(recipe.suppression.recycle_after_days);
        const held = await this.alreadyHeld(recipe.smartlead_client_id, [id], days, recipe.suppression.exclude_other_live_campaigns);
        net = Math.max(0, people - held.count);
        peopleNet += net;
        peopleCampaigns += 1;
        counts[`already_held_${id}`] = held.count;
      }
      const snap = snaps.filter((s) => s.smartlead_campaign_id === id);
      const need = rowsNeeded(snap, recipe.runway.target_days, 7);
      const cap = hasPeople ? net : Math.max(businesses, permits, people);
      const planRows = cap <= 0 ? 0 : Math.max(1, Math.min(recipe.runway.max_per_run, need === null ? recipe.runway.max_per_run : Math.max(need, 0), cap));
      const tam = hasPeople ? people : businesses > 0 ? businesses : permits;
      counts[`tam_${id}`] = tam;
      counts[`plan_rows_${id}`] = planRows;
      if (hasPeople) counts[`net_new_${id}`] = net;
      if (businesses) counts[`businesses_${id}`] = businesses;
      if (permits) counts[`permits_${id}`] = permits;
      counts.size_sources += segments.length;
      lines.push(`#${id}: TAM ${tam}, request ${planRows}`);
      sized += 1;
    }
    if (sized === 0) {
      const reason = skipped.length ? skipped.join("; ") : "no target campaigns to size";
      await this.d.repo.failStep(run.run_id, "size", reason, true);
      return park(this.d, run, "size", reason, attempts);
    }
    const planRows = campaignIds.reduce((sum, id) => sum + (counts[`plan_rows_${id}`] ?? 0), 0);
    counts.plan_rows = planRows;
    if (peopleCampaigns > 0 && peopleNet < recipe.size.useful_floor && lines.every((line) => !line.includes("businesses") && !line.includes("permits"))) {
      const physical = Object.keys(counts).some((key) => key.startsWith("businesses_") || key.startsWith("permits_"));
      if (!physical) {
        await this.d.repo.finishStep(run.run_id, "size", { useful_output: 0, counts });
        return gateUnmet(
          "size",
          `projected net new ${peopleNet} is under the useful floor ${recipe.size.useful_floor} across ${peopleCampaigns} campaign(s). Josh decides; nothing widens on its own.`,
          counts,
        );
      }
    }
    const line = [
      `Size done (${sized} campaign(s)):`,
      ...lines,
      skipped.length ? `Skipped: ${skipped.join("; ")}` : null,
      "Each campaign keeps its own TAM and requested count.",
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n");
    return finish(this.d, run, "size", peopleCampaigns > 0 ? peopleNet : (counts.plan_rows ?? 0), counts, line);
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
        unknown: acc.unknown + list.partition.unknown,
        all: acc.all + list.partition.all,
        diff: acc.diff + list.partition.diff,
        ok: acc.ok && list.partition.ok,
      }),
      { bands: 0, others: 0, unknown: 0, all: 0, diff: 0, ok: true },
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
      return { measure: { label: seg.label, unit, counted: true, total: 0, detail: null, reason: null }, partition: { bands: 0, others: 0, unknown: 0, all: 0, diff: 0, ok: true } };
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
    if (!this.d.maps) return { ok: false, reason: "missing credentials for maps" };
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
    if (!this.d.permits) return { ok: false, reason: "missing credentials for permitstack" };
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

  /** One getleads list: the in-band count and the unfiltered total. Other bands are the difference, so a null band is included. Does not finish the step. */
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
    let slices: GetleadsFilters[];
    if (filters.geo_fence) {
      try {
        const cities = await loadGeoFenceCities(this.d.repo.raw(), filters.geo_fence);
        slices = countSlices(filters, cities);
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
      if (slices.length === 0) {
        return { ok: false, reason: `geo fence ${filters.geo_fence.schema}.${filters.geo_fence.table} has no cities` };
      }
    } else {
      slices = [filters];
    }
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
    const sum = async (parts: GetleadsFilters[]) => {
      let total = 0;
      for (const part of parts) total += (await count(part)).total_matching;
      return total;
    };
    // No band on the recipe: one count per slice. Do not add a band, and do not issue a second unfiltered count.
    if (!filters.company_size?.length) {
      const total = await sum(slices);
      return { ok: true, total, partition: partitionCheck(total, 0, total, recipe.size.partition_tolerance) };
    }
    const withoutBand = slices.map((part) => {
      const { company_size: _omit, ...rest } = part;
      return rest as GetleadsFilters;
    });
    const [segmentTotal, allTotal] = await Promise.all([sum(slices), sum(withoutBand)]);
    const decision = bandSizeDecision(segmentTotal, allTotal, recipe.size.partition_tolerance);
    if (decision.warning) {
      log.warn("band partition still overlaps; sizing from the in-band count", {
        run_id: run.run_id,
        bands: decision.partition.bands,
        others: decision.partition.others,
        all: decision.partition.all,
      });
    }
    return { ok: true, total: decision.total, partition: decision.partition };
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

/** A campaign whose route parks is skipped. The others still size. */
export function skippedSizeRoutes(recipe: Recipe, campaignIds: readonly number[]): { run: number[]; skipped: string[] } {
  const run: number[] = [];
  const skipped: string[] = [];
  for (const id of campaignIds) {
    const route = campaignSizeRoutes(recipe, [id])[0]?.route;
    if (!route || route.kind === "park") {
      skipped.push(`#${id}: ${route && route.kind === "park" ? route.reason : "no size route"}`);
      continue;
    }
    run.push(id);
  }
  return { run, skipped };
}

function segmentsFor(route: SizeRoute, campaignId: number): SizeSegment[] {
  if (route.kind === "combine") return route.segments.map((seg) => ({ ...seg, campaignIds: [campaignId] }));
  if (route.kind === "park" || route.kind === "skip") return [];
  const label =
    route.kind === "maps"
      ? (route.source.params.categories[0] ?? "maps")
      : route.kind === "permits"
        ? (route.source.params.permit_types[0] ?? "permits")
        : "people";
  return [{ label, campaignIds: [campaignId], route }];
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
