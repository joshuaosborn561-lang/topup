import { capitalize, collapseSpace, isAlpha, isLower, isUpper } from "./text.js";

/**
 * First-name and city normalization. A port of
 * `skills/name-city-normalization/scripts/normalize_names_and_cities.py`,
 * rule for rule and in the script's order (D25). Where this file and the
 * script disagree, the script is right; fix this file.
 *
 * Both functions return a NEW value plus flags. The raw column is never
 * written (skill: "never overwrites source data").
 */

const SUFFIX_PATTERN = /\s+(Jr|Sr|II|III|IV|V)\.?$/i;
const TITLE_PREFIX = /^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s+/i;
const CREDENTIAL_SUFFIX = /,\s*[A-Z]{2,}$/;
const PAREN_NICKNAME = /\(([^)]+)\)/;

/**
 * Only informal variants of the SAME nickname family collapse to the casual
 * form. Formal given names are never converted (James stays James). Do not
 * grow this map without Josh; it came from audit corrections, not a database.
 */
export const NICKNAME_MAP: Readonly<Record<string, string>> = {
  jimmy: "Jim",
  bobby: "Bob",
  billy: "Bill",
  ricky: "Rick",
  tommy: "Tom",
  eddie: "Ed",
  eddy: "Ed",
  ronnie: "Ron",
  donnie: "Don",
  joey: "Joe",
};

export interface NameResult {
  /** The script's answer. Null only when the input was empty. */
  value: string | null;
  flags: string[];
}

function isInitial(word: string): boolean {
  return /^[A-Za-z]\.?$/.test(word);
}

export function normalizeFirstName(raw: string | null | undefined): NameResult {
  if (!raw || !raw.trim()) return { value: null, flags: ["missing"] };
  const flags: string[] = [];
  const trimmed = raw.trim();
  // Strip stray non-name characters (emoji, odd unicode). \w is Unicode-aware, as in the script.
  let name = trimmed.replace(/[^\p{L}\p{N}_\s()\-'.]/gu, "").trim();

  const afterTitle = name.replace(TITLE_PREFIX, "").trim();
  if (afterTitle !== name) flags.push("title_stripped");
  name = afterTitle;

  const afterCred = name.replace(CREDENTIAL_SUFFIX, "").trim();
  if (afterCred !== name) flags.push("credential_stripped");
  name = afterCred;

  // Parenthetical nickname ("Anthony (Tony)") is the preferred name.
  const m = name.match(PAREN_NICKNAME);
  if (m) {
    const nick = m[1].trim();
    if (/^[A-Za-z' -]{1,20}$/.test(nick) && !isUpper(nick)) {
      name = nick;
      flags.push("nickname");
    } else {
      name = name.replace(PAREN_NICKNAME, "").trim();
      flags.push("parenthetical_dropped");
    }
  }

  const afterSuffix = name.replace(SUFFIX_PATTERN, "").trim();
  if (afterSuffix !== name) flags.push("suffix_stripped");
  name = afterSuffix;

  let parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { value: trimmed, flags: [...flags, "unusable_kept_raw"] };

  let result: string;
  if (parts.length > 1 && parts.every(isInitial)) {
    // All-initials names ("C J") stay as they are.
    result = name;
    flags.push("all_initials");
  } else if (parts.length > 1 && isInitial(parts[0])) {
    // Leading initial(s): use the real name that follows.
    const real = parts.filter((p) => !isInitial(p));
    result = real.length ? real.join(" ") : name;
    flags.push("leading_initial_dropped");
  } else {
    // Strip trailing initial(s), then keep the first word only.
    const before = parts.length;
    while (parts.length > 1 && isInitial(parts[parts.length - 1])) parts = parts.slice(0, -1);
    if (parts.length !== before) flags.push("trailing_initial_dropped");
    if (parts.length > 1) flags.push("first_word_only");
    result = parts[0];
  }
  if (parts.length === 1 && isInitial(result)) flags.push("initial_only");

  // Fix casing only on ALL CAPS / all lowercase input.
  if (isUpper(result) || isLower(result)) {
    result = result
      .split("-")
      .map((w) => capitalize(w))
      .join("-");
    result = result
      .split(/\s+/)
      .map((w) => (isAlpha(w) ? capitalize(w) : w))
      .join(" ");
    flags.push("recased");
  }

  const mapped = NICKNAME_MAP[result.toLowerCase()];
  if (mapped) {
    result = mapped;
    flags.push("nickname_consolidated");
  }

  return result ? { value: result, flags } : { value: trimmed, flags: [...flags, "unusable_kept_raw"] };
}

/** Trailing descriptor words the script strips, repeatedly. */
const LOC_SUFFIX_PATTERN = /\s+(Metropolitan\s+Area|Metro\s+Area|Metroplex|Region|Area|Metro)$/i;

export interface CityResult {
  city: string | null;
  flags: string[];
}

/** Plain city cleanup (the script's normalize_city). Not the metro-nickname system; that is location.ts. */
export function normalizeCity(raw: string | null | undefined): CityResult {
  if (!raw || !raw.trim()) return { city: null, flags: ["no_city"] };
  const flags: string[] = [];
  let city = collapseSpace(raw);
  let prev: string | null = null;
  while (prev !== city) {
    prev = city;
    city = city.replace(LOC_SUFFIX_PATTERN, "").trim();
  }
  if (city !== collapseSpace(raw)) flags.push("area_suffix_stripped");
  if (isUpper(city) || isLower(city)) {
    city = city
      .split(" ")
      .map((w) => capitalize(w))
      .join(" ");
    flags.push("recased");
  }
  if (city.includes(",")) flags.push("comma_in_city");
  return { city, flags };
}

const STATE_ABBR: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

export const STATE_CODES: ReadonlySet<string> = new Set(Object.values(STATE_ABBR));

/** assign_team.py norm_state: two letters pass through upper-cased; a full name maps; anything else is null here (the script guessed two letters). */
export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = collapseSpace(String(raw));
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return STATE_ABBR[s.toLowerCase()] ?? null;
}
