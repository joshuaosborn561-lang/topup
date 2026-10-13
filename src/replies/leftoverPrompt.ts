/**
 * D90 — fixed leftover-negative prompt. Explicit stop/remove = unsubscribe.
 * Anything else = not_interested. No body is not sent here (stays unclassified).
 * Ask Josh before changing a word.
 */

export const LEFTOVER_CLASS_QUESTION = "class" as const;

export const LEFTOVER_INSTRUCTIONS =
  "This is one inbound reply to a cold email. Classify it. " +
  "unsubscribe: the person explicitly asks to stop, be removed, unsubscribed, opted out, or never contacted again. " +
  "not_interested: anything else, including not interested, already have a vendor, bad timing, no need, or unclear.";

export const LEFTOVER_CRITERIA = {
  unsubscribe:
    "An explicit request to stop or remove: unsubscribe, take me off, remove me, opt out, stop emailing, do not contact, don't email, never contact, leave me alone.",
  not_interested:
    "Anything else: not interested, no thanks, already have, not a fit, no need, bad timing, or the words do not ask to stop or be removed.",
} as const;

/** The Jev Decisions questions object. One choice. Locked. */
export const LEFTOVER_JEV_QUESTIONS = {
  [LEFTOVER_CLASS_QUESTION]: {
    type: "choice",
    instructions: LEFTOVER_INSTRUCTIONS,
    criteria: LEFTOVER_CRITERIA,
  },
} as const;

export function leftoverJevBody(model: string, inboundBody: string): { model: string; state: { body: string }; questions: typeof LEFTOVER_JEV_QUESTIONS } {
  return { model, state: { body: inboundBody }, questions: LEFTOVER_JEV_QUESTIONS };
}

export function parseLeftoverChoice(raw: unknown): "unsubscribe" | "not_interested" | null {
  const answers = raw && typeof raw === "object" ? (raw as Record<string, unknown>).answers ?? raw : null;
  const node = answers && typeof answers === "object" ? (answers as Record<string, unknown>)[LEFTOVER_CLASS_QUESTION] : null;
  const choice = node && typeof node === "object" ? String((node as Record<string, unknown>).choice ?? "").trim() : "";
  if (choice === "unsubscribe" || choice === "not_interested") return choice;
  return null;
}
