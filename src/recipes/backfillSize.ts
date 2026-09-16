import { GETLEADS_BANDS } from "./schema.js";
import { normalizeDomain, pickBandFromCounts, type Band } from "./bands.js";
import { BACKFILL_PAID_CAP_CENTS, canAffordBackfill, freeElsewhereBand, type FetchLike } from "./elsewhereSize.js";

/**
 * D38 — fill blank company_size on the existing list.
 *
 * Order: cache → other leads already sized (free) → getleads counts
 * (unlimited, $0) → Wikidata / Clearbit suggest (free) → one paid
 * leftover pass whose worst case for *every* remaining lead is ≤ $5.
 * Never pull a contact row. Never invent a band.
 */

export type CountFn = (filters: Record<string, unknown>) => Promise<{ total_matching: number }>;

export async function classifyDomainBand(count: CountFn, domain: string): Promise<Band | null> {
  const host = normalizeDomain(domain);
  if (!host) return null;
  const rows = await Promise.all(
    GETLEADS_BANDS.map(async (band) => {
      const r = await count({ domains: [host], company_size: [band] });
      return { band, n: r.total_matching };
    }),
  );
  const fromDomains = pickBandFromCounts(rows);
  if (fromDomains) return fromDomains;
  const viaEmail = await Promise.all(
    GETLEADS_BANDS.map(async (band) => {
      const r = await count({ email_domain: host, company_size: [band] });
      return { band, n: r.total_matching };
    }),
  );
  return pickBandFromCounts(viaEmail);
}

export async function classifyCompanyNameBand(count: CountFn, companyName: string): Promise<Band | null> {
  const name = companyName.trim();
  if (name.length < 2) return null;
  const rows = await Promise.all(
    GETLEADS_BANDS.map(async (band) => {
      const r = await count({ company_name: name, company_size: [band] });
      return { band, n: r.total_matching };
    }),
  );
  return pickBandFromCounts(rows);
}

/** Which getleads bands have volume for this title set (recipe-level, 8 calls). */
export async function partitionBands(
  count: CountFn,
  titles: string[],
  countries: string[],
  minN = 50,
): Promise<Band[]> {
  if (titles.length === 0) return [];
  const rows = await Promise.all(
    GETLEADS_BANDS.map(async (band) => {
      const r = await count({
        job_titles: titles,
        company_size: [band],
        ...(countries.length ? { countries } : {}),
      });
      return { band, n: r.total_matching };
    }),
  );
  return GETLEADS_BANDS.filter((b) => (rows.find((r) => r.band === b)?.n ?? 0) >= minN);
}

