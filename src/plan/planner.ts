import type { GetleadsFilters } from "../clients/getleads.js";
import { buildRecordsFromRows, chooseBuildForCampaign, strategyLine, type BuildRecord, type CampaignPerformance } from "../builds/index.js";
import type { CampaignSnapshot } from "../ledger/health.js";
import { logger } from "../lib/log.js";
import { evaluateCampaign, marketCapFor, type CampaignFacts, type CampaignVerdict } from "../policy/index.js";
import { ruleSource } from "../recipes/campaigns.js";
import { bcpPoolReport, bcpSizedTam } from "../recipes/bcp.js";
import type { Recipe, Source } from "../recipes/schema.js";
import { recycleDays } from "../stages/suppress/recycle.js";
import { buildCampaignReport, filtersWords, sourceWords, titlesWords, type CampaignReportEntry, type CampaignReportInput } from "../stages/size/campaignReport.js";
import { lanePeopleTam, netNewFromOverlap, planShares, heldMethodCode } from "../stages/size/overlap.js";
import { rowsNeeded } from "../stages/size/partition.js";
import { pilotAllowsSize, pilotExpectFor, pilotMismatchReason, recipeFingerprint, scorePilot, type PilotScore } from "../stages/size/pilot.js";
import { icpKindForClient, linkedinTamDecision, originalTamFromBuilds, type IcpKind, type LinkedinTam, type OriginalTam } from "../stages/size/tamSource.js";
import { approvalBriefing } from "./briefing.js";
import { freshness, type PoolCacheEntry, type PoolCacheReader } from "./cache.js";
import { countAiArk, countBcpAlternates, countMaps, countPeople, countPermits, heldInPool, samplePilotRows, type BcpCounts, type MeasureDeps } from "./measure.js";
import { eligibilityFor, type Eligibility } from "./facts.js";
import { poolFingerprint, poolsFor, type Pool } from "./pools.js";

const log = logger("plan");

/**
 * The size planner (D48). One run sizes every target campaign of a lane at
 * once: campaigns are judged by the policy first, the ones that qualify are
 * grouped into pools (one per distinct query), every pool is counted once
 * and concurrently, counts and pilots come from the fingerprint cache when
 * the recipe is unchanged, net new is the overlap with what the client
 * already holds, and the pool is split across its campaigns by need. Each
 * campaign ends with its own verdict and reason. One bad campaign is
 * skipped; the rest continue. Counts, labels and method text only.
 */
export interface PlannerDeps extends MeasureDeps {
  cache: PoolCacheReader;
  campaignBuilds(clientTag: string, campaignIds: number[]): Promise<Record<string, unknown>[]>;
  workingOverrides(campaignIds: readonly number[]): Promise<Map<number, boolean | null>>;
  clientIcpKind(clientTag: string): Promise<IcpKind>;
  snapshots(campaignIds: readonly number[]): Promise<CampaignSnapshot[]>;
  performance(campaignIds: readonly number[]): Promise<Map<number, CampaignPerformance>>;
  owners(campaignIds: readonly number[]): Promise<Map<number, number | null>>;
  loadsPaused(): Promise<boolean>;
}

export interface PlanOptions {
  /** Score the pilot sample and stop. TAM is not counted. */
  pilotOnly?: boolean;
  /** Pilot even when the fingerprint cache has a fresh score. */
  forcePilot?: boolean;
}

export interface PoolResult {
  key: string;
  kind: Pool["kind"];
  campaignIds: number[];
  fingerprint: string | null;
  cached: boolean;
  /** People pools. */
  getleads_count: number | null;
  ai_ark: { total: number | null; called: boolean; error: string | null } | null;
  linkedin: LinkedinTam | null;
  pilot: PilotScore | null;
  held: { count: number; method: number; note: string } | null;
  bcp: Map<number, BcpCounts> | null;
  partition_ok: boolean | null;
  slices: number;
  /** Physical pools. */
  businesses: number | null;
  permits: number | null;
  /** Per-campaign TAM inside this pool (BCP adds the COO fallback per campaign). */
  tam: Map<number, number>;
  net_new: number | null;
  /** Why this pool could not be counted. */
  reason: string | null;
}

