import { logger } from "../lib/log.js";

const log = logger("repo");
import type { Db, Queryable } from "./pool.js";
import type { Role, RunRow, RunStepRow, RunStatus, Step } from "../domain/runs.js";
import { MAX_STEP_ATTEMPTS } from "../domain/runs.js";
import { isSelfStart } from "../jobs/selfStart.js";

/** How a client's leads are found: on LinkedIn (getleads, AI Ark) or by place (Maps, permits). The registry says; the default is LinkedIn. */
export type IcpKind = "linkedin_native" | "non_linkedin";

export function icpKindOf(registryKind: string | null | undefined): IcpKind {
  return registryKind === "non_linkedin" ? "non_linkedin" : "linkedin_native";
}

export interface CardRow {
  card_id: string;
  run_id: string | null;
  kind: string;
  audience: Role;
  status: "open" | "resolved" | "expired";
  payload: Record<string, unknown>;
  slack_channel: string | null;
  slack_ts: string | null;
  resolved_by: string | null;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
  expires_at: string | null;
}

export interface LedgerRow {
  run_id: string | null;
  client_tag: string | null;
  step: string;
  vendor: string;
  action: string;
  rows_submitted: number;
  credits: number | null;
  cents: number;
  worst_case_cents: number | null;
  balance_before: number | null;
  balance_after: number | null;
  vendor_job_id: string | null;
  approved_by: string | null;
}

export interface StallEvent {
  run_id: string;
  vendor_run_id: string | null;
  event: "stalled" | "resumed" | "split_asked" | "split" | "residue" | "zero_result_resume" | "abort";
  percent?: number | null;
  verified?: number | null;
  rows?: number | null;
  detail?: Record<string, unknown>;
}

/** Typed access to topup.* — counts and ids only, never lead payloads. */
export class Repo {
  constructor(private readonly db: Db) {}

  // ----- runs -------------------------------------------------------------