export async function mapPool<T, R>(items: readonly T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export type BackfillProgress = {
  domains: number;
  cached: number;
  sibling: number;
  classified: number;
  elsewhere: number;
  paid: number;
  paid_cents: number;
  unknown: number;
  leads_updated: number;
  skipped_free_mail: number;
};

export type PaidSizeHit = { band: Band; cents: number; source: string };

export type BackfillDeps = {
  listUnsizedDomains: (campaignIds: number[]) => Promise<string[]>;
  companyNameForDomain?: (campaignIds: number[], domain: string) => Promise<string | null>;
  cachedBand: (domain: string) => Promise<Band | null>;
  siblingBand?: (domain: string) => Promise<Band | null>;
  applySiblingSizes?: (campaignIds: number[]) => Promise<number>;
  rememberBand: (domain: string, band: Band, source: string) => Promise<void>;
  applyBand: (campaignIds: number[], domain: string, band: Band) => Promise<number>;
  count: CountFn;
  fetchImpl?: FetchLike;
  /** Paid leftover only. Worst case for the *whole* backfill must stay ≤ $5. */
  paidLookup?: (domain: string, companyName: string | null) => Promise<PaidSizeHit | null>;
  paidWorstCaseCents?: number;
};

/**
 * Cache and sibling sizes first (free), then getleads, then other free
 * sources, then a paid leftover pass under the $5 auto cap.
 */
export async function backfillCompanySizes(
  deps: BackfillDeps,
  campaignIds: number[],
  opts?: { concurrency?: number; paidCapCents?: number },
): Promise<BackfillProgress> {
  const progress: BackfillProgress = {
    domains: 0,
    cached: 0,
    sibling: 0,
    classified: 0,
    elsewhere: 0,
    paid: 0,
    paid_cents: 0,
    unknown: 0,
    leads_updated: 0,
    skipped_free_mail: 0,
  };
  if (campaignIds.length === 0) return progress;

  if (deps.applySiblingSizes) {
    progress.leads_updated += await deps.applySiblingSizes(campaignIds);
    progress.sibling += progress.leads_updated;
  }

  const raw = await deps.listUnsizedDomains(campaignIds);
  const domains: string[] = [];
  for (const r of raw) {
    const host = normalizeDomain(r);
    if (!host) {
      progress.skipped_free_mail += 1;
      continue;
    }
    domains.push(host);
  }
  const unique = [...new Set(domains)];
  progress.domains = unique.length;

  const leftovers: string[] = [];
  const concurrency = opts?.concurrency ?? 8;
  await mapPool(unique, concurrency, async (domain) => {
    const placed = await placeBand(deps, campaignIds, domain, progress);
    if (!placed) leftovers.push(domain);
  });

  const cap = opts?.paidCapCents ?? BACKFILL_PAID_CAP_CENTS;
  const nextWorst = deps.paidWorstCaseCents ?? 0;
  if (deps.paidLookup && leftovers.length && nextWorst > 0) {
    for (const domain of leftovers) {
      if (!canAffordBackfill(progress.paid_cents, nextWorst, cap)) {
        progress.unknown += 1;
        continue;
      }
      try {
        const name = deps.companyNameForDomain ? await deps.companyNameForDomain(campaignIds, domain) : null;
        const hit = await deps.paidLookup(domain, name);
        if (hit && canAffordBackfill(progress.paid_cents, hit.cents, cap)) {
          progress.paid_cents += hit.cents;
          await deps.rememberBand(domain, hit.band, hit.source);
          progress.leads_updated += await deps.applyBand(campaignIds, domain, hit.band);
          progress.paid += 1;
          continue;
        }
      } catch {
        /* count as unknown */
      }
      progress.unknown += 1;
    }
  } else {
    progress.unknown += leftovers.length;
  }

  return progress;
}

async function placeBand(
  deps: BackfillDeps,
  campaignIds: number[],
  domain: string,
  progress: BackfillProgress,
): Promise<boolean> {
  const apply = async (band: Band, source: string, bucket: "cached" | "sibling" | "classified" | "elsewhere") => {
    await deps.rememberBand(domain, band, source);
    progress.leads_updated += await deps.applyBand(campaignIds, domain, band);
    progress[bucket] += 1;
    return true;
  };

  const cached = await deps.cachedBand(domain);
  if (cached) return apply(cached, "cache", "cached");

  if (deps.siblingBand) {
    try {
      const sib = await deps.siblingBand(domain);
      if (sib) return apply(sib, "sibling_leads", "sibling");
    } catch {
      /* continue */
    }
  }

  try {
    const fromGetleads = await classifyDomainBand(deps.count, domain);
    if (fromGetleads) return apply(fromGetleads, "getleads_count", "classified");
  } catch {
    /* continue */
  }

  if (deps.companyNameForDomain) {
    try {
      const name = await deps.companyNameForDomain(campaignIds, domain);
      if (name) {
        const byName = await classifyCompanyNameBand(deps.count, name);
        if (byName) return apply(byName, "getleads_company_name", "classified");
      }
    } catch {
      /* continue */
    }
  }

  try {
    const elsewhere = await freeElsewhereBand(domain, deps.fetchImpl);
    if (elsewhere) return apply(elsewhere.band, elsewhere.source, "elsewhere");
  } catch {
    /* continue */
  }

  return false;
}
