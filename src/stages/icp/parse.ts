/**
 * Jev's category must be a token from the client's allowed set, never the
 * raw sentence it sometimes writes in `reason` (D64, job 46b1c941).
 */

export const ICP_CATEGORY = /^[a-z][a-z0-9_]{2,80}$/;

export function parseIcpCategory(choice: unknown, reason: unknown): { label: string | null; unparseable: boolean } {
  const token = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return ICP_CATEGORY.test(t) ? t : null;
  };
  const label = token(choice) ?? token(reason);
  const hadText =
    (typeof choice === "string" && choice.trim().length > 0) || (typeof reason === "string" && reason.trim().length > 0);
  return { label, unparseable: !label && hadText };
}

/** SQL: pick answers.category.choice when it is a token, else reason when it is a token, else null. Never the raw sentence. */
export function icpLabelSql(hasAnswers: boolean): string {
  const choice = hasAnswers ? "nullif(btrim(answers->'category'->>'choice'), '')" : "null";
  return `case
    when ${choice} ~ '^[a-z][a-z0-9_]{2,80}$' then ${choice}
    when nullif(btrim(reason), '') ~ '^[a-z][a-z0-9_]{2,80}$' then nullif(btrim(reason), '')
    else null
  end`;
}
