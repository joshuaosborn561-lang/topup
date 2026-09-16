import { actualCents, worstCaseCents } from "../spend/prices.js";
import { bandFromHeadcount, bandFromUnknownSize, normalizeDomain, type Band } from "./bands.js";

/**
 * Free company-size lookups when getleads has no band, then one paid leftover
 * vendor (LeadMagic company search). Counts / a headcount only — never an
 * email. Used by D38 backfill.
 */

export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

const UA = "leadtopup/0.1 (company size backfill)";

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function sparqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function employeesFromWikidata(sparql: string, fetchImpl: FetchLike): Promise<Band | null> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const res = await fetchImpl(url, { headers: { accept: "application/sparql-results+json", "user-agent": UA } });
  if (!res.ok) return null;
  const body = (await res.json()) as { results?: { bindings?: Array<{ employees?: { value?: string } }> } };
  const values = (body.results?.bindings ?? [])
    .map((b) => Number(b.employees?.value))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!values.length) return null;
  return bandFromHeadcount(values.sort((a, b) => b - a)[0]!);
}

export async function wikidataBand(domain: string, fetchImpl: FetchLike = fetch): Promise<Band | null> {
  const host = normalizeDomain(domain);
  if (!host) return null;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return employeesFromWikidata(
    `
SELECT ?employees WHERE {
  ?company wdt:P856 ?url .
  FILTER(REGEX(LCASE(STR(?url)), "^https?://(www\\\\.)?${escaped}/?$", "i"))
  ?company wdt:P1128 ?employees .
} LIMIT 5`.trim(),
    fetchImpl,
  );
}

/** Same P1128 lookup, by company label, when the domain is not on Wikidata. */
export async function wikidataBandByName(name: string, fetchImpl: FetchLike = fetch): Promise<Band | null> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return null;
  return employeesFromWikidata(
    `
SELECT ?employees WHERE {
  ?company wdt:P1128 ?employees .
  ?company rdfs:label ?label .
  FILTER(LCASE(STR(?label)) = LCASE("${sparqlString(trimmed)}"))
} LIMIT 5`.trim(),
    fetchImpl,
  );
}

async function clearbitSuggestQuery(query: string, preferDomain: string | null, fetchImpl: FetchLike): Promise<Band | null> {
  const q = query.trim();
  if (q.length < 2) return null;
  const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(q)}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{
    domain?: string;
    metrics?: { employees?: number; employeesRange?: string };
  }>;
  if (!Array.isArray(rows)) return null;
  const hit =
    (preferDomain
      ? rows.find((r) => (r.domain ?? "").toLowerCase().replace(/^www\./, "") === preferDomain)
      : undefined) ?? rows[0];
  if (!hit) return null;
  return bandFromHeadcount(Number(hit.metrics?.employees)) ?? bandFromUnknownSize(hit.metrics?.employeesRange);
}

/** Clearbit company suggest is unauthenticated and sometimes carries a headcount. */
export async function clearbitSuggestBand(domain: string, fetchImpl: FetchLike = fetch): Promise<Band | null> {
  const host = normalizeDomain(domain);
  if (!host) return null;
  return clearbitSuggestQuery(host, host, fetchImpl);
}

