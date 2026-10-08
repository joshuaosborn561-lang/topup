import type { GetleadsFilters } from "../clients/getleads.js";
import { GEO_CHUNK_MAX } from "../recipes/geoFence.js";

/**
 * Plan a query so it never times out, instead of discovering the timeout
 * and retrying (D48). Long city and industry lists are cut into slices up
 * front; the slices run concurrently and their counts are summed, or their
 * exports unioned by person. A slice is the same query with a shorter list.
 */
export const INDUSTRY_CHUNK_MAX = 12;

export interface SlicePlan {
  slices: GetleadsFilters[];
  /** Which list was sliced, for the report. */
  by: "cities" | "industries" | "none";
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Cities first (the geo-fence case), then industries. One list at a time so slices stay disjoint. */
export function planSlices(filters: GetleadsFilters, limits: { maxCities?: number; maxIndustries?: number } = {}): SlicePlan {
  const maxCities = limits.maxCities ?? GEO_CHUNK_MAX;
  const maxIndustries = limits.maxIndustries ?? INDUSTRY_CHUNK_MAX;
  if (filters.cities && filters.cities.length > maxCities) {
    return { by: "cities", slices: chunks(filters.cities, maxCities).map((cities) => ({ ...filters, cities })) };
  }
  if (filters.industries && filters.industries.length > maxIndustries) {
    return { by: "industries", slices: chunks(filters.industries, maxIndustries).map((industries) => ({ ...filters, industries })) };
  }
  return { by: "none", slices: [filters] };
}

/** Disjoint slices add up. The caller runs them concurrently under the vendor cap. */
export function sumSlices(counts: readonly number[]): number {
  return counts.reduce((sum, n) => sum + Math.max(0, Math.floor(n)), 0);
}
