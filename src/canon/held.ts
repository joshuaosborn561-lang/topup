import { randomUUID } from "node:crypto";
import {
  EXPORT_DONE,
  EXPORT_FAILED,
  isCountTimeout,
  MAX_SPLIT_DEPTH,
  outboundFilters,
  splitGetleadsQuery,
  type Getleads,
  type GetleadsFilters,
} from "../clients/getleads.js";
import type { Queryable } from "../db/pool.js";
import { logger } from "../lib/log.js";
import { campaignNameBySmartleadId } from "../ledger/health.js";
import { MIN_NET_NEW } from "../policy/rules.js";
import { countSlices, loadGeoFenceCities, type GeoCity, type GeoFenceRef } from "../recipes/geoFence.js";
import type { SpendRails } from "../spend/rails.js";
import { filtersApplied, getleadsParamsFromFilters, honorReceiptCountKeys } from "../jobs/filters.js";

const log = logger("held");

/**
 * How much of a getleads pool the client already holds (D80, D95, D97): the
 * full held set (unsubscribes, hard bounces, DNC) joined to the exported
 * pool. The export is free, chunked, and polled in the background. Never a
 * sample, never a lane total, never a paid export. Addresses stay in memory
 * and are never logged.
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

export type HeldStatus = "started" | "done" | "failed";

export type HeldExportClass = "timeout" | "export_failed" | "fair_use" | "count_timeout" | "paid_export" | "unknown";

export interface HeldRead {
  source: "getleads";
  filters_used: Record<string, unknown>;
  filters_applied: Record<string, unknown>;
  tam: number;
  held: number | null;
  net_new: number | null;
  note: string;
  rule: string;
  held_id: string | null;
  status: HeldStatus;
  last_error: string | null;
  error_class: HeldExportClass | null;
}

export interface HeldInput {
  client_tag: string;
  smartlead_client_id: number;
  campaign_ids: readonly number[];
  filters: Record<string, unknown>;
  tam: number;
  days?: number;
}

export const HELD_RULE = `net_new is the count minus what the client already holds. Under ${MIN_NET_NEW}, the TAM for this campaign is exhausted.`;

export const HELD_NO_FALLBACK = "No fallback. Ask Josh or Cayden.";

/** Per-slice poll. A single wide export used to die at the 60s MCP wait (D97). */
export const EXPORT_SLICE_DEADLINE_MS = 180_000;

const EXPORT_PAGE = 50_000;

const HELD_LIST_KEYS = ["company_size", "cities", "industries", "job_titles"] as const;

export function classifyHeldExportError(message: string): HeldExportClass {
  const m = message ?? "";
  if (/fair_use/i.test(m)) return "fair_use";
  if (isCountTimeout(m)) return "count_timeout";
  if (/paid.?export|insufficient_credits|credits_exhausted|credit.?limit/i.test(m) && !/unlimited/i.test(m)) {
    return "paid_export";
  }
  if (/timed? ?out|deadline/i.test(m)) return "timeout";
  if (EXPORT_FAILED.some((s) => m.toLowerCase().includes(s))) return "export_failed";
  return "unknown";
}

export function heldExportError(klass: HeldExportClass, detail?: string): string {
  const extra = detail && detail.trim() ? ` ${detail.trim()}` : "";
  return `held could not export the pool for an exact full-list join (${klass}).${extra} ${HELD_NO_FALLBACK}`;
}

/**
 * Halve the largest OR-list until each slice is narrow enough for a free
 * export. Union of slices is the full pool. Depth matches exportOrSplit.
 */
export function heldExportSlices(filters: GetleadsFilters, depth = 0): GetleadsFilters[] {
  if (depth >= MAX_SPLIT_DEPTH) return [filters];
  const largest = Math.max(0, ...HELD_LIST_KEYS.map((key) => (filters[key] ?? []).length));
  if (largest <= 2) return [filters];
  const parts = splitGetleadsQuery(filters);
  if (parts.length < 2) return [filters];
  return parts.flatMap((part) => heldExportSlices(part, depth + 1));
}

