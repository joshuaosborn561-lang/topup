/**
 * D81 — classify a Smartlead negative as unsubscribe vs not_interested.
 * Text and category first. Smartlead category Do Not Contact (id 4) is
 * not a class: Smartlead stamps that on every negative. AI is only the
 * leftover. Counts and ids; never a lead email or name.
 */

export const NOT_INTERESTED_CATEGORY_ID = 3;
export const SMARTLEAD_DNC_CATEGORY_ID = 4;

export type NegativeClass = "unsubscribe" | "not_interested";
export type ClassSource = "text" | "category" | "status" | "ai";

/** Explicit stop-ask in the reply body. "do not contact" here is the person's words, not Smartlead's label. */
export const UNSUB_TEXT =
  /unsubscrib|take me off|remove me|opt[\s_-]*out|stop (?:email|contact|send)|do not (?:contact|email)|don't (?:contact|email)|never (?:email|contact)|leave me alone/i;

export const NOT_INTERESTED_TEXT =
  /not interested|no thanks|no thank you|not a (?:good )?fit|already have|not right now|no need|don't need/i;

/** Real unsub words on the category field. Not "Do Not Contact" — that is Smartlead's dump of all negatives. */
export const UNSUB_CATEGORY = /unsubscrib|remove[\s_-]*me|opt[\s_-]*out|take me off/i;

/** Same patterns as Postgres POSIX in migration 0025. Keep them in lockstep. */
export const UNSUB_TEXT_SQL =
  "unsubscrib|take me off|remove me|opt[[:space:]_-]*out|stop (email|contact|send)|do not (contact|email)|don''t (contact|email)|never (email|contact)|leave me alone";
export const NOT_INTERESTED_TEXT_SQL =
  "not interested|no thanks|no thank you|not a (good )?fit|already have|not right now|no need|don''t need";
export const UNSUB_CATEGORY_SQL = "unsubscrib|remove[[:space:]_-]*me|opt[[:space:]_-]*out|take me off";

export interface ClassifyInput {
  body?: string | null;
  category?: string | null;
  category_id?: number | null;
  status?: string | null;
}

export type ClassifyResult =
  | { class: NegativeClass; source: Exclude<ClassSource, "ai">; needs_ai: false }
  | { class: null; source: "needs_ai"; needs_ai: true };

export function isNegativeLead(input: ClassifyInput): boolean {
  const status = (input.status ?? "").toLowerCase();
  return input.category_id === NOT_INTERESTED_CATEGORY_ID || input.category_id === SMARTLEAD_DNC_CATEGORY_ID || status === "unsubscribed";
}

/** Text, then category, then status. AI is the leftover — this function never calls it. */
export function classifyNegative(input: ClassifyInput): ClassifyResult {
  const body = input.body ?? "";
  const category = input.category ?? "";
  const status = (input.status ?? "").toLowerCase();
  if (status === "unsubscribed") return { class: "unsubscribe", source: "status", needs_ai: false };
  if (UNSUB_TEXT.test(body)) return { class: "unsubscribe", source: "text", needs_ai: false };
  if (NOT_INTERESTED_TEXT.test(body)) return { class: "not_interested", source: "text", needs_ai: false };
  if (UNSUB_CATEGORY.test(category)) return { class: "unsubscribe", source: "category", needs_ai: false };
  if (input.category_id === NOT_INTERESTED_CATEGORY_ID) return { class: "not_interested", source: "category", needs_ai: false };
  return { class: null, source: "needs_ai", needs_ai: true };
}