  async openRun(input: {
    recipe_id: string;
    client_tag: string;
    lane: string;
    campaign_id: number | null;
    trigger: RunRow["trigger"];
    opened_by: string | null;
  }): Promise<{ ok: true; run: RunRow } | { ok: false; reason: "already_open" | "self_start" }> {
    if (isSelfStart(input.opened_by, input.trigger)) {
      return { ok: false, reason: "self_start" };
    }
    try {
      const { rows } = await this.db.query<RunRow>(
        `insert into topup.runs (recipe_id, client_tag, lane, campaign_id, trigger, opened_by)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [input.recipe_id, input.client_tag, input.lane, input.campaign_id, input.trigger, input.opened_by],
      );
      return { ok: true, run: rows[0] };
    } catch (err) {
      // 23505 = unique_violation from runs_one_open_per_lane / runs_one_open_per_campaign.
      if ((err as { code?: string }).code === "23505") return { ok: false, reason: "already_open" };
      throw err;
    }
  }

  async openRunFor(clientTag: string, lane: string): Promise<RunRow | null> {
    const { rows } = await this.db.query<RunRow>(
      `select * from topup.runs where client_tag = $1 and lane = $2 and topup.run_is_open(status) limit 1`,
      [clientTag, lane],
    );
    return rows[0] ?? null;
  }

  async getRun(runId: string): Promise<RunRow | null> {
    const { rows } = await this.db.query<RunRow>(`select * from topup.runs where run_id = $1`, [runId]);
    return rows[0] ?? null;
  }

  async listRuns(limit = 20, clientTag?: string): Promise<RunRow[]> {
    const { rows } = await this.db.query<RunRow>(
      `select * from topup.runs where ($2::text is null or client_tag = $2)
       order by opened_at desc limit $1`,
      [limit, clientTag ?? null],
    );
    return rows;
  }

  /** Fingerprint stored on the last size step that passed its pilot. Null when this lane has not passed one. */
  async lastGoodSizeFingerprint(clientTag: string, lane: string): Promise<string | null> {
    const { rows } = await this.db.query<{ fp: string | null }>(
      `select s.counts->>'recipe_fingerprint' as fp
         from topup.runs r
         join topup.run_steps s on s.run_id = r.run_id and s.step = 'size' and s.status = 'done'
        where r.client_tag = $1 and r.lane = $2
          and s.counts->>'pilot_gate' = 'ok'
          and coalesce(s.counts->>'recipe_fingerprint', '') <> ''
        order by r.opened_at desc
        limit 1`,
      [clientTag, lane],
    );
    return rows[0]?.fp ?? null;
  }

  async lastRunForLane(clientTag: string, lane: string): Promise<RunRow | null> {
    const { rows } = await this.db.query<RunRow>(
      `select * from topup.runs where client_tag = $1 and lane = $2 order by opened_at desc limit 1`,
      [clientTag, lane],
    );
    return rows[0] ?? null;
  }

  /**
   * An abort tap can resolve the card and then fail before the run closes
   * (Peterson has no lp ingest table). Finish those closes. A run with any
   * card still open is left alone.
   */
  async closeRunsResolvedAbort(): Promise<Array<{ run_id: string; client_tag: string; lane: string }>> {
    const { rows } = await this.db.query<{ run_id: string; client_tag: string; lane: string }>(
      `update topup.runs r
          set status = 'aborted',
              last_error = 'aborted: the card was already resolved abort; closing the run did not finish',
              closed_at = now()
        where topup.run_is_open(r.status)
          and not exists (select 1 from topup.cards c where c.run_id = r.run_id and c.status = 'open')
          and exists (
            select 1 from topup.cards c
             where c.run_id = r.run_id and c.status = 'resolved' and c.resolution = 'abort'
          )
        returning run_id::text, client_tag, lane`,
    );
    return rows;
  }

  /**
   * After an abort the watch used to see the lane still under the floor and
   * reopen it. Close those empty restarts: an open watch run with no card and
   * no work past the trigger step, whose previous run on the lane was aborted.
   */
  async closeWatchRestartsAfterAbort(): Promise<Array<{ run_id: string; client_tag: string; lane: string }>> {
    const { rows } = await this.db.query<{ run_id: string; client_tag: string; lane: string }>(
      `update topup.runs r
          set status = 'aborted',
              last_error = 'aborted: the watch reopened this lane right after an abort; closing the empty restart',
              closed_at = now()
        where topup.run_is_open(r.status)
          and r.opened_by = 'watch'
          and not exists (select 1 from topup.cards c where c.run_id = r.run_id)
          and not exists (select 1 from topup.run_steps s where s.run_id = r.run_id and s.step <> 'trigger')
          and (
            select p.status
              from topup.runs p
             where p.client_tag = r.client_tag and p.lane = r.lane and p.run_id <> r.run_id
               and p.opened_at < r.opened_at
             order by p.opened_at desc
             limit 1
          ) = 'aborted'
        returning run_id::text, client_tag, lane`,
    );
    return rows;
  }

  async openRuns(): Promise<RunRow[]> {
    const { rows } = await this.db.query<RunRow>(
      `select * from topup.runs where topup.run_is_open(status) order by opened_at`,
    );
    return rows;
  }

  async setRunStatus(runId: string, status: RunStatus, step?: Step, lastError?: string): Promise<void> {
    // A terminal row stays terminal. An in-flight stage cannot write "ingesting"
    // back over an abort that already landed.
    await this.db.query(
      `update topup.runs set status = $2,
         current_step = coalesce($3, current_step),
         last_error = coalesce($4, last_error),
         closed_at = case when topup.run_is_open($2) then null else now() end
       where run_id = $1 and topup.run_is_open(status)`,
      [runId, status, step ?? null, lastError ?? null],
    );
  }

  /**
   * Teach an already-migrated database that sized is terminal, and create the
   * loads_paused flag. Failure is logged by the caller; the size-only close
   * falls back to done plus counts.sized so the lane lock still releases.
   */
  async ensureCore08(): Promise<void> {
    await this.db.query(
      `create or replace function topup.run_is_open(s text) returns boolean
       language sql immutable as $$
         select s not in ('done','failed','capacity_bound','not_working','pool_thin','declined','aborted','sized')
       $$`,
    );
    await this.db.query(
      `create table if not exists topup.service_flags (
         flag text primary key,
         enabled boolean not null,
         updated_at timestamptz not null default now(),
         updated_by text
       )`,
    );
    await this.db.query(
      `insert into topup.service_flags (flag, enabled) values ('loads_paused', false) on conflict (flag) do nothing`,
    );
  }

  /**
   * campaign_registry is owned by the migration role, so ALTER can fail.
   * client_icp is the copy this service can create. The code default still
   * applies when neither store is writable.
   */
  async ensureIcpKind(): Promise<void> {
    const nonLinkedin = ["peterson", "peterson_earthworks", "emcor", "vector_energy", "deep_roots"];
    try {
      await this.db.query(`alter table topup.campaign_registry add column if not exists icp_kind text`);
      await this.db.query(
        `update topup.campaign_registry set icp_kind = 'non_linkedin'
          where icp_kind is null and client_tag = any($1::text[])`,
        [nonLinkedin],
      );
      await this.db.query(`update topup.campaign_registry set icp_kind = 'linkedin_native' where icp_kind is null`);
    } catch (err) {
      log.error(`campaign_registry.icp_kind was not added: ${(err as Error).message}`);
    }
    try {
      await this.db.query(
        `create table if not exists topup.client_icp (
           client_tag text primary key,
           icp_kind text not null check (icp_kind in ('linkedin_native', 'non_linkedin'))
         )`,
      );
      await this.db.query(
        `insert into topup.client_icp (client_tag, icp_kind)
         select distinct client_tag, case when client_tag = any($1::text[]) then 'non_linkedin' else 'linkedin_native' end
           from topup.campaign_registry
         on conflict (client_tag) do nothing`,
        [nonLinkedin],
      );
    } catch (err) {
      log.error(`client_icp was not created: ${(err as Error).message}`);
    }
  }

  /** True only when the live function treats sized as closed. */
  async sizedIsTerminal(): Promise<boolean> {
    const { rows } = await this.db.query<{ open: boolean }>(`select topup.run_is_open('sized') as open`);
    return rows[0]?.open === false;
  }

  /** Global operator switch. Service flag when the table exists, otherwise the latest lane event. */
  async loadsPaused(): Promise<boolean> {
    try {
      const { rows } = await this.db.query<{ enabled: boolean }>(
        `select enabled from topup.service_flags where flag = 'loads_paused'`,
      );
      return rows[0]?.enabled === true;
    } catch (err) {
      if ((err as { code?: string }).code !== "42P01") throw err;
    }
    const { rows } = await this.db.query<{ on: boolean }>(
      `select coalesce((detail->>'on')::boolean, false) as on
         from topup.lane_events
        where client_tag = '_service' and lane = 'global' and event = 'loads_paused'
        order by at desc limit 1`,
    );
    return rows[0]?.on === true;
  }

  async setLoadsPaused(enabled: boolean, by: string): Promise<boolean> {
    try {
      await this.db.query(
        `insert into topup.service_flags (flag, enabled, updated_at, updated_by)
         values ('loads_paused', $1, now(), $2)
         on conflict (flag) do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by`,
        [enabled, by],
      );
      return enabled;
    } catch (err) {
      if ((err as { code?: string }).code !== "42P01") throw err;
    }
    await this.db.query(
      `insert into topup.lane_events (client_tag, lane, event, line, actor, detail)
       values ('_service', 'global', 'loads_paused', $1, $2, $3::jsonb)`,
      [
        enabled ? "Loads paused. Runs park before ingest." : "Loads resumed.",
        by,
        JSON.stringify({ on: enabled }),
      ],
    );
    return enabled;
  }

  /** Abort cancels a step that is still marked running so it cannot be retried. */
  async cancelRunningSteps(runId: string, reason = "aborted"): Promise<number> {
    const { rowCount } = await this.db.query(
      `update topup.run_steps set status = 'cancelled', finished_at = now(), last_error = $2
       where run_id = $1 and status = 'running'`,
      [runId, reason.slice(0, 500)],
    );
    return rowCount ?? 0;
  }

  async setRunThread(runId: string, channel: string, ts: string): Promise<void> {
    await this.db.query(`update topup.runs set slack_channel = $2, slack_thread_ts = $3 where run_id = $1`, [
      runId,
      channel,
      ts,
    ]);
  }

  async mergeRunCounts(runId: string, counts: Record<string, number>): Promise<void> {
    await this.db.query(
      `update topup.runs set counts_by_status = counts_by_status || $2::jsonb where run_id = $1`,
      [runId, JSON.stringify(counts)],
    );
  }

  async addRunSpend(runId: string, vendor: string, cents: number): Promise<void> {
    await this.db.query(
      `update topup.runs set spend_cents_by_vendor = jsonb_set(
          spend_cents_by_vendor, array[$2::text],
          to_jsonb(coalesce((spend_cents_by_vendor->>$2)::int, 0) + $3::int), true)
       where run_id = $1`,
      [runId, vendor, cents],
    );
  }

  // ----- steps ------------------------------------------------------------

  async getStep(runId: string, step: Step): Promise<RunStepRow | null> {
    const { rows } = await this.db.query<RunStepRow>(
      `select * from topup.run_steps where run_id = $1 and step = $2`,
      [runId, step],
    );
    return rows[0] ?? null;
  }

  /**
   * Marks a step running and bumps attempts. Returns false when the step is
   * exhausted. Re-entering a step that was only waiting on a card (after a
   * restart, say) is not a failed attempt and does not count.
   */
  async beginStep(runId: string, step: Step): Promise<{ ok: boolean; attempts: number }> {
    const { rows } = await this.db.query<{ attempts: number }>(
      `insert into topup.run_steps (run_id, step, status, attempts, started_at)
       values ($1, $2, 'running', 1, now())
       on conflict (run_id, step) do update set
         status = 'running',
         attempts = topup.run_steps.attempts + case when topup.run_steps.status = 'waiting_approval' then 0 else 1 end,
         started_at = now()
       returning attempts`,
      [runId, step],
    );
    const attempts = rows[0].attempts;
    return { ok: attempts <= MAX_STEP_ATTEMPTS, attempts };
  }

  /** A human tapped Resume on a parked run: the step gets its attempts back, once. */
  async resetStep(runId: string, step: Step): Promise<void> {
    await this.db.query(
      `update topup.run_steps set attempts = 0, status = 'pending', last_error = null, useful_output = null,
         counts = coalesce(counts, '{}'::jsonb) - 'rules_hash'
       where run_id = $1 and step = $2`,
      [runId, step],
    );
  }

  async finishStep(
    runId: string,
    step: Step,
    patch: Partial<Omit<Pick<RunStepRow, "vendor_job_id" | "actual_cents" | "useful_output" | "worst_case_cents" | "approved_cents">, never>> & {
      counts?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.db.query(
      `update topup.run_steps set status = 'done', finished_at = now(), last_error = null,
         vendor_job_id = coalesce($3, vendor_job_id),
         actual_cents = coalesce($4, actual_cents),
         useful_output = coalesce($5, useful_output),
         counts = counts || coalesce($6::jsonb, '{}'::jsonb),
         worst_case_cents = coalesce($7, worst_case_cents),
         approved_cents = coalesce($8, approved_cents)
       where run_id = $1 and step = $2`,
      [
        runId,
        step,
        patch.vendor_job_id ?? null,
        patch.actual_cents ?? null,
        patch.useful_output ?? null,
        patch.counts ? JSON.stringify(patch.counts) : null,
        patch.worst_case_cents ?? null,
        patch.approved_cents ?? null,
      ],
    );
  }

  /** Add to a step's counts while it is still running (a marker such as "summary posted", or partial progress). */
  async mergeStepExtra(runId: string, step: Step, extra: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `insert into topup.run_steps (run_id, step, status, counts) values ($1, $2, 'running', $3::jsonb)
       on conflict (run_id, step) do update set counts = topup.run_steps.counts || $3::jsonb`,
      [runId, step, JSON.stringify(extra)],
    );
  }

  async mergeStepCounts(runId: string, step: Step, counts: Record<string, number>): Promise<void> {
    await this.db.query(
      `insert into topup.run_steps (run_id, step, status, counts) values ($1, $2, 'running', $3::jsonb)
       on conflict (run_id, step) do update set counts = topup.run_steps.counts || $3::jsonb`,
      [runId, step, JSON.stringify(counts)],
    );
  }

  async failStep(runId: string, step: Step, error: string, parked: boolean): Promise<void> {
    await this.db.query(
      `update topup.run_steps set status = $4, finished_at = now(), last_error = $3
       where run_id = $1 and step = $2`,
      [runId, step, error.slice(0, 2000), parked ? "parked" : "failed"],
    );
  }

  async setStepWaiting(runId: string, step: Step, worstCaseCents: number): Promise<void> {
    await this.db.query(
      `insert into topup.run_steps (run_id, step, status, worst_case_cents)
       values ($1,$2,'waiting_approval',$3)
       on conflict (run_id, step) do update set status = 'waiting_approval', worst_case_cents = $3`,
      [runId, step, worstCaseCents],
    );
  }

  async setStepRunning(runId: string, step: Step): Promise<void> {
    await this.db.query(`update topup.run_steps set status = 'running' where run_id = $1 and step = $2 and status = 'waiting_approval'`, [runId, step]);
  }

  async setStepVendorJob(runId: string, step: Step, vendorJobId: string): Promise<void> {
    await this.db.query(`update topup.run_steps set vendor_job_id = $3 where run_id = $1 and step = $2`, [
      runId,
      step,
      vendorJobId,
    ]);
  }

  /**
   * Record an approval on the step. Idempotent per step/amount (D65): a
   * second tap of the same cents does not add. The larger of the stored
   * amount and this one wins. Approver is the named person on the verb.
   */
  async approveStep(runId: string, step: Step, approvedCents: number, approvedBy?: string | null): Promise<void> {
    await this.db.query(
      `update topup.run_steps
          set approved_cents = greatest(coalesce(approved_cents, 0), $3),
              counts = counts || jsonb_build_object('approved_by', coalesce($4::text, counts->>'approved_by'))
        where run_id = $1 and step = $2`,
      [runId, step, approvedCents, approvedBy ?? null],
    );
  }

  // ----- spend ------------------------------------------------------------

  async ledger(row: LedgerRow): Promise<void> {
    await this.db.query(
      `insert into topup.spend_ledger
        (run_id, client_tag, step, vendor, action, rows_submitted, credits, cents, worst_case_cents,
         balance_before, balance_after, vendor_job_id, approved_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        row.run_id,
        row.client_tag,
        row.step,
        row.vendor,
        row.action,
        row.rows_submitted,
        row.credits,
        row.cents,
        row.worst_case_cents,
        row.balance_before,
        row.balance_after,
        row.vendor_job_id,
        row.approved_by,
      ],
    );
    if (row.run_id && row.cents > 0) await this.addRunSpend(row.run_id, row.vendor, row.cents);
  }

  /** Cents spent across all vendors since 00:00 UTC today. */
  async spentTodayCents(): Promise<number> {
    const { rows } = await this.db.query<{ cents: string }>(
      `select coalesce(sum(cents),0)::text as cents from topup.spend_ledger
       where created_at >= date_trunc('day', now() at time zone 'utc')`,
    );
    return Number(rows[0].cents);
  }

  async spendByVendor(sinceDays = 30): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ vendor: string; cents: string }>(
      `select vendor, sum(cents)::text as cents from topup.spend_ledger
       where created_at >= now() - ($1 || ' days')::interval group by vendor`,
      [String(sinceDays)],
    );
    return Object.fromEntries(rows.map((r) => [r.vendor, Number(r.cents)]));
  }

  async spendMonthToDate(): Promise<Array<{ client_tag: string | null; vendor: string; cents: number }>> {
    const { rows } = await this.db.query<{ client_tag: string | null; vendor: string; cents: string }>(
      `select client_tag, vendor, sum(cents)::text as cents from topup.spend_ledger
       where created_at >= date_trunc('month', now()) group by client_tag, vendor order by 1,2`,
    );
    return rows.map((r) => ({ ...r, cents: Number(r.cents) }));
  }

  // ----- cards ------------------------------------------------------------

  async openCard(input: {
    run_id: string | null;
    kind: string;
    audience: Role;
    payload: Record<string, unknown>;
    expires_at?: Date | null;
  }): Promise<CardRow> {
    const { rows } = await this.db.query<CardRow>(
      `insert into topup.cards (run_id, kind, audience, payload, expires_at)
       values ($1,$2,$3,$4,$5) returning *`,
      [input.run_id, input.kind, input.audience, JSON.stringify(input.payload), input.expires_at ?? null],
    );
    return rows[0];
  }

  async setCardMessage(cardId: string, channel: string, ts: string): Promise<void> {
    await this.db.query(`update topup.cards set slack_channel = $2, slack_ts = $3 where card_id = $1`, [
      cardId,
      channel,
      ts,
    ]);
  }

  /** Keep the rendered blocks so a resolution can redraw the card without its buttons. */
  async setCardBlocks(cardId: string, blocks: unknown[]): Promise<void> {
    await this.db.query(`update topup.cards set payload = payload || jsonb_build_object('blocks', $2::jsonb) where card_id = $1`, [
      cardId,
      JSON.stringify(blocks),
    ]);
  }

  /** Re-quote an open card: merge the new estimate into payload (D64). */
  async updateCardPayload(cardId: string, payload: Record<string, unknown>): Promise<void> {
    await this.db.query(`update topup.cards set payload = payload || $2::jsonb where card_id = $1 and status = 'open'`, [
      cardId,
      JSON.stringify(payload),
    ]);
  }

  async getCard(cardId: string): Promise<CardRow | null> {
    const { rows } = await this.db.query<CardRow>(`select * from topup.cards where card_id = $1`, [cardId]);
    return rows[0] ?? null;
  }

  /** Resolve an open card exactly once; returns null if it was already resolved. */
  async resolveCard(cardId: string, by: string, resolution: string): Promise<CardRow | null> {
    const { rows } = await this.db.query<CardRow>(
      `update topup.cards set status = 'resolved', resolved_by = $2, resolution = $3, resolved_at = now()
       where card_id = $1 and status = 'open' returning *`,
      [cardId, by, resolution],
    );
    return rows[0] ?? null;
  }

  async openCardsForRun(runId: string): Promise<CardRow[]> {
    const { rows } = await this.db.query<CardRow>(`select * from topup.cards where run_id = $1 and status = 'open' order by created_at`, [runId]);
    return rows;
  }

  async openCards(kind?: string, clientTag?: string): Promise<CardRow[]> {
    const { rows } = await this.db.query<CardRow>(
      `select c.* from topup.cards c left join topup.runs r on r.run_id = c.run_id
       where c.status = 'open' and ($1::text is null or c.kind = $1)
         and ($2::text is null or r.client_tag = $2)
       order by c.created_at`,
      [kind ?? null, clientTag ?? null],
    );
    return rows;
  }

  async expireCards(now = new Date()): Promise<CardRow[]> {
    const { rows } = await this.db.query<CardRow>(
      `update topup.cards set status = 'expired', resolved_at = now()
       where status = 'open' and expires_at is not null and expires_at < $1 returning *`,
      [now],
    );
    return rows;
  }

  // ----- stall events -----------------------------------------------------

  async stallEvent(e: StallEvent): Promise<void> {
    await this.db.query(
      `insert into topup.stall_events (run_id, vendor_run_id, event, percent, verified, rows, detail)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [e.run_id, e.vendor_run_id, e.event, e.percent ?? null, e.verified ?? null, e.rows ?? null, JSON.stringify(e.detail ?? {})],
    );
  }

  async stallEventCounts(sinceDays = 7): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ event: string; n: string }>(
      `select event, count(*)::text as n from topup.stall_events
       where created_at >= now() - ($1 || ' days')::interval group by event`,
      [String(sinceDays)],
    );
    return Object.fromEntries(rows.map((r) => [r.event, Number(r.n)]));
  }

  // ----- lead status counts -----------------------------------------------

  /** Counts by lead_status across every lp.*_ingested_leads table. */
  async leadStatusCounts(): Promise<Record<string, Record<string, number>>> {
    const { rows: tables } = await this.db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'lp' and table_name like '%\\_ingested\\_leads' escape '\\'
         and exists (select 1 from information_schema.columns c
                     where c.table_schema = 'lp' and c.table_name = tables.table_name and c.column_name = 'lead_status')
       order by 1`,
    );
    const out: Record<string, Record<string, number>> = {};
    for (const t of tables) {
      const tag = t.table_name.replace(/_ingested_leads$/, "");
      const { rows } = await this.db.query<{ lead_status: string; n: string }>(
        `select lead_status, count(*)::text as n from lp."${t.table_name}" group by lead_status`,
      );
      out[tag] = Object.fromEntries(rows.map((r) => [r.lead_status, Number(r.n)]));
    }
    return out;
  }

  async installLeadLocks(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(`select topup.install_lead_locks() as n`);
    return rows[0]?.n ?? 0;
  }

  // ----- recipes / registry ----------------------------------------------

  async upsertRecipe(input: {
    recipe_id: string;
    client_tag: string;
    lane: string;
    version: number;
    body: unknown;
    owner_approved_at: string | null;
  }): Promise<void> {
    await this.db.query(
      `insert into topup.lane_recipes (recipe_id, client_tag, lane, version, body, owner_approved_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (recipe_id) do update set body = excluded.body, owner_approved_at = excluded.owner_approved_at, loaded_at = now()`,
      [input.recipe_id, input.client_tag, input.lane, input.version, JSON.stringify(input.body), input.owner_approved_at],
    );
  }

  async getRecipe(recipeId: string): Promise<{ recipe_id: string; body: unknown; owner_approved_at: string | null } | null> {
    const { rows } = await this.db.query<{ recipe_id: string; body: unknown; owner_approved_at: string | null }>(
      `select recipe_id, body, owner_approved_at from topup.lane_recipes where recipe_id = $1`,
      [recipeId],
    );
    return rows[0] ?? null;
  }

  async findRecipe(clientTag: string, lane: string): Promise<{ recipe_id: string; body: unknown } | null> {
    const { rows } = await this.db.query<{ recipe_id: string; body: unknown }>(
      `select recipe_id, body from topup.lane_recipes where client_tag = $1 and lane = $2
       order by version desc limit 1`,
      [clientTag, lane],
    );
    return rows[0] ?? null;
  }

  /**
   * Pull receipts for a client (optional lane / campaign). Tags, filters,
   * notes, ids. Never emails.
   */
  async listPullReceipts(input: {
    clientTag: string;
    lane?: string | null;
    campaignId?: number | null;
  }): Promise<
    Array<{
      written_by: string;
      written_at: string;
      client_tag: string;
      smartlead_client_id: number | null;
      lane: string;
      campaign_ids: number[];
      icp_kind: string;
      persona: string;
      company_source: string;
      company_filters: Record<string, unknown>;
      domain_source: string | null;
      person_source: string | null;
      email_source: string;
      email_max_tier: string | null;
      how_i_did_it: string;
      notes: string | null;
      segment: Record<string, unknown> | null;
      granularity: string;
      rows_imported: number | null;
      rows_found: number | null;
      tam_count: number | null;
      build_label: string | null;
    }>
  > {
    const { rows } = await this.db.query<{
      written_by: string;
      written_at: string;
      client_tag: string;
      smartlead_client_id: string | null;
      lane: string;
      campaign_ids: Array<string | number> | null;
      icp_kind: string;
      persona: string;
      company_source: string;
      company_filters: Record<string, unknown> | null;
      domain_source: string | null;
      person_source: string | null;
      email_source: string;
      email_max_tier: string | null;
      how_i_did_it: string;
      notes: string | null;
      segment: Record<string, unknown> | null;
      granularity: string;
      rows_imported: string | null;
      rows_found: string | null;
      tam_count: string | null;
      build_label: string | null;
    }>(
      `select written_by, written_at::text, client_tag, smartlead_client_id::text, lane, campaign_ids,
              icp_kind, persona, company_source, company_filters, domain_source, person_source,
              email_source, email_max_tier, how_i_did_it, notes, segment, granularity,
              rows_imported::text, rows_found::text, tam_count::text, build_label
         from topup.pull_receipts
        where client_tag = $1
          and ($2::text is null or lane = $2)
          and ($3::bigint is null or $3 = any(campaign_ids))
        order by written_at desc`,
      [input.clientTag, input.lane ?? null, input.campaignId ?? null],
    );
    return rows.map((r) => ({
      written_by: r.written_by,
      written_at: r.written_at,
      client_tag: r.client_tag,
      smartlead_client_id: r.smartlead_client_id == null ? null : Number(r.smartlead_client_id),
      lane: r.lane,
      campaign_ids: (r.campaign_ids ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0),
      icp_kind: r.icp_kind,
      persona: r.persona,
      company_source: r.company_source,
      company_filters: r.company_filters ?? {},
      domain_source: r.domain_source,
      person_source: r.person_source,
      email_source: r.email_source,
      email_max_tier: r.email_max_tier,
      how_i_did_it: r.how_i_did_it,
      notes: r.notes,
      segment: r.segment,
      granularity: r.granularity,
      rows_imported: r.rows_imported == null ? null : Number(r.rows_imported),
      rows_found: r.rows_found == null ? null : Number(r.rows_found),
      tam_count: r.tam_count == null ? null : Number(r.tam_count),
      build_label: r.build_label,
    }));
  }

  async listReceiptLanes(clientTag?: string): Promise<Array<{ client_tag: string; lane: string }>> {
    const { rows } = await this.db.query<{ client_tag: string; lane: string }>(
      `select distinct client_tag, lane from topup.pull_receipts
        where ($1::text is null or client_tag = $1)
        order by 1, 2`,
      [clientTag ?? null],
    );
    return rows;
  }

  async laneForCampaign(clientTag: string, campaignId: number): Promise<string | null> {
    try {
      const registry = await this.db.query<{ lane: string | null }>(
        `select lane from topup.campaign_registry
          where client_tag = $1 and campaign_id = $2 and lane is not null
          limit 1`,
        [clientTag, campaignId],
      );
      if (registry.rows[0]?.lane) return registry.rows[0].lane;
    } catch {
      /* an older database has no campaign_registry; receipts still name a lane */
    }
    const { rows } = await this.db.query<{ lane: string }>(
      `select lane from topup.pull_receipts
        where client_tag = $1 and $2 = any(campaign_ids)
        order by (granularity = 'lane') desc, written_at desc
        limit 1`,
      [clientTag, campaignId],
    );
    if (rows[0]?.lane) return rows[0].lane;
    try {
      const method = await this.db.query<{ lane: string | null }>(
        `select lane from topup.campaign_method where smartlead_campaign_id = $1 limit 1`,
        [campaignId],
      );
      return method.rows[0]?.lane ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Builds that fed these campaigns, from topup.campaign_builds.
   * An empty view falls through to pull receipts for the same campaigns.
   */
  async campaignBuilds(clientTag: string, campaignIds: number[]): Promise<Record<string, unknown>[]> {
    if (campaignIds.length === 0) return [];
    try {
      const { rows } = await this.db.query(
        `select * from topup.campaign_builds where client_tag = $1 and smartlead_campaign_id = any($2::bigint[])`,
        [clientTag, campaignIds],
      );
      if (rows.length) return rows;
    } catch {
      /* the view is not on every database; the receipt rows below are the same facts */
    }
    const { rows } = await this.db.query(
        `select r.build_label, r.company_source, r.company_filters, r.written_at, r.rows_found, c.campaign_id
         from topup.pull_receipts r
         cross join lateral unnest(r.campaign_ids) as c(campaign_id)
        where r.client_tag = $1 and c.campaign_id = any($2::bigint[])`,
      [clientTag, campaignIds],
    );
    return rows;
  }

  async campaignRegistry(clientTag?: string): Promise<Record<string, unknown>[]> {
    try {
      const { rows } = await this.db.query(
        `select cr.*, coalesce(k.icp_kind, cr_kind.icp_kind) as icp_kind
           from topup.campaign_registry cr
           left join topup.client_icp k on k.client_tag = cr.client_tag
           left join lateral (
             select nullif(to_jsonb(cr)->>'icp_kind', '') as icp_kind
           ) cr_kind on true
          where ($1::text is null or cr.client_tag = $1)
          order by cr.client_tag, cr.campaign_id`,
        [clientTag ?? null],
      );
      return rows;
    } catch {
      const { rows } = await this.db.query(
        `select * from topup.campaign_registry where ($1::text is null or client_tag = $1) order by client_tag, campaign_id`,
        [clientTag ?? null],
      );
      return rows;
    }
  }

  /** Registry column, else client_icp, else the client default. */
  async clientIcpKind(clientTag: string): Promise<IcpKind> {
    try {
      const { rows } = await this.db.query<{ icp_kind: string | null }>(
        `select coalesce(
            (select icp_kind from topup.client_icp where client_tag = $1),
            nullif(to_jsonb(cr)->>'icp_kind', '')
          ) as icp_kind
           from topup.campaign_registry cr
          where cr.client_tag = $1
          limit 1`,
        [clientTag],
      );
      return icpKindOf(rows[0]?.icp_kind ?? null);
    } catch {
      return icpKindOf(null);
    }
  }

  async setWorkingOverride(campaignId: number, value: boolean | null): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `update topup.campaign_registry set working_override = $2, updated_at = now() where campaign_id = $1`,
      [campaignId, value],
    );
    return (rowCount ?? 0) > 0;
  }

  async workingOverrides(campaignIds: readonly number[]): Promise<Map<number, boolean | null>> {
    const out = new Map<number, boolean | null>();
    if (campaignIds.length === 0) return out;
    const { rows } = await this.db.query<{ campaign_id: string; working_override: boolean | null }>(
      `select campaign_id::text, working_override from topup.campaign_registry where campaign_id = any($1::bigint[])`,
      [campaignIds],
    );
    for (const r of rows) out.set(Number(r.campaign_id), r.working_override);
    return out;
  }

  /**
   * Retag registry rows from public.campaigns and topup.client_map, then
   * set the lane from the latest lane receipt for that client. No client
   * is special-cased here (D53).
   */
  async repairCampaignRegistry(): Promise<void> {
    await this.db.query(
      `update topup.campaign_registry cr
          set client_tag = cm.client_tag,
              smartlead_client_id = c.smartlead_client_id,
              updated_at = now()
         from public.campaigns c
         join topup.client_map cm on cm.smartlead_client_id = c.smartlead_client_id
        where cr.campaign_id = c.smartlead_campaign_id
          and (cr.client_tag is distinct from cm.client_tag
               or cr.smartlead_client_id is distinct from c.smartlead_client_id)`,
    );
    await this.db.query(
      `update topup.campaign_registry cr
          set lane = sub.lane,
              updated_at = now()
         from (
           select distinct on (cr2.campaign_id) cr2.campaign_id, r.lane
             from topup.campaign_registry cr2
             join topup.pull_receipts r
               on r.client_tag = cr2.client_tag
              and cr2.campaign_id = any(r.campaign_ids)
              and r.granularity = 'lane'
              and r.lane is not null
            order by cr2.campaign_id, r.written_at desc
         ) sub
        where cr.campaign_id = sub.campaign_id
          and cr.lane is distinct from sub.lane`,
    );
  }

  /** Keep the registry in step with the recipe so `/working` has a row to flip. Never overwrites the override, the client, or the lane. */
  async upsertCampaignRegistry(rows: Array<{
    campaign_id: number;
    campaign_name: string | null;
    client_tag: string;
    smartlead_client_id: number;
    lane: string;
    recipe_id: string;
    status: string | null;
  }>): Promise<void> {
    for (const r of rows) {
      await this.db.query(
        `insert into topup.campaign_registry (campaign_id, campaign_name, client_tag, smartlead_client_id, lane, recipe_id, status, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (campaign_id) do update set
           campaign_name = excluded.campaign_name,
           recipe_id = excluded.recipe_id,
           status = excluded.status,
           updated_at = now()`,
        [r.campaign_id, r.campaign_name, r.client_tag, r.smartlead_client_id, r.lane, r.recipe_id, r.status],
      );
    }
  }

  /** Insert-only. Latest row wins; never update a receipt in place (D32). */
  async insertPullReceipt(row: {
    written_by: string;
    client_tag: string;
    smartlead_client_id: number | null;
    lane: string;
    campaign_ids: number[];
    icp_kind: string;
    persona: string;
    company_source: string;
    company_filters: Record<string, unknown>;
    domain_source: string;
    person_source: string;
    email_source: string;
    email_max_tier: string | null;
    rows_found: number | null;
    rows_imported: number | null;
    tam_count: number | null;
    how_i_did_it: string;
    notes: string | null;
    segment: Record<string, unknown> | null;
    yield_by_step: Record<string, unknown> | null;
    spend_cents: number | null;
    suppression_scope: string | null;
    build_label: string | null;
    granularity: "build" | "lane";
  }): Promise<string> {
    const { rows } = await this.db.query<{ receipt_id: string }>(
      `insert into topup.pull_receipts (
         written_by, client_tag, smartlead_client_id, lane, campaign_ids,
         icp_kind, persona, company_source, company_filters,
         domain_source, person_source, email_source, email_max_tier,
         rows_found, rows_imported, tam_count, how_i_did_it, notes,
         segment, yield_by_step, spend_cents, suppression_scope, build_label, granularity
       ) values (
         $1,$2,$3,$4,$5::bigint[],$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,$23,$24
       ) returning receipt_id::text`,
      [
        row.written_by,
        row.client_tag,
        row.smartlead_client_id,
        row.lane,
        row.campaign_ids,
        row.icp_kind,
        row.persona,
        row.company_source,
        JSON.stringify(row.company_filters),
        row.domain_source,
        row.person_source,
        row.email_source,
        row.email_max_tier,
        row.rows_found,
        row.rows_imported,
        row.tam_count,
        row.how_i_did_it,
        row.notes,
        row.segment ? JSON.stringify(row.segment) : null,
        row.yield_by_step ? JSON.stringify(row.yield_by_step) : null,
        row.spend_cents,
        row.suppression_scope,
        row.build_label,
        row.granularity,
      ],
    );
    return rows[0]!.receipt_id;
  }

  async clientDomainListConfirmedEmpty(clientTag: string): Promise<boolean> {
    const { rows: t } = await this.db.query<{ ok: boolean }>(`select to_regclass('topup.client_domain_list_state') is not null as ok`);
    if (!t[0]?.ok) return false;
    const { rows } = await this.db.query<{ ok: boolean }>(
      `select confirmed_empty_at is not null as ok from topup.client_domain_list_state where client_tag = $1`,
      [clientTag],
    );
    return Boolean(rows[0]?.ok);
  }

  async confirmClientDomainListEmpty(clientTag: string, by: string): Promise<void> {
    await this.db.query(
      `insert into topup.client_domain_list_state (client_tag, confirmed_empty_at, confirmed_empty_by)
       values ($1, now(), $2)
       on conflict (client_tag) do update set confirmed_empty_at = now(), confirmed_empty_by = excluded.confirmed_empty_by`,
      [clientTag, by],
    );
  }

  async missingTopupTables(required: readonly string[]): Promise<string[]> {
    const missing: string[] = [];
    for (const name of required) {
      const { rows } = await this.db.query<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [name]);
      if (!rows[0]?.ok) missing.push(name);
    }
    return missing;
  }

  async missingPieceGroups(clientTag?: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.query(
      `select * from topup.missing_piece_groups where ($1::text is null or client_tag = $1) order by 1,2,3`,
      [clientTag ?? null],
    );
    return rows;
  }

  // Exposed for stages that need a run-scoped transaction.
  withRun<T>(runId: string, fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.withRun(runId, fn);
  }

  raw(): Db {
    return this.db;
  }
}