export interface CampaignPlan {
  campaign_id: number;
  eligibility: Eligibility;
  verdict: CampaignVerdict;
  tam_total: number | null;
  tam_left: number | null;
  plan_rows: number;
  already_held: number;
  pool_key: string | null;
  original: OriginalTam | null;
  chosen_build: BuildRecord | null;
}

export interface SizePlan {
  campaigns: Map<number, CampaignPlan>;
  pools: PoolResult[];
  report: CampaignReportEntry[];
  /** Numbers only: the step's counts. */
  counts: Record<string, number>;
  /** Everything else the step keeps: the report, the vendor log, the pool cache, the briefing. */
  extra: Record<string, unknown>;
  /** Campaign ids a pull may take rows for. */
  qualifying: number[];
  lines: string[];
  briefing: string;
  pilotOnly: boolean;
  fingerprint: string;
}

type RunLike = { run_id: string; client_tag: string; lane: string; counts_by_status?: Record<string, number> };

function needFor(snaps: readonly CampaignSnapshot[], id: number, recipe: Recipe): number {
  const snap = snaps.filter((s) => s.smartlead_campaign_id === id);
  const need = rowsNeeded(snap, recipe.runway.target_days, 7);
  return need === null ? recipe.runway.max_per_run : Math.max(need, 0);
}

function companyFilterOf(pool: Pool | undefined): boolean {
  if (!pool) return false;
  if (pool.kind === "park") return !/no company filter/i.test(pool.reason ?? "");
  return true;
}

function cacheEntry(pool: PoolResult, now: number): PoolCacheEntry | null {
  if (pool.kind !== "people" || !pool.fingerprint) return null;
  const at = new Date(now).toISOString();
  return {
    fingerprint: pool.fingerprint,
    measured_at: at,
    getleads_count: pool.getleads_count,
    ai_ark_count: pool.ai_ark?.total ?? null,
    ai_ark_error: pool.ai_ark?.error ?? null,
    ai_ark_called: pool.ai_ark?.called ?? false,
    held: pool.held?.count ?? null,
    held_method: pool.held?.method ?? null,
    pilot: pool.pilot,
    pilot_at: pool.pilot ? at : null,
  };
}

