import { normalizeCity } from "./names.js";

/**
 * Conversational location (skill: conversational-location). "Naperville"
 * becomes "Chicagoland" because that is what a local says. Rules:
 *
 *   - (city, state) looked up in topup.ref_metro_names; a hit is the answer
 *   - no hit but a city: the cleaned city itself
 *   - no city (NO_GEOCODE): blank, never a broken sentence
 *   - this function returns a NEW field; the raw city column is never touched
 */

export interface MetroRefs {
  /** key `${city.toLowerCase()}|${STATE}` -> conversational name */
  metros: ReadonlyMap<string, string>;
}

export interface LocationResult {
  location: string;
  metro: string | null;
  city: string | null;
  state: string | null;
  source: "ref" | "city" | "blank";
  flags: string[];
}

export function metroKey(city: string, state: string | null): string {
  return `${city.trim().toLowerCase()}|${(state ?? "").toUpperCase()}`;
}

export function conversationalLocation(rawCity: string | null | undefined, rawState: string | null | undefined, refs: MetroRefs): LocationResult {
  const c = normalizeCity(rawCity, rawState);
  if (!c.city) return { location: "", metro: null, city: null, state: c.state, source: "blank", flags: [...c.flags, "no_geocode"] };
  const hit = refs.metros.get(metroKey(c.city, c.state)) ?? (c.state ? undefined : firstStateless(refs, c.city));
  if (hit) return { location: hit, metro: hit, city: c.city, state: c.state, source: "ref", flags: c.flags };
  return { location: c.city, metro: null, city: c.city, state: c.state, source: "city", flags: [...c.flags, "no_metro_ref"] };
}

/** A city with no state: accept a ref hit only when exactly one state has that city. */
function firstStateless(refs: MetroRefs, city: string): string | undefined {
  const prefix = `${city.toLowerCase()}|`;
  const hits = [...refs.metros.entries()].filter(([k]) => k.startsWith(prefix));
  return hits.length === 1 ? hits[0][1] : undefined;
}
