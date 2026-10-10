/**
 * Rules version a step ran under (D66). Stored on run_steps.counts.rules_hash.
 * Bump the string when that step's rules change so a done step reopens
 * instead of returning identical counts. Ask Josh before adding a key.
 */
export const STEP_RULES: Readonly<Record<string, string>> = {
  normalize: "d67:maps-raw-name-join",
};

export function stepRulesHash(step: string): string | null {
  const hash = STEP_RULES[step];
  return hash && hash.length > 0 ? hash : null;
}

export function storedRulesHash(counts: unknown): string | null {
  if (!counts || typeof counts !== "object") return null;
  const v = (counts as Record<string, unknown>).rules_hash;
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Stamp the current rules hash onto a step's counts payload. */
export function withRulesHash(step: string, counts: Record<string, unknown>): Record<string, unknown> {
  const hash = stepRulesHash(step);
  return hash ? { ...counts, rules_hash: hash } : counts;
}