function emptyHeld(over: Partial<HeldRead>): HeldRead {
  return {
    source: "getleads",
    filters_used: {},
    filters_applied: {},
    tam: 0,
    held: null,
    net_new: null,
    note: "",
    rule: HELD_RULE,
    held_id: null,
    status: "done",
    last_error: null,
    error_class: null,
    ...over,
  };
}

export async function heldRead(d: HeldDeps, input: HeldInput, held_id: string | null = null): Promise<HeldRead> {
  const campaignId = input.campaign_ids[0] ?? null;
  const campaignName =
    campaignId != null ? await campaignNameBySmartleadId(d.db, campaignId).catch(() => null) : null;
  const parsed = getleadsParamsFromFilters(input.filters, campaignId, campaignName);
  if (!parsed.ok) {
    return emptyHeld({
      held_id,
      status: "failed",
      last_error: parsed.error,
      error_class: "unknown",
      note: parsed.error,
    });
  }
  if (!Number.isFinite(input.tam) || input.tam < 0) {
    const error = 'tam must be the count from count(source="getleads", ...).';
    return emptyHeld({ held_id, status: "failed", last_error: error, error_class: "unknown", note: error });
  }
  const { max_per_company: _cap, ...filters } = parsed.params;
  const tam = Math.floor(input.tam);
  const honored = honorReceiptCountKeys(input.filters, campaignId, campaignName);
  const applied = filtersApplied(parsed.params, outboundFilters(filters as GetleadsFilters), honored.ok ? honored.honored : {});
  if (tam === 0) {
    return emptyHeld({
      held_id,
      status: "done",
      filters_used: applied,
      filters_applied: applied,
      tam: 0,
      held: 0,
      net_new: 0,
      note: "Pool is 0. net_new is the pool minus held.",
    });
  }
  const heldSet = await loadHeldEmails(d.db, input.smartlead_client_id);
  const pool = await exportPoolEmails(d, input.client_tag, filters as GetleadsFilters, tam);
  if ("error" in pool) {
    return emptyHeld({
      held_id,
      status: "failed",
      filters_used: applied,
      filters_applied: applied,
      tam,
      last_error: pool.error,
      error_class: pool.error_class,
      note: pool.error,
    });
  }
  let matched = 0;
  for (const email of pool.emails) if (heldSet.has(email)) matched += 1;
  const held = matched;
  return emptyHeld({
    held_id,
    status: "done",
    filters_used: applied,
    filters_applied: applied,
    tam,
    held,
    net_new: Math.max(0, tam - held),
    note: `${held} of this pool are already held (exact full-list join of the exported pool to this client's unsubscribes, hard bounces, and the DNC list). net_new is the pool minus that held count.`,
  });
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
): Promise<{ emails: string[] } | { error: string; error_class: HeldExportClass }> {
  try {
    let slice: GetleadsFilters = filters;
    if (filters.geo_fence) {
      const cities = await (d.loadGeo ?? ((ref: GeoFenceRef) => loadGeoFenceCities(d.db, ref)))(filters.geo_fence);
      slice = (countSlices(filters, cities)[0] as GetleadsFilters | undefined) ?? filters;
    } else if ((filters.cities?.length ?? 0) > 45) {
      slice = { ...filters, cities: filters.cities!.slice(0, 45) };
    }
    const parts = heldExportSlices(slice);
    const seen = new Set<string>();
    const emails: string[] = [];
    const maxRows = Math.min(Math.max(tam, 1), EXPORT_PAGE);
    for (const part of parts) {
      const started = await d.getleads.startExport(part, { max_rows: maxRows, columns: ["email"] });
      const ids = started.export_ids?.length ? started.export_ids : [started.export_id];
      for (const id of ids) {
        const got = await pollExport(d, clientTag, id);
        if ("error" in got) return got;
        for (const email of emailsFromCsv(got.text)) {
          if (seen.has(email)) continue;
          seen.add(email);
          emails.push(email);
        }
      }
    }
    return { emails };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    const error_class = classifyHeldExportError(message);
    log.warn("exact join export failed", { error: message, error_class });
    if (error_class === "paid_export") {
      return { error: heldExportError("paid_export", "Refused a paid export. Quote the exact cost; do not run it."), error_class };
    }
    return { error: heldExportError(error_class, message.slice(0, 180)), error_class };
  }
}

