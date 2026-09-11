import { collapseSpace, hasVowel, isAllCaps, stripNoise, stripPipes, titlePhrase } from "./text.js";

/**
 * Company-name normalization (skill: company-name-normalization). The copy
 * says "{{company_n}}'s ticket history", so the name has to read the way a
 * human would say it:
 *
 *   - pipes and taglines stripped ("Acme | IT Services for SMBs" -> "Acme")
 *   - legal suffixes from topup.ref_company_suffixes removed (Inc, LLC, Corp)
 *   - parentheticals removed
 *   - ALL CAPS words are title-cased UNLESS they are in topup.ref_acronyms
 *     (ACFCU stays ACFCU, never "Acfcu") or have no vowel (XYZ)
 *   - never truncated mid word; long names are flagged, not chopped
 *   - a result that is a bare 2–6 letter acronym is flagged `acronym` for a QA hold
 */

export interface CompanyRefs {
  acronyms: ReadonlySet<string>; // upper case
  suffixes: ReadonlySet<string>; // lower case, punctuation stripped
}

export interface CompanyResult {
  value: string | null;
  flags: string[];
}

const TAGLINE_SEPARATORS = /\s+[-–—:]\s+/;
export const MAX_COMPANY_LEN = 40;

function suffixKey(w: string): string {
  return w.toLowerCase().replace(/[.,]/g, "");
}

export function normalizeCompany(raw: string | null | undefined, refs: CompanyRefs): CompanyResult {
  const flags: string[] = [];
  if (!raw) return { value: null, flags: ["missing"] };
  let s = stripPipes(String(raw));
  if (s !== String(raw).trim()) flags.push("pipe_stripped");
  s = stripNoise(s).replace(/\([^)]*\)/g, " ");
  const tag = s.split(TAGLINE_SEPARATORS);
  if (tag.length > 1) {
    s = tag[0];
    flags.push("tagline_stripped");
  }
  s = collapseSpace(s.replace(/,\s*$/, ""));
  // Strip trailing legal suffixes, repeatedly ("Acme Holdings, Inc." -> "Acme").
  let words = s.replace(/,/g, " ").split(" ").filter(Boolean);
  while (words.length > 1 && refs.suffixes.has(suffixKey(words[words.length - 1]))) {
    words = words.slice(0, -1);
    flags.push("suffix_stripped");
  }
  if (words.length === 0) return { value: null, flags: [...flags, "unusable"] };

  const cased = words.map((w) => {
    const bare = w.replace(/[^A-Za-z&]/g, "");
    if (isAllCaps(bare)) {
      if (refs.acronyms.has(bare.toUpperCase()) || !hasVowel(bare) || bare.length <= 3) return w; // keep upper
      flags.push("recased");
      return titlePhrase(w);
    }
    return w;
  });
  let out = collapseSpace(cased.join(" "));
  if (out === out.toLowerCase()) {
    out = titlePhrase(out);
    flags.push("recased");
  }
  if (out.length > MAX_COMPANY_LEN) flags.push("long_name");
  if (/^[A-Z&]{2,6}$/.test(out.replace(/[.\s]/g, ""))) flags.push("acronym");
  return { value: out, flags: [...new Set(flags)] };
}
