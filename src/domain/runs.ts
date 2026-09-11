/**
 * Run status vocabulary (design 3.2). The database decides what "open" means
 * via topup.run_is_open(); this list must agree with it (guard: invariants).
 */
export const RUN_STATUSES = [
  "open",
  "pulling",
  "resolving",
  "verifying",
  "normalizing",
  "qa",
  "routing",
  "awaiting_josh",
  "awaiting_operator",
  "staging",
  "importing",
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
] as const;
export type Step = (typeof STEPS)[number];

/** A step that fails this many times parks the run and posts once. */
export const MAX_STEP_ATTEMPTS = 3;

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
