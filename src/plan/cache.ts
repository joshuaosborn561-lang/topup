import type { Queryable } from "../db/pool.js";
import type { PilotScore } from "../stages/size/pilot.js";

/**
 * Counts and pilot scores are cached per pool fingerprint on the size step
 * that measured them (D48). An unchanged recipe is not re-piloted or
 * re-counted on every run. The cache lives in topup.run_steps.counts under
 * `pool_cache`, so there is no new table and the ledger stays the record.
 */
export const COUNT_CACHE_HOURS = 24;
/** A pilot score holds while the fingerprint is unchanged; it is not a count that drifts daily. */
export const PILOT_CACHE_DAYS = 30;

export interface PoolCacheEntry {
  fingerprint: string;
  measured_at: string;
  getleads_count: number | null;
  ai_ark_count: number | null;
  ai_ark_error: string | null;
  ai_ark_called: boolean;
  held: number | null;
  held_method: number | null;
  pilot: PilotScore | null;
  pilot_at: string | null;
}

export interface PoolCacheHit {
  entry: PoolCacheEntry;
  run_id: string;
  /** Counts are fresh (within COUNT_CACHE_HOURS). */
  counts_fresh: boolean;
  /** The pilot is fresh (within PILOT_CACHE_DAYS). */
  pilot_fresh: boolean;
}

export interface PoolCacheReader {
  read(clientTag: string, fingerprint: string): Promise<PoolCacheHit | null>;
}

function parseEntry(raw: unknown): PoolCacheEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.fingerprint !== "string" || typeof e.measured_at !== "string") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const pilot = e.pilot && typeof e.pilot === "object" && !Array.isArray(e.pilot) ? (e.pilot as PilotScore) : null;
  return {
    fingerprint: e.fingerprint,
    measured_at: e.measured_at,
    getleads_count: n(e.getleads_count),
    ai_ark_count: n(e.ai_ark_count),
    ai_ark_error: typeof e.ai_ark_error === "string" ? e.ai_ark_error : null,
    ai_ark_called: Boolean(e.ai_ark_called),
    held: n(e.held),
    held_method: n(e.held_method),
    pilot,
    pilot_at: typeof e.pilot_at === "string" ? e.pilot_at : null,
  };
}

export function freshness(entry: PoolCacheEntry, now: number): { counts_fresh: boolean; pilot_fresh: boolean } {
  const measured = Date.parse(entry.measured_at);
  const pilotAt = entry.pilot_at ? Date.parse(entry.pilot_at) : NaN;
  return {
    counts_fresh: Number.isFinite(measured) && now - measured <= COUNT_CACHE_HOURS * 3600_000,
    pilot_fresh: entry.pilot != null && Number.isFinite(pilotAt) && now - pilotAt <= PILOT_CACHE_DAYS * 86400_000,
  };
}

/** The newest size step of this client that cached this fingerprint. Same client only: pools are per client. */
export class RunStepPoolCache implements PoolCacheReader {
  constructor(
    private readonly db: Queryable,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async read(clientTag: string, fingerprint: string): Promise<PoolCacheHit | null> {
    try {
      const { rows } = await this.db.query<{ run_id: string; entry: unknown }>(
        `select rs.run_id, rs.counts->'pool_cache'->$2 as entry
           from topup.run_steps rs
           join topup.runs r on r.run_id = rs.run_id
          where r.client_tag = $1 and rs.step = 'size'
            and rs.counts->'pool_cache' ? $2
          order by coalesce(rs.finished_at, rs.started_at) desc nulls last
          limit 1`,
        [clientTag, fingerprint],
      );
      const entry = parseEntry(rows[0]?.entry);
      if (!entry || !rows[0]) return null;
      return { entry, run_id: rows[0].run_id, ...freshness(entry, this.now()) };
    } catch {
      return null;
    }
  }
}

/** For tests and dry runs: nothing cached. */
export const NO_CACHE: PoolCacheReader = { read: async () => null };
