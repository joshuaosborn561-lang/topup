import { AI_ARK_TOKEN_MISSING } from "../clients/aiArkPreview.js";
import { EXPORT_DONE, EXPORT_FAILED, type Getleads, type GetleadsFilters } from "../clients/getleads.js";
import type { MapsStats } from "../clients/mapsStats.js";
import type { PermitCounts } from "../clients/permits.js";
import type { Queryable } from "../db/pool.js";
import type { RunRow } from "../domain/runs.js";
import type { Overlap } from "../lib/concurrency.js";
import { logger } from "../lib/log.js";
import { PILOT_ROWS } from "../policy/index.js";
import { countSlices, type GeoCity, type GeoFenceRef } from "../recipes/geoFence.js";
import { bcpItVertical, bcpPoolFilters, type BcpItVertical } from "../recipes/bcp.js";
import { recipeAuthorises, type MapsSource, type PermitsSource, type Recipe } from "../recipes/schema.js";
import type { SpendRails } from "../spend/rails.js";
import { bandSizeDecision, partitionCheck, type Partition } from "../stages/size/partition.js";
import { emailsFromCsv, scaleOverlap, type HeldMethod } from "../stages/size/overlap.js";
import type { PreviewPerson } from "../clients/aiArkPreview.js";
import { PILOT_EXPORT_COLUMNS, pilotSampleFromCsv, type PilotFields, type PilotRow } from "../stages/size/pilot.js";
import { planSlices, sumSlices } from "./chunk.js";
import type { VendorCallLog } from "./vendorLog.js";

const log = logger("measure");

/**
 * Every vendor touch a size makes (D48). Each call runs under the client's
 * concurrency cap, is timed into the vendor log, and writes its ledger row.
 * Counts and emails for the overlap sample stay in memory and are never
 * logged or stored.
 */
