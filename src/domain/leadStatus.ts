/**
 * Per-lead state machine (design 3.2). `lead_status` on
 * lp.<tag>_ingested_leads is moved only by the service, and only along these
 * edges. A transition that is not listed throws, which is how a bug shows up
 * as an error instead of a quietly wrong list.
 */
export const LEAD_STATUSES = [
  "pulled",
  "ingested",
  "suppressed",
  "deduped",
  "needs_email",
  "needs_domain",
  "needs_person",
  "email_found",
  "email_not_found",
  "needs_verify",
  "verifying",
  "verified",
  "rejected",
  "stalled_unverified",
  "normalized",
  "qa_hold",
  "qa_passed",
  "qa_purged",
  "routed",
  "pending_campaign",
  "staged",
  "imported",
  "confirmed",
  "import_mismatch",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

const EDGES: Record<LeadStatus, readonly LeadStatus[]> = {
  pulled: ["ingested"],
  ingested: ["suppressed", "deduped", "needs_email", "needs_domain", "needs_person", "needs_verify"],
  suppressed: [],
  deduped: [],
  needs_email: ["email_found", "email_not_found", "needs_domain", "needs_person"],
  needs_domain: ["needs_person", "needs_email", "email_found"],
  needs_person: ["needs_email", "email_found", "email_not_found"],
  email_found: ["needs_verify"],
  email_not_found: [],
  needs_verify: ["verifying"],
  verifying: ["verified", "rejected", "stalled_unverified", "needs_verify"],
  verified: ["normalized"],
  rejected: [],
  // Residue of a stall is never sent; a later run may re-queue it explicitly.
  stalled_unverified: ["needs_verify"],
  normalized: ["qa_hold", "qa_passed", "qa_purged"],
  qa_hold: ["qa_passed", "qa_purged", "routed"],
  qa_passed: ["routed", "pending_campaign"],
  qa_purged: [],
  routed: ["staged"],
  pending_campaign: ["routed"],
  staged: ["imported", "import_mismatch"],
  imported: ["confirmed", "import_mismatch"],
  confirmed: [],
  import_mismatch: [],
};

/** Statuses a lead may never be moved out of by anything but a human decision. */
export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = (
  Object.keys(EDGES) as LeadStatus[]
).filter((s) => EDGES[s].length === 0);

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

export function assertTransition(from: LeadStatus, to: LeadStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`lead_status ${from} -> ${to} is not a legal transition`);
  }
}

/** Only these statuses may ever be staged into Smartlead. */
export const SENDABLE_LEAD_STATUSES: readonly LeadStatus[] = ["routed"];

/**
 * Statuses that mean "verification did not vouch for this address". Nothing in
 * this set may be staged, whatever else happened (brief section 4: Insight
 * bounced 23.8% because 'passed' was trusted).
 */
export const NEVER_SEND_STATUSES: readonly LeadStatus[] = [
  "pulled",
  "ingested",
  "suppressed",
  "deduped",
  "needs_email",
  "needs_domain",
  "needs_person",
  "email_found",
  "email_not_found",
  "needs_verify",
  "verifying",
  "rejected",
  "stalled_unverified",
  "qa_hold",
  "qa_purged",
  "pending_campaign",
  "import_mismatch",
];
