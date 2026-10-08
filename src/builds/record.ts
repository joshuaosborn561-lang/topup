import { getleadsParamsFromFilters } from "../recipes/infer.js";
import { originalTamFromBuilds } from "../stages/size/tamSource.js";

/**
 * The build record is the centre of the system (D47). Every pull, past and
 * future, is one of these: the vendor, the exact query, the source kind, the
 * campaigns it fed, and what it yielded. The next pull for a campaign is
 * chosen from these records, never from lane labels or client defaults. A
 * record whose method cannot be reconstructed says so; nothing guesses.
 * Counts, labels and method text only. Never a lead row.
 */
export type BuildSourceKind = "vendor_search" | "stored_pool" | "table" | "unknown";

export type BuildVendor =
  | "getleads"
  | "ai_ark"
  | "maps"
  | "permits"
  | "maps_and_permits"
  | "serp"
  | "linkedin_engagers"
  | "linkedin_import"
  | "apify"
  | "table"
  | "unknown";

/** The exact vendor query a LinkedIn-native build ran. Same shape as a getleads source's params. */
export interface BuildQuery {
  job_titles?: string[];
  job_function?: string;
  seniority?: string[];
  company_size?: string[];
  countries?: string[];
  states?: string[];
  cities?: string[];
  geo_fence?: { schema: string; table: string };
  industries?: string[];
  company_description?: string;
  email_status?: string[];
  max_per_company?: number;
  /** Personas pulled only where the primary titles found nobody at a company, in order (BCP: coo). */
  fallback_personas?: string[];
}

export interface BuildPool {
  kind: "maps" | "permits" | "maps_and_permits" | "serp" | "linkedin_engagers" | "linkedin_import" | "table" | "unknown";
  /** The stored pool count the build's method note states. null when the note does not say. */
  count: number | null;
  detail: string | null;
}

