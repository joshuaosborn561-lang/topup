import { collapseSpace, stripNoise, stripPipes, titleWord } from "./text.js";

/**
 * First-name normalization (skill: name-city-normalization). The copy opens
 * with `{{first_name_n}}`; "Hey JOHN," and "Hey Dr. John A., MBA" are dead
 * emails. Rules ported from the skill's edge cases:
 *
 *   - honorifics and credentials stripped (Dr., Mr., MBA, CPA, PhD, Jr.)
 *   - a quoted or parenthesised nickname wins: Robert "Bob" -> Bob
 *   - only the first given name is kept: "John A." -> John, "Mary Ann" -> Mary
 *     (hyphenated Mary-Ann stays)
 *   - ALL CAPS and all lower are title-cased; mixed case (McKenzie) untouched
 *   - an initial, a single letter, or nothing usable -> null and a flag; the
 *     lead is held rather than greeted with a letter
 */

const HONORIFICS = /^(dr|mr|mrs|ms|miss|prof|rev|sir|dame|hon|capt|col|lt|sgt|fr)\.?$/i;
const CREDENTIALS = /^(mba|cpa|phd|md|dds|esq|jd|pmp|cissp|cfa|cfp|rn|pe|jr|sr|ii|iii|iv|ret)\.?$/i;

export interface NameResult {
  value: string | null;
  flags: string[];
}

export function normalizeFirstName(raw: string | null | undefined): NameResult {
  const flags: string[] = [];
  if (!raw) return { value: null, flags: ["missing"] };
  let s = stripPipes(String(raw));
  // Nickname in quotes or parentheses wins.
  const nick = s.match(/["“”']([A-Za-z][A-Za-z'-]{1,})["“”']/) ?? s.match(/\(([A-Za-z][A-Za-z'-]{1,})\)/);
  if (nick) {
    s = nick[1];
    flags.push("nickname");
  }
  s = stripNoise(s).replace(/\(.*?\)/g, " ");
  // Drop everything after a comma (credentials: "John, MBA").
  s = s.split(",")[0];
  const tokens = collapseSpace(s)
    .split(" ")
    .filter((t) => t && !HONORIFICS.test(t) && !CREDENTIALS.test(t));
  if (tokens.length === 0) return { value: null, flags: [...flags, "unusable"] };
  let first = tokens[0].replace(/[^A-Za-zÀ-ÿ'’-]/g, "");
  if (tokens.length > 1) flags.push("multi_token");
  if (first.replace(/[^A-Za-zÀ-ÿ]/g, "").length < 2) {
    // "J." or "A" — try the next token before giving up.
    const next = tokens.slice(1).find((t) => t.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 2);
    if (!next) return { value: null, flags: [...flags, "initial_only"] };
    first = next.replace(/[^A-Za-zÀ-ÿ'’-]/g, "");
    flags.push("used_second_token");
  }
  const cased = titleWord(first);
  if (cased !== first) flags.push("recased");
  return { value: cased, flags };
}

/**
 * City cleanup for the location and team steps. Returns a cleaned city and
 * state; NEVER writes back to the raw city column (a script that did broke
 * geocoding downstream — design 3.3 F).
 */
export interface CityResult {
  city: string | null;
  state: string | null;
  flags: string[];
}

const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = collapseSpace(String(raw)).toLowerCase();
  if (!s) return null;
  if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_ABBR[s] ?? null;
}

export function normalizeCity(rawCity: string | null | undefined, rawState?: string | null): CityResult {
  const flags: string[] = [];
  let state = normalizeState(rawState);
  if (!rawCity) return { city: null, state, flags: ["no_city"] };
  let s = stripNoise(stripPipes(String(rawCity)));
  // "Greater Chicago Area" / "Dallas-Fort Worth Metroplex" / "Chicago Metropolitan Area"
  s = s.replace(/^greater\s+/i, "").replace(/\s+(metropolitan\s+)?area$/i, "").replace(/\s+metroplex$/i, "");
  if (s !== String(rawCity).trim()) flags.push("area_phrase_stripped");
  // "Naperville, IL" / "Naperville, Illinois" / "Naperville, IL, United States"
  const parts = s.split(",").map((p) => collapseSpace(p)).filter(Boolean);
  if (parts.length > 1) {
    const maybeState = normalizeState(parts[1]);
    if (maybeState && !state) state = maybeState;
    s = parts[0];
    flags.push("state_split_from_city");
  }
  s = collapseSpace(s);
  if (!s) return { city: null, state, flags: [...flags, "no_city"] };
  const city = s
    .split(" ")
    .map((w) => titleWord(w))
    .join(" ")
    .replace(/\bSt\b\.?/g, "St.")
    .replace(/\bFt\b\.?/g, "Fort");
  return { city, state, flags };
}
