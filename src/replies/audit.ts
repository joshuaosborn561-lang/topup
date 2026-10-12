import { worstCaseCents } from "../spend/prices.js";

/**
 * D81 — dry-run audit of past negatives. Text and category first.
 * Estimates the Jev cost for the leftover. Does not call AI. Counts only.
 */

export interface AuditCounts {
  negatives: number;
  text_unsubscribe: number;
  text_not_interested: number;
  category_unsubscribe: number;
  category_not_interested: number;
  status_unsubscribe: number;
  needs_ai: number;
}

export interface AuditEstimate extends AuditCounts {
  dry_run: true;
  apply: false;
  ai_run: false;
  vendor: "jev";
  worst_case_cents: number;
  worst_case_usd: string;
  note: string;
}

/** Live snapshot 12 Oct 2026 on campaignintelligence. Counts only. */
export const LIVE_NEGATIVE_AUDIT: AuditCounts = {
  negatives: 1211,
  text_unsubscribe: 133,
  text_not_interested: 236,
  category_unsubscribe: 0,
  category_not_interested: 787,
  status_unsubscribe: 0,
  needs_ai: 55,
};

export function estimateAudit(counts: AuditCounts): AuditEstimate {
  const cents = worstCaseCents("jev", "grade", counts.needs_ai);
  return {
    ...counts,
    dry_run: true,
    apply: false,
    ai_run: false,
    vendor: "jev",
    worst_case_cents: cents,
    worst_case_usd: `$${(cents / 100).toFixed(2)}`,
    note:
      "Dry-run. Text and category classify first. AI is not run. " +
      "Jev worst case is the leftover only (same unit price as ICP grade). " +
      "Migration 0025_d81_negative_class.sql is unapplied until Josh says so.",
  };
}
