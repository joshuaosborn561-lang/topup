import { bandFromHeadcount, bandFromUnknownSize, normalizeDomain, type Band } from "./bands.js";

/**
 * Free company-size lookups when getleads has no band. Counts / a headcount
 * only — never an email. Used by D38 backfill.
 */

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

export async function wikidataBand(domain: string, fetchImpl: FetchLike = fetch): Promise<Band | null> {
  const host = normalizeDomain(domain);
  if (!host) return null;
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sparql = `
SELECT ?employees WHERE {
  ?company wdt:P856 ?url .
  FILTER(REGEX(LCASE(STR(?url)), "^https?://(www\\\\.)?${escaped}/?$", "i"))
  ?company wdt:P1128 ?employees .
} LIMIT 5`.trim();
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const res = await fetchImpl(url, { headers: { accept: "application/sparql-results+json", "user-agent": "leadtopup/0.1 (company size backfill)" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { results?: { bindings?: Array<{ employees?: { value?: string } }> } };
  const values = (body.results?.bindings ?? [])
    .map((b) => Number(b.employees?.value))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!values.length) return null;
  return bandFromHeadcount(values.sort((a, b) => b - a)[0]!);
}

/** Clearbit company suggest is unauthenticated and sometimes carries a headcount. */
export async function clearbitSuggestBand(domain: string, fetchImpl: FetchLike = fetch): Promise<Band | null> {
  const host = normalizeDomain(domain);
  if (!host) return null;
  const url = `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(host)}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const rows = (await res.json()) as Array<{
    domain?: string;
    metrics?: { employees?: number; employeesRange?: string };
  }>;
  if (!Array.isArray(rows)) return null;
  const hit = rows.find((r) => (r.domain ?? "").toLowerCase().replace(/^www\./, "") === host) ?? rows[0];
  if (!hit) return null;
  return bandFromHeadcount(Number(hit.metrics?.employees)) ?? bandFromUnknownSize(hit.metrics?.employeesRange);
}

export async function freeElsewhereBand(
  domain: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ band: Band; source: string } | null> {
  try {
    const wiki = await wikidataBand(domain, fetchImpl);
    if (wiki) return { band: wiki, source: "wikidata" };
  } catch {
    /* keep going */
  }
  try {
    const cb = await clearbitSuggestBand(domain, fetchImpl);
    if (cb) return { band: cb, source: "clearbit_suggest" };
  } catch {
    /* keep going */
  }
  return null;
}

/** $5 is the auto cap and the ceiling for the whole backfill, not per lead. */
export const BACKFILL_PAID_CAP_CENTS = 500;

export function canAffordBackfill(spentCents: number, nextWorstCents: number, cap = BACKFILL_PAID_CAP_CENTS): boolean {
  if (nextWorstCents <= 0) return true;
  return spentCents + nextWorstCents <= cap;
}
