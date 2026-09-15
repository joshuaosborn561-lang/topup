/**
 * Shared text helpers for the normalizers. The casing helpers mirror Python's
 * str.isupper / str.islower / str.capitalize, because the normalizers are
 * ports of the skill scripts and must give the same answers they do.
 */

export function collapseSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Python str.isupper: at least one cased character and no lower-case ones. */
export function isUpper(s: string): boolean {
  return s !== s.toLowerCase() && s === s.toUpperCase();
}

/** Python str.islower: at least one cased character and no upper-case ones. */
export function isLower(s: string): boolean {
  return s !== s.toUpperCase() && s === s.toLowerCase();
}

/** Python str.isalpha for the characters we meet: letters only, non-empty. */
export function isAlpha(s: string): boolean {
  return s.length > 0 && /^\p{L}+$/u.test(s);
}

/** Python str.capitalize: first character upper, the rest lower. */
export function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Title Case each whitespace-separated word (Python-style capitalize per word). */
export function titleCaseWords(s: string): string {
  return s
    .split(" ")
    .map((w) => capitalize(w))
    .join(" ");
}

export function hasVowel(word: string): boolean {
  return /[aeiouy]/i.test(word);
}