export interface BuildRecord {
  build_id: string;
  client_tag: string;
  lane: string | null;
  build_label: string | null;
  source_kind: BuildSourceKind;
  vendor: BuildVendor;
  query: BuildQuery | null;
  pool: BuildPool | null;
  /** Campaigns this build fed. */
  campaigns: number[];
  leads: number | null;
  interested: number | null;
  bounces: number | null;
  rows_found: number | null;
  rows_imported: number | null;
  tam_count: number | null;
  icp_kind: "linkedin_native" | "physical" | null;
  persona: string | null;
  /** The written method (how_i_did_it). Text only. */
  method_note: string | null;
  confidence: string | null;
  /** True when the method was inferred after the fact rather than stamped at pull time. */
  reconstructed: boolean;
  written_at: string | null;
  /** Can the service repeat this build itself? Never guessed: a thin record says no and why. */
  repeatable: { ok: boolean; why: string };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function ids(v: unknown): number[] {
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  return [...new Set(list.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

export function vendorFromSource(source: string | null, label: string | null, method: string | null): BuildVendor {
  const s = (source ?? "").toLowerCase();
  const blob = `${s} ${label ?? ""} ${method ?? ""}`.toLowerCase();
  if (s === "getleads") return "getleads";
  if (s === "ai_ark" || s === "aiark") return "ai_ark";
  if (s === "maps_and_permits") return "maps_and_permits";
  if (s === "permits") return "permits";
  if (s === "maps") return "maps";
  if (s === "serp" || s === "serp_tool_mention") return "serp";
  if (s === "linkedin_engagers") return "linkedin_engagers";
  if (s === "linkedin_import") return "linkedin_import";
  if (s === "table" || s === "supabase_table") return "table";
  if (s === "apify") return "apify";
  if (!s) {
    if (/getleads/.test(blob)) return "getleads";
    if (/google maps|\bmaps\b/.test(blob)) return "maps";
    if (/\bpermits?\b/.test(blob)) return "permits";
    if (/\bserp\b/.test(blob)) return "serp";
    if (/engager/.test(blob)) return "linkedin_engagers";
  }
  return "unknown";
}

function sourceKindFor(vendor: BuildVendor): BuildSourceKind {
  if (vendor === "getleads" || vendor === "ai_ark") return "vendor_search";
  if (vendor === "table") return "table";
  if (vendor === "unknown") return "unknown";
  return "stored_pool";
}

/** Fallback personas a build named in its filters (BCP: coo). Never invented. */
function fallbackPersonas(filters: Record<string, unknown> | null): string[] {
  const named = filters?.fallback_personas ?? filters?.fallback_titles ?? filters?.coo_fallback;
  if (Array.isArray(named)) return named.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  if (named === true) return ["coo"];
  return [];
}

function queryFromFilters(filters: Record<string, unknown> | null): BuildQuery | null {
  if (!filters) return null;
  const params = getleadsParamsFromFilters(filters);
  if (!params) return null;
  const description = typeof filters.company_description === "string" && filters.company_description.trim() ? filters.company_description.trim() : undefined;
  const fallback = fallbackPersonas(filters);
  return {
    ...params,
    ...(description ? { company_description: description } : {}),
    ...(fallback.length ? { fallback_personas: fallback } : {}),
  };
}

function poolFor(vendor: BuildVendor, row: Record<string, unknown>, campaignId: number): BuildPool | null {
  if (sourceKindFor(vendor) !== "stored_pool") return null;
  const original = originalTamFromBuilds([row], campaignId);
  const kind: BuildPool["kind"] =
    vendor === "maps" || vendor === "permits" || vendor === "maps_and_permits" || vendor === "serp" || vendor === "linkedin_engagers" || vendor === "linkedin_import" ? vendor : "unknown";
  if (original.kind === "pool") return { kind, count: original.pool, detail: original.tam_source };
  return { kind, count: null, detail: null };
}

function repeatability(source: BuildSourceKind, query: BuildQuery | null, pool: BuildPool | null): { ok: boolean; why: string } {
  if (source === "vendor_search") {
    if (!query) return { ok: false, why: "the build names no usable vendor query (titles or job function plus seniority); cannot repeat without guessing" };
    const company = Boolean(query.industries?.length || query.company_description || query.geo_fence || query.cities?.length || query.states?.length);
    if (!company) return { ok: false, why: "the build has titles but no company filter; a pool is never sized from titles alone" };
    return { ok: true, why: "vendor query on record: the service can count and pull it again" };
  }
  if (source === "stored_pool") {
    if (pool && pool.count != null) return { ok: true, why: `stored ${pool.kind} pool of ${pool.count.toLocaleString("en-US")} on record; the service sizes from it, minus contacted` };
    return { ok: false, why: `a ${pool?.kind ?? "stored"} build with no stored pool count in its method note; Josh names the source` };
  }
  if (source === "table") return { ok: true, why: "a table source; the pull reads the table" };
  return { ok: false, why: "no source on record; the method cannot be reconstructed" };
}

/** One row of topup.campaign_builds (or a pull receipt joined to one campaign) becomes a record. */
export function buildRecordFromRow(row: Record<string, unknown>, clientTag?: string): BuildRecord | null {
  const campaignIds = ids(row.campaign_ids ?? row.smartlead_campaign_id ?? row.campaign_id);
  const firstCampaign = campaignIds[0] ?? 0;
  const label = str(row.build_label);
  const method = str(row.method ?? row.how_i_did_it);
  const source = str(row.company_source);
  const filters = obj(row.company_filters);
  const vendor = vendorFromSource(source, label, method);
  const sourceKind = sourceKindFor(vendor);
  const query = sourceKind === "vendor_search" ? queryFromFilters(filters) : null;
  const pool = poolFor(vendor, row, firstCampaign);
  const writtenBy = str(row.written_by) ?? "";
  const confidence = str(row.confidence);
  const reconstructed = Boolean(row.reconstructed) || /backfill/i.test(writtenBy) || (confidence != null && confidence !== "traced");
  const client = str(row.client_tag) ?? clientTag ?? "";
  const icp = str(row.icp_kind);
  return {
    build_id: `${client}:${label ?? str(row.receipt_id) ?? `campaign-${firstCampaign}`}`,
    client_tag: client,
    lane: str(row.lane),
    build_label: label,
    source_kind: sourceKind,
    vendor,
    query,
    pool,
    campaigns: campaignIds,
    leads: num(row.leads),
    interested: num(row.interested),
    bounces: num(row.bounces ?? row.bounce_count ?? row.bounced),
    rows_found: num(row.rows_found),
    rows_imported: num(row.rows_imported),
    tam_count: num(row.tam_count),
    icp_kind: icp === "linkedin_native" || icp === "physical" ? icp : null,
    persona: str(row.persona),
    method_note: method,
    confidence,
    reconstructed,
    written_at: str(row.written_at ?? row.pulled_at),
    repeatable: repeatability(sourceKind, query, pool),
  };
}

/** Rows that share a build label are one build that fed several campaigns. */
export function buildRecordsFromRows(rows: readonly Record<string, unknown>[], clientTag?: string): BuildRecord[] {
  const byId = new Map<string, BuildRecord>();
  for (const row of rows) {
    const rec = buildRecordFromRow(row, clientTag);
    if (!rec) continue;
    const have = byId.get(rec.build_id);
    if (!have) {
      byId.set(rec.build_id, rec);
      continue;
    }
    have.campaigns = [...new Set([...have.campaigns, ...rec.campaigns])].sort((a, b) => a - b);
    have.leads = sum(have.leads, rec.leads);
    have.interested = sum(have.interested, rec.interested);
    have.bounces = sum(have.bounces, rec.bounces);
    have.rows_imported = sum(have.rows_imported, rec.rows_imported);
    have.rows_found = have.rows_found ?? rec.rows_found;
    have.tam_count = have.tam_count ?? rec.tam_count;
    have.query = have.query ?? rec.query;
    have.pool = have.pool ?? rec.pool;
    have.method_note = have.method_note ?? rec.method_note;
    if (have.written_at == null || (rec.written_at != null && rec.written_at > have.written_at)) have.written_at = rec.written_at;
    have.repeatable = repeatability(have.source_kind, have.query, have.pool);
  }
  return [...byId.values()];
}

function sum(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

/**
 * Stable identity of a query. Two campaigns whose builds have the same
 * fingerprint share one pool: it is counted once and split, never counted
 * per campaign (D48). Order inside lists does not matter.
 */
export function queryFingerprint(query: BuildQuery | null): string {
  if (!query) return "none";
  const sorted = (list?: readonly string[]) => (list ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean).sort();
  return JSON.stringify({
    titles: sorted(query.job_titles),
    job_function: (query.job_function ?? "").toLowerCase(),
    seniority: sorted(query.seniority),
    bands: sorted(query.company_size),
    countries: sorted(query.countries),
    states: sorted(query.states),
    cities: sorted(query.cities),
    geo_fence: query.geo_fence ? `${query.geo_fence.schema}.${query.geo_fence.table}` : "",
    industries: sorted(query.industries),
    description: (query.company_description ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
    fallback: sorted(query.fallback_personas),
  });
}

/** One line for the report's strategy column. Names the build, never a person. */
export function strategyLine(build: BuildRecord | null, recipeId: string): string {
  if (!build) return `No build on record. Repeats ${recipeId} only if Josh confirms the method.`;
  const label = build.build_label ?? build.build_id;
  const earned = build.interested != null && build.interested > 0 ? `${build.interested} interested` : "no interested replies on record";
  const how = build.source_kind === "vendor_search" ? "same vendor query" : build.source_kind === "stored_pool" ? `same stored ${build.pool?.kind ?? "pool"}` : "method unknown";
  const flag = build.reconstructed ? " Method reconstructed after the fact." : "";
  return `Repeats ${label} (${build.vendor}, ${earned}): ${how}.${flag}`;
}
