import { EXPORT_DONE, EXPORT_FAILED, outboundFilters, type Getleads, type GetleadsFilters } from "../clients/getleads.js";
import type { Queryable } from "../db/pool.js";
import { logger } from "../lib/log.js";
import { campaignNameBySmartleadId } from "../ledger/health.js";
import { MIN_NET_NEW } from "../policy/rules.js";
import { countSlices, loadGeoFenceCities, type GeoCity, type GeoFenceRef } from "../recipes/geoFence.js";
import type { SpendRails } from "../spend/rails.js";
import { filtersApplied, getleadsParamsFromFilters, honorReceiptCountKeys } from "../jobs/filters.js";

const log = logger("held");

/**
 * How much of a getleads pool the client already holds (D80, D95): the
 * full held set (unsubscribes, hard bounces, DNC) joined to the exported
 * pool. Never a sample, never a lane total. Addresses stay in memory and
 * are never logged.
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
  filters_applied: Record<string, unknown>;
  tam: number;
  held: number;
  net_new: number;
  note: string;
  rule: string;
}

export const HELD_RULE = `net_new is the count minus what the client already holds. Under ${MIN_NET_NEW}, the TAM for this campaign is exhausted.`;

const EXPORT_DEADLINE_MS = 60_000;
const EXPORT_PAGE = 50_000;

export async function heldRead(
  d: HeldDeps,
  input: { client_tag: string; smartlead_client_id: number; campaign_ids: readonly number[]; filters: Record<string, unknown>; tam: number; days?: number },
): Promise<HeldRead | { error: string }> {
  const campaignId = input.campaign_ids[0] ?? null;
  const campaignName =
    campaignId != null ? await campaignNameBySmartleadId(d.db, campaignId).catch(() => null) : null;
  const parsed = getleadsParamsFromFilters(input.filters, campaignId, campaignName);
  if (!parsed.ok) return { error: parsed.error };
  if (!Number.isFinite(input.tam) || input.tam < 0) return { error: 'tam must be the count from count(source="getleads", ...).' };
  const { max_per_company: _cap, ...filters } = parsed.params;
  const tam = Math.floor(input.tam);
  const honored = honorReceiptCountKeys(input.filters, campaignId, campaignName);
  const applied = filtersApplied(parsed.params, outboundFilters(filters as GetleadsFilters), honored.ok ? honored.honored : {});
  if (tam === 0) {
    return {
      source: "getleads",
      filters_used: applied,
      filters_applied: applied,
      tam: 0,
      held: 0,
      net_new: 0,
      note: "Pool is 0. net_new is the pool minus held.",
      rule: HELD_RULE,
    };
  }
  const heldSet = await loadHeldEmails(d.db, input.smartlead_client_id);
  const pool = await exportPoolEmails(d, input.client_tag, filters as GetleadsFilters, tam);
  if ("error" in pool) return pool;
  let matched = 0;
  for (const email of pool.emails) if (heldSet.has(email)) matched += 1;
  const held = matched;
  return {
    source: "getleads",
    filters_used: applied,
    filters_applied: applied,
    tam,
    held,
    net_new: Math.max(0, tam - held),
    note: `${held} of this pool are already held (exact full-list join of the exported pool to this client's unsubscribes, hard bounces, and the DNC list). net_new is the pool minus that held count.`,
    rule: HELD_RULE,
  };
}

/** Distinct addresses this client holds under D81. Never logged. */
export async function loadHeldEmails(db: Queryable, clientId: number): Promise<Set<string>> {
  const { rows: has } = await db.query<{ leads: boolean; sends: boolean; suppression: boolean }>(
    `select to_regclass('public.leads') is not null as leads, to_regclass('public.sends') is not null as sends,
            to_regclass('public.suppression') is not null as suppression`,
  );
  if (!has[0]?.leads) return new Set();
  const { rows: col } = await db.query<{ n: string }>(
    `select count(*)::text as n from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'negative_class'`,
  );
  const hasClass = Number(col[0]?.n ?? 0) > 0;
  const unsub = hasClass
    ? `select lower(l.email) as e from public.leads l
        where l.smartlead_client_id = $1 and l.email is not null
          and (l.negative_class = 'unsubscribe' or lower(coalesce(l.status, '')) = 'unsubscribed')`
    : `select lower(l.email) as e from public.leads l
        where l.smartlead_client_id = $1 and l.email is not null
          and lower(coalesce(l.status, '')) = 'unsubscribed'`;
  const bounce = has[0].sends
    ? `union
       select lower(l.email) as e from public.leads l where l.email is not null and l.category_id = 9
       union
       select lower(l.email) as e from public.leads l join public.sends s on s.lead_id = l.id
        where l.email is not null and s.bounced`
    : `union
       select lower(l.email) as e from public.leads l where l.email is not null and l.category_id = 9`;
  const dnc = has[0].suppression
    ? `union
       select lower(s.email) as e from public.suppression s where s.email is not null`
    : "";
  const { rows } = await db.query<{ e: string }>(
    `select distinct e from (
       ${unsub}
       ${bounce}
       ${dnc}
     ) x`,
    [clientId],
  );
  return new Set(rows.map((r) => r.e).filter((e) => e.includes("@")));
}

