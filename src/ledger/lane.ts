import type { Db } from "../db/pool.js";
import { logger } from "../lib/log.js";

const log = logger("ledger");

/**
 * The job log (topup.lane_events): one line per thing that happened on a
 * job, with who did it and what comes next. `job(job_id)` shows the last
 * ten. Counts, ids and words; never a lead.
 */
export interface LaneEventRow {
  id: number;
  client_tag: string;
  lane: string;
  run_id: string | null;
  step: number | null;
  event: string;
  line: string;
  next_intent: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
  at: string;
}

const EVENTS_SHOWN = 12;

export class LaneLedger {
  constructor(private readonly db: Db) {}

  async event(e: {
    client_tag: string;
    lane: string;
    run_id?: string | null;
    event: string;
    line: string;
    next_intent?: string | null;
    actor?: string | null;
    detail?: Record<string, unknown>;
    step?: number | null;
  }): Promise<void> {
    await this.db.query(
      `insert into topup.lane_events (client_tag, lane, run_id, step, event, line, next_intent, actor, detail)
       values ($1,$2,$3, coalesce($4::smallint, (select step from topup.lane_state where client_tag = $1 and lane = $2)), $5,$6,$7,$8,$9)`,
      [e.client_tag, e.lane, e.run_id ?? null, e.step ?? null, e.event, e.line.slice(0, 500), e.next_intent ?? null, e.actor ?? null, JSON.stringify(e.detail ?? {})],
    );
    await this.db.query(
      `insert into topup.lane_state (client_tag, lane, next_intent) values ($1,$2,$3)
       on conflict (client_tag, lane) do update set
         next_intent = coalesce(excluded.next_intent, topup.lane_state.next_intent), updated_at = now()`,
      [e.client_tag, e.lane, e.next_intent ?? null],
    );
    log.info("lane event", { client_tag: e.client_tag, lane: e.lane, event: e.event, run_id: e.run_id ?? undefined });
  }

  async events(clientTag: string, lane: string, limit = EVENTS_SHOWN): Promise<LaneEventRow[]> {
    const { rows } = await this.db.query<LaneEventRow>(
      `select * from topup.lane_events where client_tag = $1 and lane = $2 order by at desc, id desc limit $3`,
      [clientTag, lane, limit],
    );
    return rows;
  }
}
