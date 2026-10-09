/**
 * D51 / D61 — nothing starts on its own. The old runway watch opened runs
 * with opened_by "watch" / "the watch" and trigger runway or scheduled.
 * A verb opens a job as trigger=manual with a human or MCP actor.
 */

const WATCH_ACTOR = /^(the\s+)?watch$/i;

export function isWatchActor(by: string | null | undefined): boolean {
  return WATCH_ACTOR.test((by ?? "").trim());
}

export function isSelfStart(openedBy: string | null | undefined, trigger?: string | null): boolean {
  if (isWatchActor(openedBy)) return true;
  return trigger === "runway" || trigger === "scheduled";
}
