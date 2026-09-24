import type { Db, Queryable } from "../db/pool.js";
import { ingestedTable } from "../db/pool.js";
import type { CardRow } from "../db/repo.js";
import type { Role, RunRow, Step } from "../domain/runs.js";
import { logger } from "../lib/log.js";
import { parseRecipe } from "../recipes/schema.js";
import { spineStep, stepForStage, stepLabel } from "../spine/steps.js";
import { assessClientRunway, type ClientRunway } from "./client_runway.js";
import { assessCampaign, campaignIdsForClient, campaignSnapshots, type CampaignHealth } from "./health.js";

const log = logger("ledger");

export type BlockedOn = "vendor" | "server" | "client" | "owner" | "operator";

export interface LaneStateRow {
  client_tag: string;
  lane: string;
  /** Spine step 1..13; null between runs. */
  step: number | null;
  step_since: string;
  gate_unmet: string | null;
  run_id: string | null;
  next_intent: string | null;
  blocked_on: BlockedOn | null;
  blocked_detail: string | null;
  blocked_since: string | null;
  digest_fingerprint: string | null;
  digest_sent_at: string | null;
  updated_at: string;
}

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

export interface QueueEntry {
  client_tag: string;
  lane: string;
  queue_name: string;
  source_table: string;
  where_sql: string | null;
  missing: "domain" | "person" | "email" | "none";
  next_method: string | null;
  note: string | null;
  registered_by: string | null;
  registered_at: string;
  last_count: number | null;
  last_counted_at: string | null;
  active: boolean;
}

export interface Blocker {
  on: BlockedOn;
  what: string;
  since: string;
  card_id?: string;
}

/** The whole answer to "where is <client>/<lane>?". Counts and ids only. */
export interface LaneState {
  client_tag: string;
  lane: string;
  /** Spine step (D24), null when idle. `step_label` is "Step N" or "Step N — title" once the skill supplies titles. */
  step: number | null;
  step_label: string;
  step_since: string;
  /** Who owns the current step, from the spine. */
  step_owner: "code" | "josh" | "cayden" | null;
  /** The gate that halted the run at this step, or null while it is moving. */
  gate_unmet: string | null;
  run: { run_id: string; status: string; current_step: string | null; opened_at: string } | null;
  next_intent: string | null;
  blocked: Blocker[];
  queues: {
    ingested_by_status: Record<string, number>;
    registry: Array<Pick<QueueEntry, "queue_name" | "source_table" | "missing" | "next_method" | "last_count" | "last_counted_at" | "note">>;
  };
  spend: { this_run_cents_by_vendor: Record<string, number>; this_month_cents_by_vendor: Record<string, number> };
  campaigns: CampaignHealth[];
  /** Client-wide rem / days (D38). Days are null until unique inboxes × MESSAGE_PER_DAY are named. */
  client_runway: ClientRunway | null;
  /** Set when the campaign mirror could not be read; the rest of the state still answers. */
  campaigns_error: string | null;
  events: Array<Pick<LaneEventRow, "at" | "event" | "line" | "next_intent" | "actor">>;
  registered: boolean;
}

const IDENT = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/** pg hands timestamptz back as Date; the state is JSON, so everything is ISO text. */
function iso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return typeof v === "string" ? v : String(v);
}
function isoOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : iso(v);
}
const COUNT_TIMEOUT_MS = 15_000;
const EVENTS_SHOWN = 12;

/**
 * The lane ledger (addendum section 2). Everything the service knows about a
 * lane is written here as it happens, so a chat that ends is not a state that
 * ends. Reads compose the state from this schema, the ingested table's
 * lead_status counts, open cards, the spend ledger and the campaign mirror.
 */
export class LaneLedger {
  constructor(private readonly db: Db) {}

  // ----- writes -----------------------------------------------------------

