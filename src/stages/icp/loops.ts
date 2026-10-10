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

/** Defaults for site_check(people): ~50 fetch workers, ~28 Gemini / Jev. Env and params override (D73). */
export const PEOPLE_FETCH_PARALLEL = 2;
export const PEOPLE_FETCH_WORKERS = 25;
export const PEOPLE_FETCH_PER_CALL = 50;
export const PEOPLE_FETCH_PER_HOST = 2;
export const PEOPLE_EXTRACT_PARALLEL = 4;
export const PEOPLE_EXTRACT_WORKERS = 7;
export const PEOPLE_EXTRACT_PER_CALL = 28;
export const PEOPLE_ASK_PARALLEL = 4;
export const PEOPLE_ASK_WORKERS = 7;
export const PEOPLE_ASK_PER_CALL = 28;
export const PEOPLE_GEMINI_RPM = 200;

export interface LoopOpts {
  parallel: number;
  perCall: number;
  workers: number;
  maxCalls?: number;
}

export interface PeopleLoopConfig {
  fetch: LoopOpts;
  extract: LoopOpts;
  ask: LoopOpts;
  perHost: number;
  geminiRpm: number;
}

export interface FetchTally {
  fetched: number;
  fetched_ok: number;
}

export interface GradeTally {
  graded: number;
  errors: number;
  last_error: string | null;
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

export function peopleLoopConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<{
  fetch_parallel: number;
  fetch_workers: number;
  fetch_per_call: number;
  extract_parallel: number;
  extract_workers: number;
  extract_per_call: number;
  ask_parallel: number;
  ask_workers: number;
  ask_per_call: number;
  per_host: number;
  gemini_rpm: number;
}> = {}): PeopleLoopConfig {
  const num = (k: string, d: number) => {
    const v = env[k];
    if (v == null || v === "") return d;
    return Number(v);
  };
  return {
    fetch: loopOpts(
      { parallel: overrides.fetch_parallel ?? num("SITE_PEOPLE_FETCH_PARALLEL", PEOPLE_FETCH_PARALLEL), workers: overrides.fetch_workers ?? num("SITE_PEOPLE_FETCH_WORKERS", PEOPLE_FETCH_WORKERS), perCall: overrides.fetch_per_call ?? num("SITE_PEOPLE_FETCH_PER_CALL", PEOPLE_FETCH_PER_CALL) },
      { parallel: PEOPLE_FETCH_PARALLEL, workers: PEOPLE_FETCH_WORKERS, perCall: PEOPLE_FETCH_PER_CALL },
    ),
    extract: loopOpts(
      { parallel: overrides.extract_parallel ?? num("SITE_PEOPLE_EXTRACT_PARALLEL", PEOPLE_EXTRACT_PARALLEL), workers: overrides.extract_workers ?? num("SITE_PEOPLE_EXTRACT_WORKERS", PEOPLE_EXTRACT_WORKERS), perCall: overrides.extract_per_call ?? num("SITE_PEOPLE_EXTRACT_PER_CALL", PEOPLE_EXTRACT_PER_CALL) },
      { parallel: PEOPLE_EXTRACT_PARALLEL, workers: PEOPLE_EXTRACT_WORKERS, perCall: PEOPLE_EXTRACT_PER_CALL },
    ),
    ask: loopOpts(
      { parallel: overrides.ask_parallel ?? num("SITE_PEOPLE_ASK_PARALLEL", PEOPLE_ASK_PARALLEL), workers: overrides.ask_workers ?? num("SITE_PEOPLE_ASK_WORKERS", PEOPLE_ASK_WORKERS), perCall: overrides.ask_per_call ?? num("SITE_PEOPLE_ASK_PER_CALL", PEOPLE_ASK_PER_CALL) },
      { parallel: PEOPLE_ASK_PARALLEL, workers: PEOPLE_ASK_WORKERS, perCall: PEOPLE_ASK_PER_CALL },
    ),
    perHost: clampInt(overrides.per_host ?? num("SITE_PEOPLE_FETCH_PER_HOST", PEOPLE_FETCH_PER_HOST), 1, 4, PEOPLE_FETCH_PER_HOST),
    geminiRpm: clampInt(overrides.gemini_rpm ?? num("SITE_PEOPLE_GEMINI_RPM", PEOPLE_GEMINI_RPM), 1, 4000, PEOPLE_GEMINI_RPM),
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
  return { graded, errors, last_error: lastError };
}
