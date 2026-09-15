import { STATE_CODES } from "./names.js";
import { capitalize, collapseSpace, hasVowel, isLower, isUpper } from "./text.js";

/**
 * Company-name normalization: the eleven rules of
 * `skills/company-name-normalization/SKILL.md`, in the skill's order, plus its
 * "hard-won fixes" (D25). The skill ships no script, so the SKILL.md is the
 * specification and each rule below cites its number.
 *
 * Output reads the way someone says the company out loud: "Fay Servicing",
 * never "Fay Servicing, Llc". A new value is returned; the raw column is
 * never written.
 */

export interface CompanyRefs {
  /** Josh's by-hand initialism list (topup.ref_acronyms), upper case. The skill's known limitation: "Mgic", "Hme". */
  acronyms: ReadonlySet<string>;
}

export interface CompanyResult {
  value: string | null;
  flags: string[];
}

/** Rule 4: legal suffixes, trailing and mid-string, punctuation ignored. LP is here on purpose (hard-won fix). */
export const LEGAL_SUFFIXES: ReadonlySet<string> = new Set([
  "llc", "llp", "lp", "pllc", "pc", "pa", "ps", "inc", "corp", "ltd", "co", "company", "na", "lc", "dba",
]);

/** Rule 7: the only generic tails. Partners, Associates, Consultants, Technologies, Systems, Management are the brand. */
export const GENERIC_TAILS: ReadonlySet<string> = new Set([
  "services", "service", "solutions", "group", "holdings", "enterprises", "industries", "international", "worldwide", "usa",
]);

/** Rules 8 and 11: filler words. */
const FILLER: ReadonlySet<string> = new Set(["of", "and", "the", "for", "at", "in", "on", "by", "to", "a", "an", "&"]);

/** Rule 9 exclusion: common short words that happen to have no vowel. */
const COMMON_SHORT: ReadonlySet<string> = new Set(["by", "my", "st", "mt", "ft", "dr", "mr", "mrs", "ms", "hwy", "rd", "ln", "nth", "pty"]);

export const MAX_COMPANY_LEN = 40;