  async event(e: {
    client_tag: string;
    lane: string;
    run_id?: string | null;
    event: string;
    line: string;
    next_intent?: string | null;
    actor?: string | null;
    detail?: Record<string, unknown>;
    /** The spine step the event happened on; defaults to the lane's current step. */
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

  /**
   * Move a lane to a spine step (null = idle, run over). `step_since` only
   * moves when the step actually changes; arriving at a step clears any gate
   * recorded as unmet there.
   */
  async setStep(clientTag: string, lane: string, step: number | null, opts: { run_id?: string | null; next_intent?: string | null; actor?: string | null; line?: string } = {}): Promise<void> {
    if (step !== null) spineStep(step);
    const { rows } = await this.db.query<{ changed: boolean }>(
      `insert into topup.lane_state (client_tag, lane, step, step_since, run_id, next_intent)
       values ($1,$2,$3::smallint,now(),$4,$5)
       on conflict (client_tag, lane) do update set
         step_since = case when topup.lane_state.step is not distinct from excluded.step then topup.lane_state.step_since else now() end,
         step = excluded.step,
         gate_unmet = case when topup.lane_state.step is not distinct from excluded.step then topup.lane_state.gate_unmet else null end,
         run_id = case when excluded.step is null then null else coalesce(excluded.run_id, topup.lane_state.run_id) end,
         next_intent = coalesce(excluded.next_intent, topup.lane_state.next_intent),
         updated_at = now()
       returning (xmax = 0 or step_since = now()) as changed`,
      [clientTag, lane, step, opts.run_id ?? null, opts.next_intent ?? null],
    );
    if (rows[0]?.changed) {
      await this.event({ client_tag: clientTag, lane, run_id: opts.run_id, step, event: "step", line: opts.line ?? `Now at ${stepLabel(step)}.`, next_intent: opts.next_intent, actor: opts.actor ?? "service" });
    }
  }

  /** Move a lane to the spine step that owns an internal pipeline stage. Unplaced stages leave the step as it is. */
  async setStepForStage(clientTag: string, lane: string, stage: Step, opts: { run_id?: string | null; next_intent?: string | null; actor?: string | null; line?: string } = {}): Promise<void> {
    const s = stepForStage(stage);
    if (!s) {
      await this.event({ client_tag: clientTag, lane, run_id: opts.run_id, event: "step", line: `Running ${stage}, which the spine does not place on a step yet.`, next_intent: opts.next_intent, actor: opts.actor ?? "service" });
      return;
    }
    await this.setStep(clientTag, lane, s.n, opts);
  }

  /**
   * A gate failed at the lane's current step: the run halted, this is why, and
   * this is who has to act. Recorded once per (step, gate text); the card or
   * thread line is posted by the caller, also once.
   */
  async gateUnmet(clientTag: string, lane: string, step: number, why: string, opts: { run_id?: string | null; waiting_on?: BlockedOn | null; next_intent?: string | null } = {}): Promise<boolean> {
    const s = spineStep(step);
    const text = `${s.gate ?? `step ${step} gate`}: ${why}`.slice(0, 500);
    const { rowCount } = await this.db.query(
      `update topup.lane_state set gate_unmet = $3, updated_at = now()
       where client_tag = $1 and lane = $2 and gate_unmet is distinct from $3`,
      [clientTag, lane, text],
    );
    if (!rowCount) return false;
    await this.event({
      client_tag: clientTag,
      lane,
      run_id: opts.run_id,
      step,
      event: "gate_unmet",
      line: `${stepLabel(step)} halted — ${text}`,
      next_intent: opts.next_intent ?? (opts.waiting_on ? `Waiting on ${audienceName(opts.waiting_on)}.` : null),
      actor: "service",
      detail: { gate: s.gate, waiting_on: opts.waiting_on ?? null },
    });
    return true;
  }

  /** Something outside a card is in the way: a vendor balance, a server down, a client list not arrived. */
  async block(clientTag: string, lane: string, on: BlockedOn, detail: string, runId?: string | null): Promise<void> {
    await this.db.query(
      `insert into topup.lane_state (client_tag, lane, blocked_on, blocked_detail, blocked_since)
       values ($1,$2,$3,$4,now())
       on conflict (client_tag, lane) do update set
         blocked_on = excluded.blocked_on, blocked_detail = excluded.blocked_detail,
         blocked_since = case when topup.lane_state.blocked_on is null then now() else topup.lane_state.blocked_since end,
         updated_at = now()`,
      [clientTag, lane, on, detail.slice(0, 500)],
    );
    await this.event({ client_tag: clientTag, lane, run_id: runId, event: "blocked", line: `Blocked on ${on}: ${detail}`, actor: "service" });
  }

  async unblock(clientTag: string, lane: string, line: string, runId?: string | null): Promise<void> {
    const { rowCount } = await this.db.query(
      `update topup.lane_state set blocked_on = null, blocked_detail = null, blocked_since = null, updated_at = now()
       where client_tag = $1 and lane = $2 and blocked_on is not null`,
      [clientTag, lane],
    );
    if (rowCount) await this.event({ client_tag: clientTag, lane, run_id: runId, event: "unblocked", line, actor: "service" });
  }

  /** A Claude session hands a queue table to the service so the work survives the chat. */
  async registerQueue(q: {
    client_tag: string;
    lane: string;
    queue_name: string;
    source_table: string;
    where_sql?: string | null;
    missing: QueueEntry["missing"];
    next_method?: string | null;
    note?: string | null;
    registered_by: string;
  }): Promise<{ entry: QueueEntry; count: number | null; count_error: string | null }> {
    if (!IDENT.test(q.source_table)) throw new Error(`source_table must be schema.table in snake_case, got ${q.source_table}`);
    if (!/^[a-z][a-z0-9_]*$/.test(q.queue_name)) throw new Error("queue_name is snake_case");
    if (q.where_sql && /;|--|\/\*/.test(q.where_sql)) throw new Error("where_sql is a single predicate: no semicolons or comments");
    const { rows } = await this.db.query<QueueEntry>(
      `insert into topup.queue_registry (client_tag, lane, queue_name, source_table, where_sql, missing, next_method, note, registered_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (client_tag, lane, queue_name) do update set
         source_table = excluded.source_table, where_sql = excluded.where_sql, missing = excluded.missing,
         next_method = excluded.next_method, note = coalesce(excluded.note, topup.queue_registry.note),
         registered_by = excluded.registered_by, registered_at = now(), active = true
       returning *`,
      [q.client_tag, q.lane, q.queue_name, q.source_table, q.where_sql ?? null, q.missing, q.next_method ?? null, q.note ?? null, q.registered_by],
    );
    const entry = rows[0];
    const counted = await this.countQueue(entry);
    await this.event({
      client_tag: q.client_tag,
      lane: q.lane,
      event: "queue_registered",
      line: `Queue ${q.queue_name} registered on ${q.source_table} (missing ${q.missing}${q.next_method ? `, next ${q.next_method}` : ""}): ${counted.count === null ? `count failed: ${counted.count_error}` : `${counted.count} rows`}.`,
      actor: q.registered_by,
    });
    return { entry: { ...entry, last_count: counted.count ?? entry.last_count }, ...counted };
  }

  /**
   * Count one registered queue. Read-only transaction with a statement
   * timeout; the table name was validated at registration and the predicate
   * is the owner's own SQL. Never returns rows.
   */
  async countQueue(entry: Pick<QueueEntry, "client_tag" | "lane" | "queue_name" | "source_table" | "where_sql">): Promise<{ count: number | null; count_error: string | null }> {
    if (!IDENT.test(entry.source_table)) return { count: null, count_error: "source_table is not schema.table" };
    const [schema, table] = entry.source_table.split(".");
    const sql = `select count(*)::text as n from "${schema}"."${table}"${entry.where_sql ? ` where ${entry.where_sql}` : ""}`;
    try {
      const n = await this.db.readOnly(async (tx: Queryable) => {
        await tx.query(`set local statement_timeout = ${COUNT_TIMEOUT_MS}`);
        const { rows } = await tx.query<{ n: string }>(sql);
        return Number(rows[0].n);
      });
      await this.db.query(
        `update topup.queue_registry set last_count = $4, last_counted_at = now() where client_tag = $1 and lane = $2 and queue_name = $3`,
        [entry.client_tag, entry.lane, entry.queue_name, n],
      );
      return { count: n, count_error: null };
    } catch (err) {
      return { count: null, count_error: (err as Error).message };
    }
  }

  // ----- reads ------------------------------------------------------------

  async lanes(clientTag?: string): Promise<Array<{ client_tag: string; lane: string }>> {
    const { rows } = await this.db.query<{ client_tag: string; lane: string }>(
      `select client_tag, lane from (
         select client_tag, lane from topup.lane_state
         union select client_tag, lane from topup.lane_recipes
         union select client_tag, lane from topup.queue_registry where active
       ) x where ($1::text is null or client_tag = $1) order by 1, 2`,
      [clientTag ?? null],
    );
    return rows;
  }

  async stateRow(clientTag: string, lane: string): Promise<LaneStateRow | null> {
    const { rows } = await this.db.query<LaneStateRow>(`select * from topup.lane_state where client_tag = $1 and lane = $2`, [clientTag, lane]);
    return rows[0] ?? null;
  }

  async events(clientTag: string, lane: string, limit = EVENTS_SHOWN): Promise<LaneEventRow[]> {
    const { rows } = await this.db.query<LaneEventRow>(
      `select * from topup.lane_events where client_tag = $1 and lane = $2 order by at desc, id desc limit $3`,
      [clientTag, lane, limit],
    );
    return rows;
  }

  async queues(clientTag: string, lane: string): Promise<QueueEntry[]> {
    const { rows } = await this.db.query<QueueEntry>(
      `select * from topup.queue_registry where client_tag = $1 and lane = $2 and active order by missing, queue_name`,
      [clientTag, lane],
    );
    return rows;
  }

  /** Refresh every registered queue count for a lane; called by the digest and by /where when asked. */
  async recount(clientTag: string, lane: string): Promise<void> {
    for (const q of await this.queues(clientTag, lane)) await this.countQueue(q);
  }

  /** Compose the state of one lane. `recount` re-runs the registry counts first (slower, live). */
  async state(clientTag: string, lane: string, opts: { recount?: boolean } = {}): Promise<LaneState> {
    if (opts.recount) await this.recount(clientTag, lane);
    const [row, events, queues, run, recipe] = await Promise.all([
      this.stateRow(clientTag, lane),
      this.events(clientTag, lane),
      this.queues(clientTag, lane),
      this.openRun(clientTag, lane),
      this.recipe(clientTag, lane),
    ]);
    const [ingested, cards, month, campaignsRead, clientRunway] = await Promise.all([
      this.ingestedCounts(clientTag),
      this.openCards(clientTag, lane),
      this.monthSpend(clientTag),
      this.campaigns(clientTag, lane, recipe).then(
        (c) => ({ campaigns: c, error: null as string | null }),
        (err: Error) => ({ campaigns: [] as CampaignHealth[], error: err.message }),
      ),
      this.clientRunway(clientTag, recipe).catch(() => null),
    ]);

    const blocked: Blocker[] = cards.map((c) => ({
      on: c.audience,
      what: cardLine(c),
      since: iso(c.created_at),
      card_id: c.card_id,
    }));
    if (row?.blocked_on) blocked.push({ on: row.blocked_on, what: row.blocked_detail ?? "", since: iso(row.blocked_since ?? row.updated_at) });

    const step = row?.step ?? null;
    return {
      client_tag: clientTag,
      lane,
      step,
      step_label: stepLabel(step),
      step_since: iso(row?.step_since ?? row?.updated_at ?? new Date(0)),
      step_owner: step === null ? null : spineStep(step).owner,
      gate_unmet: row?.gate_unmet ?? null,
      run: run ? { run_id: run.run_id, status: run.status, current_step: run.current_step, opened_at: iso(run.opened_at) } : null,
      next_intent: row?.next_intent ?? (run ? null : "Nothing queued; the runway watch decides when a run opens."),
      blocked,
      queues: {
        ingested_by_status: ingested,
        registry: queues.map((q) => ({ queue_name: q.queue_name, source_table: q.source_table, missing: q.missing, next_method: q.next_method, last_count: q.last_count, last_counted_at: isoOrNull(q.last_counted_at), note: q.note })),
      },
      spend: { this_run_cents_by_vendor: run?.spend_cents_by_vendor ?? {}, this_month_cents_by_vendor: month },
      campaigns: campaignsRead.campaigns,
      client_runway: clientRunway,
      campaigns_error: campaignsRead.error,
      events: events.map((e) => ({ at: iso(e.at), event: e.event, line: e.line, next_intent: e.next_intent, actor: e.actor })),
      registered: Boolean(row) || Boolean(recipe) || queues.length > 0,
    };
  }

  async states(clientTag?: string): Promise<LaneState[]> {
    const out: LaneState[] = [];
    for (const l of await this.lanes(clientTag)) out.push(await this.state(l.client_tag, l.lane));
    return out;
  }

  /** Remember what the digest said, so the next one only speaks when it changes. */
  async markDigest(clientTag: string, lane: string, fingerprint: string): Promise<void> {
    await this.db.query(
      `insert into topup.lane_state (client_tag, lane, digest_fingerprint, digest_sent_at) values ($1,$2,$3,now())
       on conflict (client_tag, lane) do update set digest_fingerprint = $3, digest_sent_at = now()`,
      [clientTag, lane, fingerprint],
    );
  }

  // ----- pieces -----------------------------------------------------------

  private async openRun(clientTag: string, lane: string): Promise<RunRow | null> {
    const { rows } = await this.db.query<RunRow>(
      `select * from topup.runs where client_tag = $1 and lane = $2 and topup.run_is_open(status) limit 1`,
      [clientTag, lane],
    );
    return rows[0] ?? null;
  }

  private async recipe(clientTag: string, lane: string): Promise<ReturnType<typeof parseRecipe> | null> {
    const { rows } = await this.db.query<{ body: unknown }>(
      `select body from topup.lane_recipes where client_tag = $1 and lane = $2 order by version desc limit 1`,
      [clientTag, lane],
    );
    if (!rows[0]) return null;
    try {
      return parseRecipe(rows[0].body);
    } catch {
      return null;
    }
  }

  private async ingestedCounts(clientTag: string): Promise<Record<string, number>> {
    const table = ingestedTable(clientTag);
    const { rows: exists } = await this.db.query<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [table]);
    if (!exists[0]?.ok) return {};
    const { rows } = await this.db.query<{ lead_status: string; n: string }>(`select lead_status, count(*)::text as n from ${table} group by lead_status order by 1`);
    return Object.fromEntries(rows.map((r) => [r.lead_status, Number(r.n)]));
  }

  private async openCards(clientTag: string, lane: string): Promise<CardRow[]> {
    const { rows } = await this.db.query<CardRow>(
      `select c.* from topup.cards c join topup.runs r on r.run_id = c.run_id
       where c.status = 'open' and r.client_tag = $1 and r.lane = $2 order by c.created_at`,
      [clientTag, lane],
    );
    return rows;
  }

  private async monthSpend(clientTag: string): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ vendor: string; cents: string }>(
      `select vendor, sum(cents)::text as cents from topup.spend_ledger
       where client_tag = $1 and created_at >= date_trunc('month', now()) group by vendor order by 1`,
      [clientTag],
    );
    return Object.fromEntries(rows.map((r) => [r.vendor, Number(r.cents)]));
  }

  /** Campaigns the lane feeds: registry rows for the lane, recipe routing cells, else the client's ACTIVE campaigns. */
  private async campaigns(clientTag: string, lane: string, recipe: ReturnType<typeof parseRecipe> | null): Promise<CampaignHealth[]> {
    const ids = new Set<number>();
    const { rows } = await this.db.query<{ campaign_id: string }>(
      `select campaign_id::text from topup.campaign_registry where client_tag = $1 and (lane = $2 or lane is null)`,
      [clientTag, lane],
    );
    for (const r of rows) ids.add(Number(r.campaign_id));
    for (const rule of recipe?.routing ?? []) ids.add(rule.campaign_id);
    if (ids.size === 0 && recipe) for (const id of await campaignIdsForClient(this.db, recipe.smartlead_client_id)) ids.add(id);
    const floor = recipe?.runway.floor_days;
    const snaps = await campaignSnapshots(this.db, [...ids]);
    return snaps.map((s) => assessCampaign(s, floor));
  }

  /** D38 client rem across every ACTIVE campaign. Inbox × MESSAGE_PER_DAY stay unset until Josh names them. */
  private async clientRunway(clientTag: string, recipe: ReturnType<typeof parseRecipe> | null): Promise<ClientRunway | null> {
    if (!recipe) return null;
    const ids = await campaignIdsForClient(this.db, recipe.smartlead_client_id);
    const snaps = await campaignSnapshots(this.db, ids);
    return assessClientRunway({
      clientTag,
      campaigns: snaps.map((s) => assessCampaign(s, recipe.runway.floor_days)),
      uniqueInboxes: null,
      messagePerDay: null,
      floorDays: recipe.runway.floor_days,
    });
  }
}

function cardLine(c: CardRow): string {
  const p = c.payload;
  switch (c.kind) {
    case "spend_approval":
      return `approve or decline $${((Number(p.worst_case_cents) || 0) / 100).toFixed(2)} worst case (${p.vendor}, ${p.rows} rows)`;
    case "stall":
      return `verifier stalled on batch ${p.batch}: resume, split or abort`;
    case "parked":
      return `run parked at ${p.step}: resume or abort`;
    case "gate":
      return `${stepLabel(Number(p.spine_step))} gate unmet (${p.gate}): resume or abort`;
    case "qa_hold":
      return `QA hold ${p.rule_id} on ${p.count} leads: accept, purge or reroute`;
    case "not_working":
      return "campaign is not working: top up anyway or leave it";
    default:
      return `${c.kind} card`;
  }
}

/** Who a card is waiting on, in the words the addendum uses. */
export function audienceName(who: Role | BlockedOn): string {
  if (who === "owner") return "Josh";
  if (who === "operator") return "Cayden";
  return who;
}

export type { Step };
