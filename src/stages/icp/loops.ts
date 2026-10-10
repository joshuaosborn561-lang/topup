import type { GradeResult, IcpGate } from "../../clients/icpGate.js";

/**
 * The two loops every website check runs (D60, D71): fetch the batch's
 * sites with our own edge function, up to three calls side by side, then
 * grade them one call at a time. Both stop when the function reports
 * nothing left, when it stops making progress, or at MAX_CALLS. Counts
 * only; nothing here sees a page or a person.
 */
export const FETCH_PER_CALL = 100;
export const FETCH_WORKERS = 30;
export const FETCH_PARALLEL = 3;
export const GRADE_PER_CALL = 300;
export const GRADE_WORKERS = 20;
export const MAX_CALLS = 120;
export const SITE_TEXT = "client_salesglider.icp_site_text";
export const LLM_RESULTS = "client_salesglider.icp_llm_results";
export const DISCO_MODEL = "discolike:website";

export interface FetchTally {
  fetched: number;
  fetched_ok: number;
}

export interface GradeTally {
  graded: number;
  errors: number;
  last_error: string | null;
}

export async function fetchAll(gate: Pick<IcpGate, "fetchSites">, batch: string): Promise<FetchTally> {
  let fetched = 0;
  let fetchedOk = 0;
  let remaining = Number.POSITIVE_INFINITY;
  for (let calls = 0; remaining > 0 && calls < MAX_CALLS; calls += FETCH_PARALLEL) {
    const results = await Promise.all(Array.from({ length: FETCH_PARALLEL }, () => gate.fetchSites(batch, FETCH_PER_CALL, FETCH_WORKERS)));
    fetched += results.reduce((a, r) => a + r.processed, 0);
    fetchedOk += results.reduce((a, r) => a + r.ok, 0);
    remaining = Math.min(...results.map((r) => r.remaining));
    if (results.every((r) => r.processed === 0) && remaining > 0) break;
  }
  return { fetched, fetched_ok: fetchedOk };
}

/** One grading call at a time (the function does not claim rows). Two idle calls in a row end the loop. */
export async function gradeAll(grade: (n: number, w: number) => Promise<GradeResult>): Promise<GradeTally> {
  let graded = 0;
  let errors = 0;
  let lastError: string | null = null;
  let left = Number.POSITIVE_INFINITY;
  let idle = 0;
  for (let calls = 0; left > 0 && calls < MAX_CALLS && idle < 2; calls++) {
    const r = await grade(GRADE_PER_CALL, GRADE_WORKERS);
    graded += r.processed;
    errors += r.errors;
    if (r.last_error) lastError = r.last_error;
    left = r.remaining;
    idle = r.processed === 0 ? idle + 1 : 0;
  }
  return { graded, errors, last_error: lastError };
}