/** OpenCorporates search is free; number_of_employees is sparse but $0. */
export async function openCorporatesBand(name: string, fetchImpl: FetchLike = fetch): Promise<Band | null> {
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return null;
  const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(trimmed)}&per_page=5`;
  const res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": UA } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    results?: { companies?: Array<{ company?: { number_of_employees?: number | string | null; name?: string } }> };
  };
  const rows = body.results?.companies ?? [];
  const want = trimmed.toLowerCase();
  const ranked = [...rows].sort((a, b) => {
    const an = (a.company?.name ?? "").toLowerCase();
    const bn = (b.company?.name ?? "").toLowerCase();
    return Number(bn === want) - Number(an === want);
  });
  for (const row of ranked) {
    const band = bandFromUnknownSize(row.company?.number_of_employees);
    if (band) return band;
  }
  return null;
}

export async function freeElsewhereBand(
  domain: string,
  fetchImpl: FetchLike = fetch,
  companyName?: string | null,
): Promise<{ band: Band; source: string } | null> {
  const name = companyName?.trim() || null;
  try {
    const wiki = await wikidataBand(domain, fetchImpl);
    if (wiki) return { band: wiki, source: "wikidata" };
  } catch {
    /* keep going */
  }
  if (name) {
    try {
      const wikiName = await wikidataBandByName(name, fetchImpl);
      if (wikiName) return { band: wikiName, source: "wikidata_name" };
    } catch {
      /* keep going */
    }
  }
  try {
    const cb = await clearbitSuggestBand(domain, fetchImpl);
    if (cb) return { band: cb, source: "clearbit_suggest" };
  } catch {
    /* keep going */
  }
  if (name) {
    try {
      const cbName = await clearbitSuggestQuery(name, normalizeDomain(domain), fetchImpl);
      if (cbName) return { band: cbName, source: "clearbit_suggest" };
    } catch {
      /* keep going */
    }
    try {
      const oc = await openCorporatesBand(name, fetchImpl);
      if (oc) return { band: oc, source: "opencorporates" };
    } catch {
      /* keep going */
    }
  }
  return null;
}

/** $5 is the auto cap and the ceiling for the whole backfill, not per lead. */
export const BACKFILL_PAID_CAP_CENTS = 500;

export const LEADMAGIC_COMPANY_SEARCH_URL = "https://api.leadmagic.io/v3/companies/search";

/** Conservative 1-credit company search (misses are free at the vendor). */
export function leadmagicBackfillWorstCents(): number {
  return worstCaseCents("leadmagic", "company_search", 1);
}

export function canAffordBackfill(spentCents: number, nextWorstCents: number, cap = BACKFILL_PAID_CAP_CENTS): boolean {
  if (nextWorstCents <= 0) return true;
  return spentCents + nextWorstCents <= cap;
}

export type PaidSizeHit = { band: Band | null; cents: number; source: string };

export function bandFromLeadmagicBody(body: unknown): Band | null {
  const root = asObj(body);
  if (!root) return null;
  const firstCompany = Array.isArray(root.companies) ? asObj(root.companies[0]) : null;
  const company = asObj(root.company) ?? firstCompany ?? root;
  const candidates: unknown[] = [
    company.employee_range,
    company.employeeRange,
    company.linkedin_employee_count,
    company.employeeCount,
    company.employee_count,
    company.employee_min,
    company.employeeMin,
    root.employee_range,
    root.employeeRange,
    root.linkedin_employee_count,
    root.employeeCount,
    root.employee_count,
  ];
  for (const raw of candidates) {
    const band = typeof raw === "number" ? bandFromHeadcount(raw) : bandFromUnknownSize(raw);
    if (band) return band;
  }
  return null;
}

function leadmagicCredits(body: unknown, found: boolean): number {
  const root = asObj(body);
  const raw = root?.credits_consumed ?? root?.creditsConsumed;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return found ? 1 : 0;
}

function leadmagicFound(body: unknown): boolean {
  const root = asObj(body);
  if (!root) return false;
  if (root.found === true) return true;
  if (root.found === false) return false;
  const company = asObj(root.company);
  if (company && (company.company_domain || company.company_name || company.companyName)) return true;
  if (typeof root.companyName === "string" && root.companyName.trim()) return true;
  if (typeof root.companyDomain === "string" && root.companyDomain.trim()) return true;
  if (Array.isArray(root.companies) && root.companies.length > 0) return true;
  return false;
}

/**
 * Paid leftover only. 1 credit on a returned company, $0 on a miss.
 * Never called until getleads + free sources have already failed.
 */
export async function leadmagicCompanyBand(
  domain: string,
  companyName: string | null,
  opts: { apiKey: string; fetchImpl?: FetchLike },
): Promise<PaidSizeHit | null> {
  const key = opts.apiKey.trim();
  if (!key) return null;
  const host = normalizeDomain(domain);
  const name = companyName?.trim() || null;
  const body = host ? { company_domain: host } : name ? { company_name: name } : null;
  if (!body) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(LEADMAGIC_COMPANY_SEARCH_URL, {
    method: "POST",
    headers: { "X-API-Key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const found = leadmagicFound(json);
  const credits = leadmagicCredits(json, found);
  const cents = credits > 0 ? actualCents("leadmagic", credits) : 0;
  const band = bandFromLeadmagicBody(json);
  if (!band && cents === 0) return null;
  return { band, cents, source: "leadmagic_company_search" };
}
