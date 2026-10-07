/**
 * A retry must not ingest the same run and campaign again, and two campaigns
 * in one lane must not both keep the same person.
 */

const PERSON_COLUMNS = ["person_id", "linkedin_url", "profile_url"] as const;

/** Reuse the stored job, or rows already landed for this source_label. */
export function shouldReuseIngest(jobId: string | null, rowsAlready: number): boolean {
  return Boolean(jobId) || rowsAlready > 0;
}

/** Match clause for one copy per email and per person id. Null when the table has neither. */
export function dedupeMatchSql(cols: ReadonlySet<string>): string | null {
  const parts: string[] = [];
  if (cols.has("email")) {
    parts.push("(a.email is not null and b.email is not null and lower(a.email) = lower(b.email))");
  }
  for (const col of PERSON_COLUMNS) {
    if (!cols.has(col)) continue;
    parts.push(`(a."${col}" is not null and b."${col}" is not null and a."${col}"::text = b."${col}"::text)`);
  }
  return parts.length ? parts.join(" or ") : null;
}