async function pollExport(
  d: HeldDeps,
  clientTag: string,
  exportId: string,
): Promise<{ text: string; rows: number } | { error: string; error_class: HeldExportClass }> {
  const deadline = d.now() + EXPORT_SLICE_DEADLINE_MS;
  let url: string | null = null;
  let rows = 0;
  while (d.now() < deadline) {
    const status = await d.getleads.checkExport(exportId);
    if (status.cap_reason === "fair_use" || /fair_use/i.test(status.cap_message ?? "")) {
      return { error: heldExportError("fair_use", status.cap_message ?? "fair_use"), error_class: "fair_use" };
    }
    if (EXPORT_FAILED.includes(status.job_status)) {
      return {
        error: heldExportError("export_failed", status.cap_message ?? status.job_status),
        error_class: "export_failed",
      };
    }
    if (status.export_url && (EXPORT_DONE.includes(status.job_status) || status.rows_exported !== null)) {
      url = status.export_url;
      rows = status.rows_exported ?? 0;
      break;
    }
    await d.sleep(2000);
  }
  if (!url) {
    return { error: heldExportError("timeout", `export ${exportId} outran ${EXPORT_SLICE_DEADLINE_MS}ms`), error_class: "timeout" };
  }
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
      vendorJobId: exportId,
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

interface HeldJob {
  held_id: string;
  status: HeldStatus;
  started_at: string;
  result: HeldRead;
}

/**
 * In-process held runner (D97). One replica (D5). Returns the held_id at
 * once; poll held(held_id). Opens no run. A restart loses an in-flight
 * held — call held again. Nothing starts on its own. The join stays
 * server-side; the answer is counts only.
 */
export class HeldRunner {
  private readonly jobs = new Map<string, HeldJob>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: HeldDeps) {}

  async start(input: HeldInput): Promise<HeldRead> {
    const held_id = randomUUID();
    const started = emptyHeld({
      held_id,
      status: "started",
      tam: Number.isFinite(input.tam) ? Math.floor(input.tam) : 0,
      filters_used: input.filters,
      filters_applied: input.filters,
      note: "held started. Poll held(held_id). Free chunked export; exact full-list join; no spend.",
    });
    this.jobs.set(held_id, { held_id, status: "started", started_at: new Date().toISOString(), result: started });
    if (!this.inFlight.has(held_id)) {
      this.inFlight.add(held_id);
      void this.run(held_id, input).finally(() => this.inFlight.delete(held_id));
    }
    return started;
  }

  async get(held_id: string): Promise<HeldRead> {
    const job = this.jobs.get(held_id);
    if (!job) {
      const error = "no such held_id; call held(client_tag, campaign_id, filters, tam) again";
      return emptyHeld({
        held_id,
        status: "failed",
        last_error: error,
        error_class: "unknown",
        note: "no such held_id. A restart loses an in-flight held. Call held again.",
      });
    }
    return job.result;
  }

  private async run(held_id: string, input: HeldInput): Promise<void> {
    const job = this.jobs.get(held_id);
    if (!job) return;
    try {
      const result = await heldRead(this.deps, input, held_id);
      job.status = result.status;
      job.result = result;
      this.jobs.set(held_id, job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error_class = classifyHeldExportError(message);
      log.error("held failed in the background", { held_id, error: message, error_class });
      job.status = "failed";
      job.result = {
        ...job.result,
        status: "failed",
        last_error: heldExportError(error_class, message.slice(0, 180)),
        error_class,
        note: heldExportError(error_class, message.slice(0, 180)),
      };
      this.jobs.set(held_id, job);
    }
  }
}