function bare(token: string): string {
  return token.toLowerCase().replace(/[.,;:'’"]/g, "");
}

export function normalizeCompany(raw: string | null | undefined, refs: CompanyRefs): CompanyResult {
  if (!raw || !raw.trim()) return { value: null, flags: ["missing"] };
  const flags: string[] = [];
  let s = collapseSpace(raw);

  // 1. Fix casing. Mixed case brand names are left alone (JobNimbus stays JobNimbus).
  if (isUpper(s) || isLower(s)) {
    s = s
      .split(" ")
      .map((w) => w.split("-").map(capitalize).join("-"))
      .join(" ");
    flags.push("recased");
  }

  // 2. Strip parenthetical tags: "(RIA)", "(USA)".
  const noParen = collapseSpace(s.replace(/\([^)]*\)/g, " "));
  if (noParen !== s) flags.push("parenthetical_stripped");
  s = noParen;

  // 3. Strip subsidiary clauses, comma form (", An ABM Company") and bare form ("An Employee Owned Company").
  const noSub = collapseSpace(s.replace(/(?:,|(?<![-–—|]))\s+an?\s+(?:[\p{L}\p{N}&'’-]+\s+){0,5}company\b.*$/iu, ""));
  if (noSub !== s && noSub) {
    s = noSub;
    flags.push("subsidiary_clause_stripped");
  }

  // 4. Strip legal suffixes, trailing and mid-string ("Roof Ready Llc - A Parker Colorado Roofing Company").
  // Mid-string means directly before a comma or a spaced dash; a bare "Co" inside a name is left alone.
  let tokens = s.split(" ").filter(Boolean);
  const kept: string[] = [];
  tokens.forEach((t, i) => {
    const next = tokens[i + 1];
    const atEnd = i === tokens.length - 1;
    const beforeSep = t.endsWith(",") || (next !== undefined && /^[-–—]$/.test(next));
    if (LEGAL_SUFFIXES.has(bare(t)) && (atEnd || beforeSep) && kept.length > 0) {
      flags.push("legal_suffix_stripped");
      if (t.endsWith(",") && kept.length) kept[kept.length - 1] = kept[kept.length - 1] + ",";
      return;
    }
    kept.push(t);
  });
  tokens = kept;
  // Trailing suffixes can stack ("Acme Holdings Co., Inc.").
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(bare(tokens[tokens.length - 1]))) {
    tokens = tokens.slice(0, -1);
    flags.push("legal_suffix_stripped");
  }
  s = collapseSpace(tokens.join(" ")).replace(/[\s,.\-–—]+$/, "");

  // 5. Strip dash-separated geography; the dash must have whitespace around it so "Multi-Bank" survives.
  // A pipe ("Acme | IT Services") is treated as the same kind of separator; the skill does not mention pipes (PR note).
  const dash = s.split(/\s*\|\s*|\s+[-–—]\s+/);
  if (dash.length > 1 && dash[0].trim()) {
    s = dash[0].trim();
    flags.push("dash_tail_stripped");
  }

  // 6. Strip comma geography and dangling state markers ("Premier Roofing Ca").
  const comma = s.split(",");
  if (comma.length > 1 && comma[0].trim()) {
    s = comma[0].trim();
    flags.push("comma_tail_stripped");
  }
  tokens = s.split(" ").filter(Boolean);
  if (tokens.length > 1 && STATE_CODES.has(tokens[tokens.length - 1].toUpperCase()) && tokens[tokens.length - 1].length === 2) {
    tokens = tokens.slice(0, -1);
    flags.push("state_marker_stripped");
  }

  // 7. One trailing generic descriptor, only when exactly two words remain and no "&"/"and" is present.
  const hasConjunction = tokens.some((t) => t === "&" || t.toLowerCase() === "and");
  if (tokens.length === 2 && !hasConjunction && GENERIC_TAILS.has(bare(tokens[1]))) {
    tokens = tokens.slice(0, 1);
    flags.push("generic_tail_stripped");
  }

  // 8. Filler word casing: "Bank Of Washington" -> "Bank of Washington".
  tokens = tokens.map((t, i) => (i > 0 && FILLER.has(t.toLowerCase()) ? t.toLowerCase() : t));

  // 9. Re-uppercase initialisms: the WHOLE token vowel-less (or on Josh's list) and not a common short word.
  tokens = tokens.map((t) => {
    const letters = t.replace(/[^\p{L}]/gu, "");
    if (!letters || letters.length < 2) return t;
    if (refs.acronyms.has(letters.toUpperCase())) return t.toUpperCase();
    if (letters.length <= 5 && !hasVowel(letters) && !COMMON_SHORT.has(letters.toLowerCase()) && letters === letters.replace(/[^A-Za-z]/g, "")) {
      return t.toUpperCase();
    }
    return t;
  });

  // 10. Apostrophe casing: "O'neill" -> "O'Neill" (single-letter prefix only, so "Macy's" is untouched).
  tokens = tokens.map((t) => t.replace(/^([A-Z])(['’])([a-z])/, (_m, a: string, ap: string, b: string) => a + ap + b.toUpperCase()));

  // 11. Never end on a dangling filler word.
  while (tokens.length > 1 && FILLER.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens = tokens.slice(0, -1);
    flags.push("dangling_filler_stripped");
  }

  const out = collapseSpace(tokens.join(" ")).replace(/[\s,.\-–—|]+$/, "");
  if (!out) return { value: null, flags: [...flags, "unusable"] };
  if (out.length > MAX_COMPANY_LEN) flags.push("long_name");
  // Step 8 QA input: a bare acronym is held ("acronym or broken company names").
  if (/^[A-Z&]{2,6}$/.test(out.replace(/[.\s]/g, ""))) flags.push("acronym");
  return { value: out, flags: [...new Set(flags)] };
}
