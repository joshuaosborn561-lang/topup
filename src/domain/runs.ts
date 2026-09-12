/**
 * Run status vocabulary (design 3.2). The database decides what "open" means
 * via topup.run_is_open(); this list must agree with it (guard: invariants).
 */
export const RUN_STATUSES = [
  "open",
  "sizing",
  "pulling",
  "ingesting",
  "suppressing",
  "resolving",
  "verifying",
  "normalizing",
  "qa",
  "routing",
  "awaiting_josh",
  "awaiting_operator",
  "staging",
  "importing",
  "checking",
  "done",
  "failed",
  "capacity_bound",
  "not_working",
  "pool_thin",
  "declined",
  "aborted",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

/** Mirrors topup.run_is_open() in 0001_topup_schema.sql. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "done",
  "failed",
  "capacity_bound",
  "not_working",
  "pool_thin",
  "declined",
  "aborted",
];

export function runIsOpen(status: RunStatus): boolean {
  return !TERMINAL_RUN_STATUSES.includes(status);
}

/** Stage names, in pipeline order. run_steps.step takes one of these. */
export const STEPS = [
  "trigger",
  "size",
  "pull",
  "ingest",
  "suppress",
  "find_emails",
  "verify",
  "normalize",
  "qa",
  "route",
  "stage",
  "import",
  "post_import",
  "flip",
] as const;
export type Step = (typeof STEPS)[number];

/** A step that fails this many times parks the run and posts once. */
export const MAX_STEP_ATTEMPTS = 3;

/**
 * The funnel, in step order: the numbers the receipt and `/where` read off the
 * run (`topup.runs.counts_by_status`). Everything else a step counts stays on
 * its own run_steps row.
 */
export const FUNNEL_COUNTS = [
  "plan_rows",
  "rows_exported",
  "rows_claimed",
  "off_title",
  "raw",
  "deduped",
  "suppressed",
  "net_new",
  "verified",
  "rejected",
  "stalled_unverified",
  "normalized",
  "held",
  "qa_passed",
  "qa_purged",
  "qa_rerouted",
  "routed",
  "pending_campaign",
  "staged",
  "imported",
  "import_mismatch",
  "campaigns_checked",
  "ready_for_active",
] as const;

export function funnelCounts(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of FUNNEL_COUNTS) if (k in counts) out[k] = counts[k];
  return out;
}

/** Funnel keys first, in step order; anything else after, alphabetically. */
export function orderCounts(counts: Record<string, number>): [string, number][] {
  const order = new Map<string, number>(FUNNEL_COUNTS.map((k, i) => [k, i]));
  return Object.entries(counts).sort(([a], [b]) => {
    const ia = order.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ib = order.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ia === ib ? a.localeCompare(b) : ia - ib;
  });
}

export type Role = "owner" | "operator";

export interface RunRow {
  run_id: string;
  recipe_id: string;
  client_tag: string;
  lane: string;
  campaign_id: number | null;
  trigger: "runway" | "manual" | "scheduled";
  status: RunStatus;
  current_step: Step | null;
  counts_by_status: Record<string, number>;
  spend_cents_by_vendor: Record<string, number>;
  slack_channel: string | null;
  slack_thread_ts: string | null;
  opened_by: string | null;
  opened_at: string;
  closed_at: string | null;
  last_error: string | null;
}

export interface RunStepRow {
  run_id: string;
  step: Step;
  status: "pending" | "running" | "done" | "failed" | "parked" | "waiting_approval";
  attempts: number;
  started_at: string | null;
  finished_at: string | null;
  vendor_job_id: string | null;
  worst_case_cents: number | null;
  approved_cents: number | null;
  actual_cents: number | null;
  useful_output: number | null;
  counts: Record<string, number>;
  last_error: string | null;
}
