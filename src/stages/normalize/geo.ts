import { normalizeState } from "./names.js";

/**
 * Geocoding shared by conversational-location and sports-team-assignment.
 * Both skill scripts read the free US cities file (kelvins/US-Cities-Database)
 * into a (city, state) -> (lat, lon) map. The service keeps that file in
 * `topup.ref_cities`, loaded once by `npm run seed:cities` (D25); the map here
 * is that table in memory for one run. A city the table does not know is
 * NO_GEOCODE: blank location, no team, never a guess.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

/** key `${city lower}|${STATE code}` -> coordinates. */
export type CityCoords = ReadonlyMap<string, LatLon>;

export function cityKey(city: string, state: string): string {
  return `${city.trim().toLowerCase()}|${state.trim().toUpperCase()}`;
}

/** Cities the free dataset is missing (conversational_location.py MANUAL_COORDS). Also seeded into topup.ref_cities. */
export const MANUAL_COORDS: ReadonlyArray<[string, string, number, number]> = [
  ["winston-salem", "NC", 36.0999, -80.2442],
  ["coeur d'alene", "ID", 47.6777, -116.7805],
  ["wellington", "FL", 26.6617, -80.267],
  ["mclean", "VA", 38.9339, -77.1773],
  ["henrico", "VA", 37.5407, -77.3717],
  ["fort mitchell", "KY", 39.0509, -84.5824],
  ["barrington hills", "IL", 42.1503, -88.1595],
];

const EARTH_RADIUS_MI = 3958.8;

export function haversineMiles(a: LatLon, b: LatLon): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/**
 * conversational_location.py geocode(): exact key, then the manual list, then
 * the St./Saint interchange, then a metro-combo string ("Dallas-Fort Worth")
 * resolved to its first city. Null when nothing matches.
 */
export function geocode(city: string | null | undefined, state: string | null | undefined, coords: CityCoords): LatLon | null {
  const c = (city ?? "").trim().toLowerCase();
  const st = normalizeState(state);
  if (!c || !st) return null;
  const direct = coords.get(cityKey(c, st));
  if (direct) return direct;
  const manual = MANUAL_COORDS.find(([mc, ms]) => mc === c && ms === st);
  if (manual) return { lat: manual[2], lon: manual[3] };
  if (/^st\.?\s+/.test(c)) {
    const alt = coords.get(cityKey("saint " + c.replace(/^st\.?\s+/, ""), st));
    if (alt) return alt;
  }
  if (c.startsWith("saint ")) {
    const alt = coords.get(cityKey("st " + c.slice(6), st));
    if (alt) return alt;
  }
  for (const delim of ["-", "/"]) {
    if (c.includes(delim)) {
      const first = coords.get(cityKey(c.split(delim)[0].trim(), st));
      if (first) return first;
    }
  }
  return null;
}