/** Count of held emails, optionally limited to a list. Used by maps/size. */
export async function countHeldEmails(
  db: Queryable,
  clientId: number,
  campaignIds: readonly number[],
  _days: number,
  _excludeLive: boolean,
  emails: string[] | null,
): Promise<number> {
  if (campaignIds.length === 0) return 0;
  const all = await loadHeldEmails(db, clientId);
  if (emails !== null && emails.length > 0) {
    const want = new Set(emails.map((e) => e.trim().toLowerCase()));
    let n = 0;
    for (const e of all) if (want.has(e)) n += 1;
    return n;
  }
  return all.size;
}

async function exportPoolEmails(
  d: HeldDeps,
  clientTag: string,
  filters: GetleadsFilters,
  tam: number,
): Promise<{ emails: string[] } | { error: string }> {
  try {
    let slice: GetleadsFilters = filters;
    if (filters.geo_fence) {
      const cities = await (d.loadGeo ?? ((ref: GeoFenceRef) => loadGeoFenceCities(d.db, ref)))(filters.geo_fence);
      slice = (countSlices(filters, cities)[0] as GetleadsFilters | undefined) ?? filters;
    } else if ((filters.cities?.length ?? 0) > 45) {
      slice = { ...filters, cities: filters.cities!.slice(0, 45) };
    }
    const got = await exportPage(d, clientTag, slice, Math.min(Math.max(tam, 1), EXPORT_PAGE));
    if (!got) {
      return { error: "held could not export the pool for an exact full-list join. No fallback. Ask Josh or Cayden." };
    }
    return { emails: emailsFromCsv(got.text) };
  } catch (err) {
    log.warn("exact join export failed", { error: (err as Error).message });
    return { error: "held could not export the pool for an exact full-list join. No fallback. Ask Josh or Cayden." };
  }
}

async function exportPage(
  d: HeldDeps,
  clientTag: string,
  filters: GetleadsFilters,
  maxRows: number,
): Promise<{ text: string; rows: number } | null> {
  const started = await d.getleads.startExport(filters, { max_rows: maxRows, columns: ["email"] });
  const deadline = d.now() + EXPORT_DEADLINE_MS;
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
    .record({
      runId: "canon",
      clientTag,
      step: "size",
      vendor: "getleads",
      action: "held_join",
      rows,
      credits: 0,
      worstCaseCents: 0,
      balanceBefore: null,
      balanceAfter: null,
      vendorJobId: started.export_id,
      approvedBy: null,
    })
    .catch((err) => log.warn("ledger row failed", { vendor: "getleads", action: "held_join", error: (err as Error).message }));
  return { text: await d.fetchText(url), rows };
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
