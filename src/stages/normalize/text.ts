/** Shared text helpers for the normalizers. */

const SMALL_WORDS = new Set(["of", "and", "the", "for", "at", "in", "on", "by", "to", "a", "an", "de", "la", "del", "&"]);

export function collapseSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip pipes and anything that follows one: "Acme | IT Services" -> "Acme". */
export function stripPipes(s: string): string {
  const i = s.indexOf("|");
  return (i >= 0 ? s.slice(0, i) : s).trim();
}

export function hasVowel(word: string): boolean {
  return /[aeiouy]/i.test(word);
}

export function isAllCaps(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
}

/** Title-case one word, keeping internal apostrophes and hyphens (O'Brien, Mary-Ann, McDonald untouched if already mixed). */
export function titleWord(word: string): string {
  if (!word) return word;
  // Already mixed case (McDonald, iPhone): leave it.
  if (word !== word.toLowerCase() && word !== word.toUpperCase()) return word;
  return word
    .toLowerCase()
    .split(/(['’-])/)
    .map((part, i) => (i % 2 === 1 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/** Title case a phrase; small words stay lower unless first. */
export function titlePhrase(s: string): string {
  return collapseSpace(s)
    .split(" ")
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lw)) return lw === "&" ? "&" : lw;
      return titleWord(w);
    })
    .join(" ");
}

/** Remove emoji, control characters and stray quotes. */
export function stripNoise(s: string): string {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[“”"]/g, "")
    .trim();
}
