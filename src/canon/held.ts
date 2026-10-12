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
import {
  HELD_EXPORT_COLUMNS,
  loadHeldKeys,
  poolRowsFromCsv,
  rowHasEmail,
  rowIsHeld,
  type HeldKeys,
} from "./heldKeys.js";

const log = logger("held");

/**
 * How much of a getleads pool the client already holds (D80, D95, D97, D98):
 * every lead this client already has (lead store, Smartlead history and
 * mirror, sends, provenance, suppressions) joined to the exported pool by
 * email, else LinkedIn URL, else normalized name+company. The export is
 * free, chunked, and polled in the background. Never a sample, never a
 * lane total, never a paid export. Addresses stay in memory and are never
 * logged.
 */
export interface HeldDeps {
  db: Queryable;
  getleads: Getleads;
  rails: Pick<SpendRails, "record">;
  fetchText: (url: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  loadGeo?: (ref: GeoFenceRef) => Promise<GeoCity[]>;
  loadHeld?: (db: Queryable, clientId: number, clientTag: string) => Promise<HeldKeys>;
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
  has_email: number | null;
  needs_enrich: number | null;
  exported: number | null;
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
    has_email: null,
    needs_enrich: null,
    exported: null,
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
      has_email: 0,
      needs_enrich: 0,
      exported: 0,
      note: "Pool is 0. net_new is the pool minus held.",
    });
  }
  const heldKeys = await (d.loadHeld ?? loadHeldKeys)(d.db, input.smartlead_client_id, input.client_tag);
  const pool = await exportPoolRows(d, input.client_tag, filters as GetleadsFilters, tam);
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
  let held = 0;
  let has_email = 0;
  let needs_enrich = 0;
  for (const row of pool.rows) {
    if (rowIsHeld(row, heldKeys)) {
      held += 1;
      continue;
    }
    if (rowHasEmail(row)) has_email += 1;
    else needs_enrich += 1;
  }
  const net_new = has_email + needs_enrich;
  const exported = pool.rows.length;
  return emptyHeld({
    held_id,
    status: "done",
    filters_used: applied,
    filters_applied: applied,
    tam,
    held,
    net_new,
    has_email,
    needs_enrich,
    exported,
    note: `${held} of ${exported} exported pool rows are already held (exact full-list join to every lead this client already has: lead store, Smartlead history and mirror, sends, provenance, and suppressions; match by email, else LinkedIn URL, else normalized name+company). net_new is the pool minus that held count, split as ${has_email} has-email and ${needs_enrich} needs-enrich.`,
  });
}

/** Distinct addresses this client holds (D98). Never logged. */
export async function loadHeldEmails(db: Queryable, clientId: number, clientTag?: string | null): Promise<Set<string>> {
  const keys = await loadHeldKeys(db, clientId, clientTag);
  return keys.emails;
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

async function exportPoolRows(
  d: HeldDeps,
  clientTag: string,
  filters: GetleadsFilters,
  tam: number,
): Promise<{ rows: ReturnType<typeof poolRowsFromCsv> } | { error: string; error_class: HeldExportClass }> {
  try {
    let slice: GetleadsFilters = filters;
    if (filters.geo_fence) {
      const cities = await (d.loadGeo ?? ((ref: GeoFenceRef) => loadGeoFenceCities(d.db, ref)))(filters.geo_fence);
      slice = (countSlices(filters, cities)[0] as GetleadsFilters | undefined) ?? filters;
    } else if ((filters.cities?.length ?? 0) > 45) {
      slice = { ...filters, cities: filters.cities!.slice(0, 45) };
    }
    const parts = heldExportSlices(slice);
    const rows: ReturnType<typeof poolRowsFromCsv> = [];
    const maxRows = Math.min(Math.max(tam, 1), EXPORT_PAGE);
    for (const part of parts) {
      const started = await d.getleads.startExport(part, { max_rows: maxRows, columns: [...HELD_EXPORT_COLUMNS] });
      const ids = started.export_ids?.length ? started.export_ids : [started.export_id];
      for (const id of ids) {
        const got = await pollExport(d, clientTag, id);
        if ("error" in got) return got;
        rows.push(...poolRowsFromCsv(got.text));
      }
    }
    return { rows };
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
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of poolRowsFromCsv(text)) {
    const email = row.email?.trim().toLowerCase() ?? "";
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
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