export async function planSize(d: PlannerDeps, run: RunLike, recipe: Recipe, campaignIds: readonly number[], opts: PlanOptions = {}): Promise<SizePlan> {
  const ids = [...new Set(campaignIds)];
  const [snapshots, performance, owners, overrides, buildRows, icp, loadsPaused] = await Promise.all([
    d.snapshots(ids).catch(() => [] as CampaignSnapshot[]),
    d.performance(ids).catch(() => new Map<number, CampaignPerformance>()),
    d.owners(ids).catch(() => new Map<number, number | null>()),
    d.workingOverrides(ids).catch(() => new Map<number, boolean | null>()),
    d.campaignBuilds(run.client_tag, ids).catch(() => [] as Record<string, unknown>[]),
    d.clientIcpKind(run.client_tag).catch(() => icpKindForClient(run.client_tag)),
    d.loadsPaused().catch(() => true),
  ]);
  const builds = buildRecordsFromRows(buildRows, run.client_tag);
  const pools = poolsFor(recipe, ids);
  const poolOf = new Map<number, Pool>();
  for (const pool of pools) for (const id of pool.campaignIds) poolOf.set(id, pool);

  const eligibility = eligibilityFor({ recipe, campaignIds: ids, snapshots, performance, owners, overrides, companyFilter: (id) => companyFilterOf(poolOf.get(id)) });
  const eligible = new Set(ids.filter((id) => eligibility.get(id)?.verdict.qualifies));
  const fingerprint = recipeFingerprint(recipe);
  const pilotOnly = opts.pilotOnly === true;

  // Non-LinkedIn clients size each campaign from its stored pool; people pools do not apply to them.
  const originals = new Map<number, OriginalTam>();
  if (icp === "non_linkedin") {
    for (const id of eligible) {
      const pool = poolOf.get(id);
      if (pool && (pool.kind === "maps" || pool.kind === "permits")) continue;
      originals.set(id, originalTamFromBuilds(buildRows, id));
    }
  }

  const measured = await Promise.all(
    pools.map(async (pool): Promise<PoolResult> => {
      const live = pool.campaignIds.filter((id) => eligible.has(id) && !originals.has(id));
      const base: PoolResult = {
        key: pool.key,
        kind: pool.kind,
        campaignIds: live,
        fingerprint: pool.kind === "people" ? poolFingerprint(pool) : null,
        cached: false,
        getleads_count: null,
        ai_ark: null,
        linkedin: null,
        pilot: null,
        held: null,
        bcp: null,
        partition_ok: null,
        slices: 0,
        businesses: null,
        permits: null,
        tam: new Map(),
        net_new: null,
        reason: null,
      };
      if (live.length === 0) return { ...base, reason: pool.reason ?? "no eligible campaign in this pool" };
      if (pool.kind === "park") return { ...base, reason: pool.reason };
      if (pool.kind === "skip") {
        for (const id of live) base.tam.set(id, 0);
        return { ...base, net_new: 0 };
      }
      if (pool.kind === "maps" && pool.leaf?.kind === "maps") {
        const r = await countMaps(d, { runId: run.run_id, clientTag: run.client_tag }, recipe, pool.leaf.source);
        if (!r.ok) return { ...base, reason: r.reason };
        for (const id of live) base.tam.set(id, r.total);
        return { ...base, businesses: r.total, net_new: r.total };
      }
      if (pool.kind === "permits" && pool.leaf?.kind === "permits") {
        const r = await countPermits(d, { runId: run.run_id, clientTag: run.client_tag }, recipe, pool.leaf.source);
        if (!r.ok) return { ...base, reason: r.reason };
        for (const id of live) base.tam.set(id, r.total);
        return { ...base, permits: r.total, net_new: r.total };
      }
      return measurePeople(d, run, recipe, { ...pool, campaignIds: live }, base, opts, snapshots);
    }),
  );

  // Per-campaign plans.
  const campaigns = new Map<number, CampaignPlan>();
  const counts: Record<string, number> = { size_sources: 0, pools: measured.length, pools_cached: measured.filter((p) => p.cached).length };
  const lines: string[] = [];
  const poolByCampaign = new Map<number, PoolResult>();
  for (const pool of measured) for (const id of pool.campaignIds) poolByCampaign.set(id, pool);
  let laneTam = 0;
  let laneHeld = 0;
  let laneNet = 0;
  const peopleTams: number[] = [];

  for (const id of ids) {
    const elig = eligibility.get(id)!;
    const chosen = chooseBuildForCampaign(id, builds);
    const plan: CampaignPlan = {
      campaign_id: id,
      eligibility: elig,
      verdict: elig.verdict,
      tam_total: null,
      tam_left: null,
      plan_rows: 0,
      already_held: 0,
      pool_key: poolOf.get(id)?.key ?? null,
      original: originals.get(id) ?? null,
      chosen_build: chosen.build,
    };
    campaigns.set(id, plan);
    if (!elig.verdict.qualifies) {
      counts[`skipped_${id}`] = 1;
      lines.push(`#${id}: skipped, ${elig.verdict.gate}: ${elig.verdict.reason}`);
      continue;
    }
    if (pilotOnly) continue;
    const original = originals.get(id);
    if (original) {
      if (original.kind === "pool") {
        plan.tam_total = original.tam_total;
        plan.tam_left = original.tam_total;
        plan.plan_rows = original.tam_total <= 0 ? 0 : Math.max(1, Math.min(recipe.runway.max_per_run, needFor(snapshots, id, recipe), original.tam_total));
        counts[`tam_${id}`] = original.tam_total;
        counts[`businesses_${id}`] = original.tam_total;
        counts.size_sources += 1;
        lines.push(`#${id}: TAM ${original.tam_total} from ${original.tam_source}`);
      } else {
        lines.push(`#${id}: ${original.reason}`);
      }
      continue;
    }
    const pool = poolByCampaign.get(id);
    if (!pool || pool.reason) {
      lines.push(`#${id}: ${pool?.reason ?? "no size route"}`);
      continue;
    }
    const tam = pool.tam.get(id) ?? 0;
    plan.tam_total = tam;
    counts[`tam_${id}`] = tam;
    if (pool.businesses != null) counts[`businesses_${id}`] = pool.businesses;
    if (pool.permits != null) counts[`permits_${id}`] = pool.permits;
    if (pool.kind !== "people") {
      plan.tam_left = tam;
      plan.plan_rows = tam <= 0 ? 0 : Math.max(1, Math.min(recipe.runway.max_per_run, needFor(snapshots, id, recipe), tam));
      counts.size_sources += 1;
      lines.push(`#${id}: TAM ${tam}, request ${plan.plan_rows}`);
      continue;
    }
    peopleTams.push(tam);
    counts.size_sources += pool.slices || 1;
    const b = pool.bcp?.get(id);
    if (b) {
      counts[`pool_industry_${id}`] = pool.getleads_count ?? tam;
      counts[`tam_it_${id}`] = pool.getleads_count ?? tam;
      if (b.description != null) counts[`pool_description_${id}`] = b.description;
      if (b.both != null) counts[`pool_both_${id}`] = b.both;
      if (b.coo != null) {
        counts[`coo_fallback_${id}`] = b.coo;
        counts[`tam_coo_${id}`] = b.coo;
      }
    }
  }

  // Split each people pool's net new across its campaigns by need.
  for (const pool of measured) {
    if (pool.kind !== "people" || pool.reason || pilotOnly) continue;
    const members = pool.campaignIds.filter((id) => campaigns.get(id)?.verdict.qualifies);
    if (members.length === 0) continue;
    const tams = members.map((id) => pool.tam.get(id) ?? 0);
    const poolTam = lanePeopleTam(tams);
    const held = pool.held?.count ?? 0;
    const net = netNewFromOverlap(poolTam, held);
    const needs = members.map((id) => needFor(snapshots, id, recipe));
    const shares = planShares(net, needs);
    const heldShares = planShares(held, members.map(() => Math.max(held, 1)));
    laneTam += poolTam;
    laneHeld += held;
    laneNet += net;
    pool.net_new = net;
    members.forEach((id, i) => {
      const plan = campaigns.get(id)!;
      plan.plan_rows = Math.min(recipe.runway.max_per_run, shares[i] ?? 0);
      plan.tam_left = net;
      plan.already_held = heldShares[i] ?? 0;
      counts[`plan_rows_${id}`] = plan.plan_rows;
      counts[`net_new_${id}`] = plan.plan_rows;
      counts[`already_held_${id}`] = plan.already_held;
      lines.push(`#${id}: TAM ${plan.tam_total ?? 0}, pool net new ${net}, request ${plan.plan_rows}`);
    });
  }
  if (peopleTams.length) {
    counts.lane_tam = laneTam;
    counts.already_held = laneHeld;
    counts.projected_net_new = laneNet;
    const method = measured.find((p) => p.kind === "people" && p.held)?.held?.method;
    if (method != null) counts.held_method = method;
  }

  // Final verdicts with the sizing facts, and the report.
  const aiArkErrors: string[] = [];
  let aiArkCalled = false;
  for (const pool of measured) {
    if (pool.ai_ark?.called) aiArkCalled = true;
    if (pool.ai_ark?.error && !aiArkErrors.includes(pool.ai_ark.error)) aiArkErrors.push(pool.ai_ark.error);
  }
  if (icp === "linkedin_native" && !pilotOnly) counts.ai_ark_called = aiArkCalled ? 1 : 0;

  const names = new Map(snapshots.map((s) => [s.smartlead_campaign_id, s.name ?? ""]));
  const rows: CampaignReportInput[] = [];
  for (const id of ids) {
    const plan = campaigns.get(id)!;
    const pool = poolByCampaign.get(id) ?? null;
    const rule = recipe.routing.find((item) => item.campaign_id === id);
    const source: Source = rule ? ruleSource(recipe, rule) : recipe.source;
    const perf = performance.get(id);
    const words = sourceWords(source);
    const marketCap = marketCapFor(recipe.lane, words);
    const rowsFound = plan.chosen_build?.rows_found ?? null;
    const decision = pool?.linkedin ?? null;
    const sized = plan.tam_total != null;
    const tamCheck = plan.original?.kind === "missing" ? "tam_source_missing" : plan.original?.kind === "pool" ? "ok" : decision?.tam_check ?? null;
    const facts: CampaignFacts = {
      ...plan.eligibility.facts,
      ...(sized ? { sized: true, tam_total: plan.tam_total, tam_left: plan.tam_left } : {}),
      ...(tamCheck ? { tam_check: tamCheck } : {}),
      ...(pool?.pilot ? { pilot: { gate: pool.pilot.gate, failed: pool.pilot.failed, rows_scored: pool.pilot.rows_scored } } : {}),
      rows_found_last_build: rowsFound,
      market_cap: marketCap,
    };
    const judged = plan.eligibility.verdict.qualifies ? evaluateCampaign(facts) : plan.eligibility.verdict;
    const notSized = plan.eligibility.verdict.qualifies && !pilotOnly && !sized && tamCheck !== "tam_source_missing" && judged.gate === "ok";
    const finalVerdict: CampaignVerdict = notSized
      ? { ...judged, gate: "not_sized", qualifies: false, reason: `#${id}: not sized: ${pool?.reason ?? "no size route"}` }
      : judged;
    plan.verdict = finalVerdict;
    if (!finalVerdict.qualifies && !pilotOnly) counts[`skipped_${id}`] = 1;
    const b = pool?.bcp?.get(id);
    const poolNote = b
      ? bcpPoolReport({ industry: pool?.getleads_count ?? null, description: b.description, both: b.both, coo: b.coo, rows_found: rowsFound })
      : undefined;
    rows.push({
      campaign_id: id,
      campaign_name: names.get(id) || `campaign ${id}`,
      client_tag: run.client_tag,
      lane: recipe.lane,
      status: snapshots.find((s) => s.smartlead_campaign_id === id)?.status ?? null,
      working_override: overrides.get(id) ?? null,
      found: pilotOnly ? null : plan.tam_total,
      to_add: finalVerdict.qualifies ? plan.plan_rows : 0,
      source: words,
      titles: titlesWords(source, rule?.icp.persona ?? "persona not set"),
      filters: filtersWords(source),
      tam_total: pilotOnly ? null : plan.tam_total,
      tam_left: pilotOnly ? null : plan.tam_left,
      sends: perf?.sends ?? 0,
      interested: perf?.positives ?? 0,
      too_early: (perf?.sends ?? 0) < recipe.working.variant_min_sends,
      paused: false,
      verdict: pilotOnly ? undefined : { gate: finalVerdict.gate, reason: finalVerdict.reason },
      rows_found: rowsFound,
      market_cap: marketCap,
      strategy: pilotOnly ? "Pilot only. TAM was not sized. Nothing was loaded." : strategyLine(plan.chosen_build, recipe.recipe_id),
      pilot_only: pilotOnly,
      not_sized: !pilotOnly && !sized,
      pilot_failed: pool?.pilot != null && pool.pilot.gate !== "ok",
      ...(plan.original?.tam_source ? { tam_source: plan.original.tam_source } : decision?.tam_source ? { tam_source: decision.tam_source } : {}),
      ...(tamCheck ? { tam_check: tamCheck } : {}),
      ...(decision ? { getleads_count: decision.getleads_count, ai_ark_count: decision.ai_ark_count } : {}),
      ...(b ? { pool_industry: pool?.getleads_count ?? null, pool_description: b.description, pool_both: b.both, coo_fallback_count: b.coo, tam_it: pool?.getleads_count ?? null, tam_coo: b.coo } : {}),
      ...(poolNote ? { pool_note: poolNote } : {}),
      ...(pool?.pilot ? { pilot: pool.pilot } : {}),
    });
  }
  const report = buildCampaignReport(rows);
  const qualifying = pilotOnly ? [] : ids.filter((id) => campaigns.get(id)?.verdict.qualifies);
  counts.campaigns_ok = report.filter((r) => r.gate === "ok").length;
  counts.campaigns_skipped = report.length - counts.campaigns_ok;
  counts.plan_rows = qualifying.reduce((sum, id) => sum + (campaigns.get(id)?.plan_rows ?? 0), 0);
  for (const id of qualifying) counts[`plan_rows_${id}`] = campaigns.get(id)!.plan_rows;
  if (pilotOnly) counts.pilot_only = 1;
  Object.assign(counts, d.log.summary());

  const poolCache: Record<string, PoolCacheEntry> = {};
  for (const pool of measured) {
    const entry = cacheEntry(pool, d.now());
    if (entry) poolCache[entry.fingerprint] = entry;
  }
  const briefing = approvalBriefing({ clientTag: run.client_tag, lane: recipe.lane, runId: run.run_id, rows: report, loadsPaused, worstCaseUsd: null });
  const extra: Record<string, unknown> = {
    campaign_report: report,
    recipe_fingerprint: fingerprint,
    pilot_gate: report.some((r) => r.gate === "pilot_mismatch") ? "pilot_mismatch" : "ok",
    vendor_calls: d.log.calls,
    pool_cache: poolCache,
    verdicts: Object.fromEntries(report.map((r) => [r.campaign_id, { gate: r.gate, reason: r.gate_reason ?? "" }])),
    briefing,
    ...(aiArkErrors.length ? { ai_ark_error: aiArkErrors.join(" | ") } : {}),
  };
  const head = pilotOnly
    ? `Pilot done (${measured.filter((p) => p.pilot).length} pool(s) scored). TAM was not sized. Nothing was loaded.`
    : `Size done: ${counts.campaigns_ok} of ${ids.length} campaign(s) qualify across ${measured.filter((p) => p.campaignIds.length).length} pool(s), ${counts.pools_cached} from cache, ${d.log.calls.length} vendor call(s).`;
  return {
    campaigns,
    pools: measured,
    report,
    counts,
    extra,
    qualifying,
    lines: [head, ...lines, ...(peopleTams.length ? [`Lane TAM ${laneTam}, held ${laneHeld}, net new ${laneNet}. Each pool is split across its campaigns by need; the plan never exceeds the pool.`] : [])],
    briefing,
    pilotOnly,
    fingerprint,
  };
}

