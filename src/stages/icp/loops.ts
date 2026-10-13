import type { GradeResult, IcpGate } from "../../clients/icpGate.js";
import { withBackoff } from "../../lib/backoff.js";

/**
 * The two loops every website check runs (D60, D71, D73): fetch the
 * batch's sites with our own edge function, then grade them. Both stop
 * when the function reports nothing left, when it stops making progress,
 * or at MAX_CALLS. People loops fan out many invocations (rows claimed
 * SKIP LOCKED). ICP keeps the older three-wide fetch / one-wide grade.
 * Counts only; nothing here sees a page or a person.
 */
export const FETCH_PER_CALL = 100;
export const FETCH_WORKERS = 30;
export const FETCH_PARALLEL = 3;
export const GRADE_PER_CALL = 300;
export const GRADE_WORKERS = 20;
export const GRADE_PARALLEL = 1;
export const MAX_CALLS = 120;
export const SITE_TEXT = "client_salesglider.icp_site_text";
export const LLM_RESULTS = "client_salesglider.icp_llm_results";
export const DISCO_MODEL = "discolike:website";

export const PEOPLE_FETCH_WORKERS = 25;
export const PEOPLE_FETCH_PER_HOST = 2;
export const PEOPLE_EXTRACT_WORKERS = 7;
export const PEOPLE_ASK_PARALLEL = 4;
export const PEOPLE_ASK_PER_CALL = 28;

export interface LoopOpts {
  parallel: number;
  perCall: number;
  workers: number;
  maxCalls?: number;
}

export interface FetchTally {
  fetched: number;
  fetched_ok: number;
}

export interface GradeTally {
  graded: number;
  errors: number;
  last_error: string | null;
  /** Domains still waiting for a grade when the loop stopped. */
  remaining: number;
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return fallback;
  return Math.min(max, i);
}

export function loopOpts(partial: Partial<LoopOpts> | undefined, fallback: LoopOpts): LoopOpts {
  return {
    parallel: clampInt(partial?.parallel ?? fallback.parallel, 1, 32, fallback.parallel),
    perCall: clampInt(partial?.perCall ?? fallback.perCall, 1, 500, fallback.perCall),
    workers: clampInt(partial?.workers ?? fallback.workers, 1, 60, fallback.workers),
    maxCalls: clampInt(partial?.maxCalls ?? fallback.maxCalls ?? MAX_CALLS, 1, 400, MAX_CALLS),
  };
}

const ICP_FETCH: LoopOpts = { parallel: FETCH_PARALLEL, perCall: FETCH_PER_CALL, workers: FETCH_WORKERS };
const ICP_GRADE: LoopOpts = { parallel: GRADE_PARALLEL, perCall: GRADE_PER_CALL, workers: GRADE_WORKERS };

export async function fetchAll(gate: Pick<IcpGate, "fetchSites">, batch: string, opts: LoopOpts = ICP_FETCH): Promise<FetchTally> {
  const o = loopOpts(opts, ICP_FETCH);
  let fetched = 0;
  let fetchedOk = 0;
  let remaining = Number.POSITIVE_INFINITY;
  for (let calls = 0; remaining > 0 && calls < (o.maxCalls ?? MAX_CALLS); calls += o.parallel) {
    const results = await Promise.all(Array.from({ length: o.parallel }, () => withBackoff(() => gate.fetchSites(batch, o.perCall, o.workers))));
    fetched += results.reduce((a, r) => a + r.processed, 0);
    fetchedOk += results.reduce((a, r) => a + r.ok, 0);
    remaining = Math.min(...results.map((r) => r.remaining));
    if (results.every((r) => r.processed === 0) && remaining > 0) break;
  }
  return { fetched, fetched_ok: fetchedOk };
}

/** Parallel grading is safe only when the function claims rows (SKIP LOCKED). ICP grade does not — keep parallel=1. */
export async function gradeAll(grade: (n: number, w: number) => Promise<GradeResult>, opts: LoopOpts = ICP_GRADE): Promise<GradeTally> {
  const o = loopOpts(opts, ICP_GRADE);
  let graded = 0;
  let errors = 0;
  let lastError: string | null = null;
  let left = Number.POSITIVE_INFINITY;
  let idle = 0;
  for (let calls = 0; left > 0 && calls < (o.maxCalls ?? MAX_CALLS) && idle < 2; calls += o.parallel) {
    const results = await Promise.all(Array.from({ length: o.parallel }, () => withBackoff(() => grade(o.perCall, o.workers))));
    for (const r of results) {
      graded += r.processed;
      errors += r.errors;
      if (r.last_error) lastError = r.last_error;
    }
    left = Math.min(...results.map((r) => r.remaining));
    idle = results.every((r) => r.processed === 0) ? idle + 1 : 0;
  }
  return { graded, errors, last_error: lastError, remaining: Number.isFinite(left) ? left : 0 };
}
