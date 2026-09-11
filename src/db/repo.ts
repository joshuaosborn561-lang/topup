import type { Db, Queryable } from "./pool.js";
import type { Role, RunRow, RunStepRow, RunStatus, Step } from "../domain/runs.js";
import { MAX_STEP_ATTEMPTS } from "../domain/runs.js";

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
  }): Promise<{ ok: true; run: RunRow } | { ok: false; reason: "already_open" }> {
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

  async lastRunForLane(clientTag: string, lane: string): Promise<RunRow | null> {
    const { rows } = await this.db.query<RunRow>(
      `select * from topup.runs where client_tag = $1 and lane = $2 order by opened_at desc limit 1`,
      [clientTag, lane],
    );
    return rows[0] ?? null;
  }

  async openRuns(): Promise<RunRow[]> {
    const { rows } = await this.db.query<RunRow>(
      `select * from topup.runs where topup.run_is_open(status) order by opened_at`,
    );
    return rows;
  }

  async setRunStatus(runId: string, status: RunStatus, step?: Step, lastError?: string): Promise<void> {
    await this.db.query(
      `update topup.runs set status = $2,
         current_step = coalesce($3, current_step),
         last_error = coalesce($4, last_error),
         closed_at = case when topup.run_is_open($2) then null else now() end
       where run_id = $1`,
      [runId, status, step ?? null, lastError ?? null],
    );
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
    await this.db.query(`update topup.run_steps set attempts = 0, status = 'pending', last_error = null where run_id = $1 and step = $2`, [runId, step]);
  }

  async finishStep(
    runId: string,
    step: Step,
    patch: Partial<Pick<RunStepRow, "vendor_job_id" | "actual_cents" | "useful_output" | "counts" | "worst_case_cents" | "approved_cents">>,
  ): Promise<void> {
    await this.db.query(
      `update topup.run_steps set status = 'done', finished_at = now(),
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

  async approveStep(runId: string, step: Step, approvedCents: number): Promise<void> {
    await this.db.query(
      `update topup.run_steps set approved_cents = coalesce(approved_cents,0) + $3 where run_id = $1 and step = $2`,
      [runId, step, approvedCents],
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

  async campaignRegistry(clientTag?: string): Promise<Record<string, unknown>[]> {
    const { rows } = await this.db.query(
      `select * from topup.campaign_registry where ($1::text is null or client_tag = $1) order by client_tag, campaign_id`,
      [clientTag ?? null],
    );
    return rows;
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

  /** Keep the registry in step with the recipe so `/working` has a row to flip. Never overwrites the override. */
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
           client_tag = excluded.client_tag,
           smartlead_client_id = excluded.smartlead_client_id,
           lane = excluded.lane,
           recipe_id = excluded.recipe_id,
           status = excluded.status,
           updated_at = now()`,
        [r.campaign_id, r.campaign_name, r.client_tag, r.smartlead_client_id, r.lane, r.recipe_id, r.status],
      );
    }
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