/** One people pool: pilot (cached or fresh), the two counts, BCP alternates, the held overlap. */
async function measurePeople(d: PlannerDeps, run: RunLike, recipe: Recipe, pool: Pool, base: PoolResult, opts: PlanOptions, snapshots: readonly CampaignSnapshot[]): Promise<PoolResult> {
  const filters = pool.filters as GetleadsFilters;
  const ledger = { runId: run.run_id, clientTag: run.client_tag };
  const fingerprint = base.fingerprint!;
  const hit = await d.cache.read(run.client_tag, fingerprint).catch(() => null);
  const fresh = hit ? freshness(hit.entry, d.now()) : { counts_fresh: false, pilot_fresh: false };
  const out: PoolResult = { ...base, tam: new Map(base.tam) };

  // Pilot before sizing: a changed or never-piloted query is sampled and scored.
  let pilot: PilotScore | null = null;
  if (opts.pilotOnly || opts.forcePilot || !fresh.pilot_fresh) {
    try {
      const sample = await samplePilotRows(d, ledger, filters);
      pilot = scorePilot(sample.rows, pilotExpectFor(recipe.client_tag, recipe.lane, filters), sample.fields);
      log.info("pilot scored", { run_id: run.run_id, pool: fingerprint.slice(0, 40), rows_scored: pilot.rows_scored, gate: pilot.gate });
    } catch (err) {
      return { ...out, reason: `pilot_mismatch: the vendor sample could not be scored (${(err as Error).message.slice(0, 200)})` };
    }
  } else {
    pilot = hit!.entry.pilot;
    d.log.note({ vendor: "getleads", action: "pilot_export", ok: true, status: null, message: `pilot reused from run ${hit!.run_id.slice(0, 8)}`, rows: pilot?.rows_scored ?? null, cached: true });
  }
  out.pilot = pilot;
  if (pilot && !pilotAllowsSize(pilot)) {
    const why = pool.campaignIds.map((id) => pilotMismatchReason(id, pilot!)).filter(Boolean).join("; ");
    return { ...out, reason: why || "pilot_mismatch" };
  }
  if (opts.pilotOnly) return out;

  // Counts: cached when fresh, else measured. getleads and AI Ark run together.
  let getleadsCount: number | null = null;
  let aiArk: PoolResult["ai_ark"] = null;
  let partitionOk: boolean | null = null;
  let slices = 1;
  if (hit && fresh.counts_fresh && !opts.forcePilot && hit.entry.getleads_count != null) {
    getleadsCount = hit.entry.getleads_count;
    aiArk = { total: hit.entry.ai_ark_count, called: hit.entry.ai_ark_called, error: hit.entry.ai_ark_error };
    out.cached = true;
    d.log.note({ vendor: "getleads", action: "count", ok: true, status: null, message: `count reused from run ${hit.run_id.slice(0, 8)}`, rows: getleadsCount, cached: true });
    if (aiArk.total != null) d.log.note({ vendor: "aiark", action: "people_preview", ok: true, status: null, message: `count reused from run ${hit.run_id.slice(0, 8)}`, rows: aiArk.total, cached: true });
  } else {
    const [people, ark] = await Promise.all([countPeople(d, ledger, recipe, filters), countAiArk(d, ledger, filters)]);
    if (!people.ok) return { ...out, reason: people.reason };
    getleadsCount = people.total;
    partitionOk = people.partition.ok;
    slices = people.slices;
    aiArk = ark;
  }
  out.getleads_count = getleadsCount;
  out.ai_ark = aiArk;
  out.partition_ok = partitionOk;
  out.slices = slices;

  // BCP: the sized TAM is senior IT plus the COO fallback, per campaign.
  if (recipe.client_tag === "bcp") {
    out.bcp = new Map();
    for (const id of pool.campaignIds) {
      const b = await countBcpAlternates(d, ledger, recipe, id, filters);
      if (b) out.bcp.set(id, b);
    }
  }
  for (const id of pool.campaignIds) {
    const b = out.bcp?.get(id);
    out.tam.set(id, b ? bcpSizedTam(getleadsCount ?? 0, b.coo) : (getleadsCount ?? 0));
  }
  const itCount = getleadsCount ?? 0;
  out.linkedin = linkedinTamDecision(itCount, aiArk?.total ?? null, aiArk?.error ?? null);

  // Net new: the overlap with what the client already holds, sampled and scaled, cached when fresh.
  const poolTam = lanePeopleTam(pool.campaignIds.map((id) => out.tam.get(id) ?? 0));
  if (hit && fresh.counts_fresh && !opts.forcePilot && hit.entry.held != null && out.cached) {
    out.held = { count: Math.min(poolTam, hit.entry.held), method: hit.entry.held_method ?? heldMethodCode("sample"), note: `held count reused from run ${hit.run_id.slice(0, 8)}` };
  } else {
    const days = recycleDays(recipe.suppression.recycle_after_days);
    const held = await heldInPool(d, ledger, { clientId: recipe.smartlead_client_id, campaignIds: pool.campaignIds, days, excludeLive: recipe.suppression.exclude_other_live_campaigns, tam: poolTam, filters });
    out.held = { count: held.count, method: heldMethodCode(held.method), note: held.note };
  }
  void snapshots;
  return out;
}