export interface MeasureDeps {
  db: Queryable;
  getleads: Getleads;
  aiArk: {
    count(filters: GetleadsFilters): Promise<{ total_matching: number }>;
    preview?(filters: GetleadsFilters, page: number, size: number): Promise<{ total_matching: number; rows: PreviewPerson[] }>;
  } | null;
  maps: MapsStats | null;
  permits: PermitCounts | null;
  rails: Pick<SpendRails, "gate" | "record">;
  loadGeo: (ref: GeoFenceRef) => Promise<GeoCity[]>;
  log: VendorCallLog;
  overlap: Overlap;
  fetchText: (url: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

type Ledgerable = { runId: string; clientTag: string };

async function recordFree(d: MeasureDeps, run: Ledgerable, vendor: string, action: string, rows: number, vendorJobId: string | null = null): Promise<void> {
  await d.rails
    .record({ runId: run.runId, clientTag: run.clientTag, step: "size", vendor, action, rows, credits: 0, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId, approvedBy: null })
    .catch((err) => log.warn("ledger row failed", { vendor, action, error: (err as Error).message }));
}

/** One getleads count for one slice, logged and ledgered. */
async function countOne(d: MeasureDeps, run: Ledgerable, filters: GetleadsFilters): Promise<number> {
  const r = await d.overlap.run(run.clientTag, () => d.log.time("getleads", "count", () => d.getleads.count(filters), (v) => v.total_matching));
  await recordFree(d, run, "getleads", "count", r.total_matching);
  return r.total_matching;
}

export interface PeopleCount {
  ok: true;
  total: number;
  partition: Partition;
  slices: number;
  sliced_by: "cities" | "industries" | "none";
}

export type PeopleCountResult = PeopleCount | { ok: false; reason: string };

/**
 * A people pool: the in-band count and, when the recipe names bands, the
 * unfiltered total so the partition check can run. Slices are planned up
 * front and counted concurrently; their counts add up.
 */
export async function countPeople(d: MeasureDeps, run: Ledgerable, recipe: Recipe, filters: GetleadsFilters): Promise<PeopleCountResult> {
  if (!recipeAuthorises(recipe, "size", "getleads")) return { ok: false, reason: "the recipe does not authorise a getleads count on this lane" };
  // Geo fences are cut into city chunks of at most 45 up front; long industry lists are cut after that.
  let geoSlices: GetleadsFilters[] = [filters];
  if (filters.geo_fence) {
    try {
      const cities = await d.loadGeo(filters.geo_fence);
      if (cities.length === 0) return { ok: false, reason: `geo fence ${filters.geo_fence.schema}.${filters.geo_fence.table} has no cities` };
      geoSlices = countSlices(filters, cities) as GetleadsFilters[];
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }
  const plans = geoSlices.map((slice) => planSlices(slice));
  const slices = plans.flatMap((p) => p.slices);
  const slicedBy: "cities" | "industries" | "none" = filters.geo_fence ? "cities" : (plans[0]?.by ?? "none");
  const sum = async (parts: GetleadsFilters[]) => sumSlices(await Promise.all(parts.map((part) => countOne(d, run, part))));
  try {
    if (!filters.company_size?.length) {
      const total = await sum(slices);
      return { ok: true, total, partition: partitionCheck(total, 0, total, recipe.size.partition_tolerance), slices: slices.length, sliced_by: slicedBy };
    }
    const withoutBand = slices.map((part) => {
      const { company_size: _omit, ...rest } = part;
      return rest as GetleadsFilters;
    });
    const [inBand, all] = await Promise.all([sum(slices), sum(withoutBand)]);
    const decision = bandSizeDecision(inBand, all, recipe.size.partition_tolerance);
    if (decision.warning) log.warn("band partition overlaps; sizing from the in-band count", { run_id: run.runId, bands: decision.partition.bands, all: decision.partition.all });
    return { ok: true, total: decision.total, partition: decision.partition, slices: slices.length, sliced_by: slicedBy };
  } catch (err) {
    return { ok: false, reason: (err as Error).message.slice(0, 300) };
  }
}

export interface AiArkResult {
  total: number | null;
  called: boolean;
  error: string | null;
}

/** The second LinkedIn-native count. Not sent when there is no client or the gate says no; the reason is kept. */
export async function countAiArk(d: MeasureDeps, run: Ledgerable, filters: GetleadsFilters): Promise<AiArkResult> {
  if (!d.aiArk) {
    d.log.note({ vendor: "aiark", action: "people_preview", ok: false, status: null, message: AI_ARK_TOKEN_MISSING, rows: null });
    return { total: null, called: false, error: AI_ARK_TOKEN_MISSING };
  }
  const decision = await d.rails.gate({ runId: run.runId, clientTag: run.clientTag, step: "size", vendor: "aiark", action: "people_preview", rows: 1, recipeAuthorised: true });
  if (decision.kind !== "proceed") {
    const error = `AI Ark count was not sent. ${decision.reason}`;
    d.log.note({ vendor: "aiark", action: "people_preview", ok: false, status: null, message: error, rows: null });
    return { total: null, called: false, error };
  }
  try {
    const counted = await d.overlap.run(run.clientTag, () => d.log.time("aiark", "people_preview", () => d.aiArk!.count(filters), (v) => v.total_matching));
    if (!Number.isFinite(counted.total_matching)) return { total: null, called: true, error: "AI Ark people preview returned no totalElements" };
    await d.rails
      .record({ runId: run.runId, clientTag: run.clientTag, step: "size", vendor: "aiark", action: "people_preview", rows: 0, credits: 1, worstCaseCents: decision.worstCaseCents, balanceBefore: null, balanceAfter: null, vendorJobId: null, approvedBy: null })
      .catch((err) => log.warn("ledger row failed", { vendor: "aiark", error: (err as Error).message }));
    return { total: counted.total_matching, called: true, error: null };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    return { total: null, called: /HTTP \d+/.test(message), error: message };
  }
}

export interface BcpCounts {
  vertical: BcpItVertical;
  description: number | null;
  both: number | null;
  coo: number | null;
  /** AI Ark count of the same COO fallback. Set only when that side wins the TAM. */
  ark_coo?: number | null;
}

/** BCP: industry-only is the IT count; description-only and both are reported beside it; the COO fallback counts toward the TAM. */
export async function countBcpAlternates(d: MeasureDeps, run: Ledgerable, recipe: Recipe, campaignId: number, filters: GetleadsFilters): Promise<BcpCounts | null> {
  if (recipe.client_tag !== "bcp") return null;
  const vertical = bcpItVertical(recipe.lane, campaignId);
  if (!vertical) return null;
  const variants = bcpPoolFilters(filters, vertical);
  const quiet = async (f: GetleadsFilters) => {
    try {
      return await countOne(d, run, f);
    } catch (err) {
      log.warn("alternate count failed", { error: (err as Error).message });
      return null;
    }
  };
  const [description, both, coo] = await Promise.all([quiet(variants.description), quiet(variants.both), quiet(variants.coo)]);
  return { vertical, description, both, coo };
}

export async function countMaps(d: MeasureDeps, run: Ledgerable, recipe: Recipe, source: MapsSource): Promise<{ ok: true; total: number; detail: string } | { ok: false; reason: string }> {
  if (!recipeAuthorises(recipe, "size", "maps")) return { ok: false, reason: "the recipe does not authorise a maps count on this lane" };
  if (!d.maps) return { ok: false, reason: "missing credentials for maps" };
  if (source.params.categories.length !== 1) return { ok: false, reason: "a maps list is one category" };
  const category = source.params.categories[0]!;
  const states = stateCodes(source.params.states);
  try {
    const one = (state?: string) =>
      d.overlap.run(run.clientTag, () => d.log.time("maps", "pipeline_stats", () => d.maps!.scopedBusinesses({ category, state, clientTag: run.clientTag }), (n) => n));
    if (states.length === 0) {
      const n = await one();
      await recordFree(d, run, "maps", "count", n);
      return { ok: true, total: n, detail: "(not limited to a state)" };
    }
    const counts = await Promise.all(states.map((state) => one(state)));
    for (const n of counts) await recordFree(d, run, "maps", "count", n);
    return { ok: true, total: sumSlices(counts), detail: `in ${states.join(", ")}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function countPermits(d: MeasureDeps, run: Ledgerable, recipe: Recipe, source: PermitsSource): Promise<{ ok: true; total: number; detail: string } | { ok: false; reason: string }> {
  if (!recipeAuthorises(recipe, "size", "permitstack")) return { ok: false, reason: "the recipe does not authorise a permit count on this lane" };
  if (!d.permits) return { ok: false, reason: "missing credentials for permitstack" };
  if (source.params.permit_types.length !== 1) return { ok: false, reason: "a permit list is one permit type" };
  const category = source.params.permit_types[0]!;
  const states = stateCodes(source.params.states);
  if (states.length === 0) return { ok: false, reason: "permit count needs a state on the receipt" };
  try {
    const counts = await Promise.all(
      states.map((state) => d.overlap.run(run.clientTag, () => d.log.time("permitstack", "metrics_monthly", () => d.permits!.monthlyTotal({ category, state }), (c) => c.total))),
    );
    for (const counted of counts) await recordFree(d, run, "permitstack", "count", counted.total);
    const months = counts.find((counted) => counted.months)?.months ?? null;
    return { ok: true, total: sumSlices(counts.map((c) => c.total)), detail: `in ${states.join(", ")}${months ? ` over ${months} months` : ""}` };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

function stateCodes(states: string[] | undefined): string[] {
  return [...new Set((states ?? []).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s)))];
}

/** Wait for a getleads export and read its CSV. The text is returned to the caller and never logged. */
async function exportText(d: MeasureDeps, run: Ledgerable, filters: GetleadsFilters, opts: { max_rows: number; columns?: string[]; max_per_company?: number }, deadlineMs: number, action: string): Promise<{ text: string; rows: number } | null> {
  const started = await d.overlap.run(run.clientTag, () => d.log.time("getleads", action, () => d.getleads.startExport(filters, opts)));
  const deadline = d.now() + deadlineMs;
  let url: string | null = null;
  let rows = 0;
  while (d.now() < deadline) {
    const status = await d.getleads.checkExport(started.export_id);
    if (EXPORT_FAILED.includes(status.job_status)) return null;
    if (status.export_url && (EXPORT_DONE.includes(status.job_status) || status.rows_exported !== null)) {
      url = status.export_url;
      rows = status.rows_exported ?? 0;
      break;
    }
    await d.sleep(2000);
  }
  if (!url) return null;
  await recordFree(d, run, "getleads", "export", rows, started.export_id);
  return { text: await d.fetchText(url), rows };
}

/**
 * 250 AI Ark rows for the same pilot scorer. Three pages (100, 100, 50),
 * one credit each. The page is mapped and dropped. Null when preview is
 * not on the client or the spend gate says no.
 */
export async function sampleAiArkPilot(d: MeasureDeps, run: Ledgerable, filters: GetleadsFilters): Promise<PilotRow[] | null> {
  const client = d.aiArk;
  if (!client?.preview) return null;
  const pages = [
    { page: 0, size: 100 },
    { page: 1, size: 100 },
    { page: 2, size: 50 },
  ];
  const decision = await d.rails.gate({
    runId: run.runId,
    clientTag: run.clientTag,
    step: "size",
    vendor: "aiark",
    action: "people_preview",
    rows: pages.length,
    recipeAuthorised: true,
  });
  if (decision.kind !== "proceed") {
    d.log.note({ vendor: "aiark", action: "people_preview", ok: false, status: null, message: `AI Ark pilot was not sent. ${decision.reason}`, rows: null });
    return null;
  }
  const rows: PilotRow[] = [];
  let credits = 0;
  try {
    for (const part of pages) {
      if (rows.length >= PILOT_ROWS) break;
      const page = await d.overlap.run(run.clientTag, () =>
        d.log.time("aiark", "people_preview", () => client.preview!(filters, part.page, part.size), (v) => v.rows.length),
      );
      credits += 1;
      for (const person of page.rows) {
        if (rows.length >= PILOT_ROWS) break;
        rows.push({
          title: person.title,
          industry: person.industry,
          description: person.description,
          company_size: person.company_size,
          employees: person.employees,
          country: person.country,
          state: person.state,
          city: person.city,
        });
      }
    }
  } finally {
    if (credits > 0) {
      await d.rails
        .record({
          runId: run.runId,
          clientTag: run.clientTag,
          step: "size",
          vendor: "aiark",
          action: "people_preview",
          rows: rows.length,
          credits,
          worstCaseCents: decision.worstCaseCents,
          balanceBefore: null,
          balanceAfter: null,
          vendorJobId: null,
          approvedBy: null,
        })
        .catch((err) => log.warn("ledger row failed", { vendor: "aiark", action: "people_preview", error: (err as Error).message }));
    }
  }
  return rows;
}

/** 250 rows for the pilot scorer. No email column is asked for. */
export async function samplePilotRows(d: MeasureDeps, run: Ledgerable, filters: GetleadsFilters): Promise<{ rows: PilotRow[]; fields: PilotFields }> {
  const got = await exportText(d, run, filters, { max_rows: PILOT_ROWS, max_per_company: filters.max_per_company, columns: [...PILOT_EXPORT_COLUMNS] }, 45_000, "pilot_export");
  if (!got) throw new Error("pilot export was not ready");
  const sample = pilotSampleFromCsv(got.text);
  return { rows: sample.rows.slice(0, PILOT_ROWS), fields: sample.fields };
}

export interface HeldResult {
  count: number;
  method: HeldMethod;
  sampled: number;
  matched: number;
  note: string;
}

/**
 * People in this pool who are already held: a page of the pool is matched
 * against what the client sent in the recycle window plus live campaigns,
 * and scaled. When the page cannot be taken, the lane's own count is used.
 * The client's whole contact total is never subtracted.
 */
export async function heldInPool(
  d: MeasureDeps,
  run: Ledgerable,
  input: { clientId: number; campaignIds: readonly number[]; days: number; excludeLive: boolean; tam: number; filters: GetleadsFilters | null },
): Promise<HeldResult> {
  const sample = input.filters ? await sampleEmails(d, run, input.filters) : [];
  if (sample.length > 0) {
    const matched = await countHeldEmails(d.db, input.clientId, input.campaignIds, input.days, input.excludeLive, sample);
    const scaled = scaleOverlap(input.tam, sample.length, matched);
    return {
      count: scaled.held,
      method: scaled.method,
      sampled: sample.length,
      matched,
      note:
        scaled.method === "overlap"
          ? `${scaled.held} of this pool are already held (matched the export page). The client total was not subtracted.`
          : `${matched} of ${sample.length} sampled rows are already held, scaled to ${scaled.held} of ${input.tam}. The client total was not subtracted.`,
    };
  }
  const lane = await countHeldEmails(d.db, input.clientId, input.campaignIds, input.days, input.excludeLive, null);
  const held = Math.min(input.tam, lane);
  return { count: held, method: "lane", sampled: 0, matched: lane, note: `${held} addresses already held on this lane's campaigns. The client total was not subtracted.` };
}

async function sampleEmails(d: MeasureDeps, run: Ledgerable, filters: GetleadsFilters): Promise<string[]> {
  try {
    let slice: GetleadsFilters = filters;
    if (filters.geo_fence) {
      const cities = await d.loadGeo(filters.geo_fence);
      slice = (countSlices(filters, cities)[0] as GetleadsFilters | undefined) ?? filters;
    } else if ((filters.cities?.length ?? 0) > 45) {
      slice = { ...filters, cities: filters.cities!.slice(0, 45) };
    }
    const got = await exportText(d, run, slice, { max_rows: 100 }, 20_000, "overlap_sample");
    return got ? emailsFromCsv(got.text) : [];
  } catch (err) {
    log.warn("overlap sample failed", { error: (err as Error).message });
    return [];
  }
}

/** Distinct addresses this client sent in the window, plus live-campaign holds (D36). A sample limits it to those emails; lane mode limits it to these campaigns. */
export async function countHeldEmails(db: Queryable, clientId: number, campaignIds: readonly number[], days: number, excludeLive: boolean, emails: string[] | null): Promise<number> {
  if (campaignIds.length === 0) return 0;
  const { rows: has } = await db.query<{ leads: boolean; sends: boolean; staging: boolean; campaigns: boolean }>(
    `select to_regclass('public.leads') is not null as leads, to_regclass('public.sends') is not null as sends,
            to_regclass('public.leads_staging') is not null as staging, to_regclass('public.campaigns') is not null as campaigns`,
  );
  if (!has[0]?.leads || !has[0].sends) return 0;
  const sample = emails !== null && emails.length > 0;
  if (!sample && !has[0].campaigns) return 0;
  const live = excludeLive && has[0].campaigns;
  const laneSend = sample ? "" : `and l.campaign_id in (select id from public.campaigns where smartlead_campaign_id = any($3::bigint[]))`;
  const laneLive = sample ? "" : `and c.smartlead_campaign_id = any($3::bigint[])`;
  const { rows } = await db.query<{ n: string }>(
    `select count(distinct e)::text as n from (
       select lower(l.email) as e
       from public.leads l
       join public.sends s on s.lead_id = l.id
       where l.smartlead_client_id = $1 and l.email is not null
         and s.sent and s.sent_at is not null
         and s.sent_at >= now() - ($2::int * interval '1 day')
         ${laneSend}
       ${live ? `union
       select lower(l.email) as e
       from public.leads l
       join public.campaigns c on c.id = l.campaign_id
       where l.smartlead_client_id = $1 and l.email is not null
         and upper(coalesce(c.status, '')) not in ('STOPPED', 'COMPLETED')
         ${laneLive}` : ""}
       ${live && has[0].staging ? `union
       select lower(st.email) as e
       from public.leads_staging st
       join public.campaigns c on c.smartlead_campaign_id = st.campaign_id
       where c.smartlead_client_id = $1 and st.email is not null
         and upper(coalesce(c.status, '')) not in ('STOPPED', 'COMPLETED')
         ${laneLive}` : ""}
     ) x
     ${sample ? "where e = any($3::text[])" : ""}`,
    sample ? [clientId, days, emails] : [clientId, days, campaignIds],
  );
  return Number(rows[0]?.n ?? 0);
}

export type { RunRow };
