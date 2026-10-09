import { EXPORT_DONE, EXPORT_FAILED, type Getleads, type GetleadsFilters } from "../clients/getleads.js";
import type { Queryable } from "../db/pool.js";
import { logger } from "../lib/log.js";
import { MIN_NET_NEW } from "../policy/rules.js";
import { countSlices, loadGeoFenceCities, type GeoCity, type GeoFenceRef } from "../recipes/geoFence.js";
import type { SpendRails } from "../spend/rails.js";
import { getleadsParamsFromFilters } from "../jobs/filters.js";

const log = logger("held");

/**
 * How much of a getleads pool the client already holds (D52): a page of
 * the pool is matched against what the client sent in the recycle window
 * and its live campaigns, and the share is scaled to the count Grok gives.
 * The answer is a count and the method; the rule is stated; Grok applies it.
 * The page's addresses stay in memory and are never logged or stored.
 */
export interface HeldDeps {
  db: Queryable;
  getleads: Getleads;
  rails: Pick<SpendRails, "record">;
  fetchText: (url: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  loadGeo?: (ref: GeoFenceRef) => Promise<GeoCity[]>;
}

export interface HeldRead {
  source: "getleads";
  filters_used: Record<string, unknown>;
  tam: number;
  held: number;
  net_new: number;
  method: HeldMethod;
  sampled: number;
  matched: number;
  note: string;
  rule: string;
}

export type HeldMethod = "overlap" | "sample" | "lane";

export const HELD_RULE = `net_new is the count minus what the client already holds. Under ${MIN_NET_NEW}, the TAM for this campaign is exhausted.`;

const SAMPLE_ROWS = 100;
const SAMPLE_DEADLINE_MS = 20_000;

export async function heldRead(
  d: HeldDeps,
  input: { client_tag: string; smartlead_client_id: number; campaign_ids: readonly number[]; filters: Record<string, unknown>; tam: number; days?: number },
): Promise<HeldRead | { error: string }> {
  const params = getleadsParamsFromFilters(input.filters);
  if (!params) return { error: "held needs getleads filters: job_titles, or job_function plus seniority; company_size as band labels when given." };
  if (!Number.isFinite(input.tam) || input.tam < 0) return { error: 'tam must be the count from count(source="getleads", ...).' };
  const { max_per_company: _cap, ...filters } = params as GetleadsFilters & { max_per_company?: number };
  const tam = Math.floor(input.tam);
  const days = input.days ?? 90;
  const sample = await sampleEmails(d, input.client_tag, filters as GetleadsFilters);
  let held: number;
  let method: HeldMethod;
  let matched: number;
  let note: string;
  if (sample.length > 0) {
    matched = await countHeldEmails(d.db, input.smartlead_client_id, input.campaign_ids, days, true, sample);
    const scaled = scaleOverlap(tam, sample.length, matched);
    held = scaled.held;
    method = scaled.method;
    note =
      method === "overlap"
        ? `${held} of this pool are already held (matched the export page). The client total was not subtracted.`
        : `${matched} of ${sample.length} sampled rows are already held, scaled to ${held} of ${tam}. The client total was not subtracted.`;
  } else {
    matched = await countHeldEmails(d.db, input.smartlead_client_id, input.campaign_ids, days, true, null);
    held = Math.min(tam, matched);
    method = "lane";
    note = `${held} addresses already held on this lane's campaigns. The client total was not subtracted.`;
  }
  return {
    source: "getleads",
    filters_used: filters,
    tam,
    held,
    net_new: Math.max(0, tam - held),
    method,
    sampled: sample.length,
    matched,
    note,
    rule: HELD_RULE,
  };
}

/**
 * A sample that covers the TAM is the overlap. A shorter sample is scaled.
 * `matched` is how many sample rows are already held.
 */
export function scaleOverlap(tam: number, sampleSize: number, matched: number): { held: number; method: "overlap" | "sample" } {
  const total = Math.max(0, Math.floor(tam));
  const size = Math.max(0, Math.floor(sampleSize));
  const hits = Math.max(0, Math.min(size, Math.floor(matched)));
  if (size === 0) return { held: 0, method: "sample" };
  if (size >= total) return { held: Math.min(total, hits), method: "overlap" };
  return { held: Math.min(total, Math.round((hits / size) * total)), method: "sample" };
}

/** One export page of the pool. The addresses are returned to the caller and never logged. */
async function sampleEmails(d: HeldDeps, clientTag: string, filters: GetleadsFilters): Promise<string[]> {
  try {
    let slice: GetleadsFilters = filters;
    if (filters.geo_fence) {
      const cities = await (d.loadGeo ?? ((ref: GeoFenceRef) => loadGeoFenceCities(d.db, ref)))(filters.geo_fence);
      slice = (countSlices(filters, cities)[0] as GetleadsFilters | undefined) ?? filters;
    } else if ((filters.cities?.length ?? 0) > 45) {
      slice = { ...filters, cities: filters.cities!.slice(0, 45) };
    }
    const got = await exportPage(d, clientTag, slice);
    return got ? emailsFromCsv(got.text) : [];
  } catch (err) {
    log.warn("overlap sample failed", { error: (err as Error).message });
    return [];
  }
}

/** Wait for a getleads export and read its CSV. Free; one ledger row. */
async function exportPage(d: HeldDeps, clientTag: string, filters: GetleadsFilters): Promise<{ text: string; rows: number } | null> {
  const started = await d.getleads.startExport(filters, { max_rows: SAMPLE_ROWS });
  const deadline = d.now() + SAMPLE_DEADLINE_MS;
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
  await d.rails
    .record({ runId: "canon", clientTag, step: "size", vendor: "getleads", action: "overlap_sample", rows, credits: 0, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: started.export_id, approvedBy: null })
    .catch((err) => log.warn("ledger row failed", { vendor: "getleads", action: "overlap_sample", error: (err as Error).message }));
  return { text: await d.fetchText(url), rows };
}

/** Distinct addresses this client sent in the window, plus live-campaign holds. A sample limits it to those emails; lane mode limits it to these campaigns. */
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

/** Emails from an export page. The header must name an email column. */
export function emailsFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((cell) => cell.trim().toLowerCase());
  const idx = header.findIndex((cell) => cell === "email" || cell === "work_email" || cell === "person_email");
  if (idx < 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines.slice(1)) {
    const email = (splitCsvLine(line)[idx] ?? "").trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
