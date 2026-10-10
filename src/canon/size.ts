import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/pool.js";
import { INTERESTED_CATEGORY_IDS } from "../domain/working.js";
import { logger } from "../lib/log.js";
import { MIN_NET_NEW } from "../policy/rules.js";
import { BOUNCE_CATEGORY_ID, DNC_CATEGORY_ID, SUPPRESS_REASONS, WRONG_PERSON_CATEGORY_ID } from "../stages/suppress/index.js";
import { clientPriorContactSql, DEFAULT_RECYCLE_DAYS, positiveReplySql } from "../stages/suppress/recycle.js";
import { loadClientMap } from "./clients.js";
import { countMapsPool, mapsPoolFromFilters, mapsPoolWhere, resolveMapsPool, type MapsPoolResolved } from "./mapsPool.js";

/**
 * Free dry-run sizing (D64, D65). Walks the stored maps pool the way `count`
 * does (plan_id + ICP view), then reports already held, suppression drops
 * by reason, and net new. Opens no job, spends nothing, does not block
 * the lane. Counts only. The MCP call returns a size_id at once; poll
 * `size(size_id)`. The suppress pass is one aggregate JOIN, not a
 * correlated EXISTS per email (D65).
 */

const log = logger("size");

export interface SizeRead {
  source: string;
  client_tag: string;
  campaign_id: number;
  filters_used: Record<string, unknown>;
  pool: number | null;
  already_live: number;
  already_ingested: number;
  already_contacted: number;
  already_used: number;
  removed: Record<string, number>;
  suppressed: number;
  net_new: number | null;
  cost_cents: 0;
  job_id: null;
  size_id: string | null;
  status: "started" | "done" | "failed";
  last_error: string | null;
  rule: string;
  note: string;
}

export const SIZE_RULE = `This is a dry run of the stored Maps pool: pool, already held (live + ingested + contacted), suppression drops by reason, then net new. Under ${MIN_NET_NEW} more, the TAM for this campaign is exhausted. Opens no job and spends nothing. Returns a size_id at once; poll size(size_id).`;

/** Statement timeout on the aggregate suppress pass (D65). Ask Josh if 45s is wrong. */
export const SIZE_STATEMENT_TIMEOUT_MS = 45_000;

/**
 * Recycle SQL hardcodes $2 (interested ids) through $10 (days). The pool
 * FROM after D68 also binds $1 / $2 (plan_id, categories). Shift those
 * pool binds past the suppress slots (D69).
 */
export const SIZE_SUPPRESS_BIND_OFFSET = 10;

/** Move $n placeholders forward so pool binds do not collide with $2::int[]. */
export function shiftSqlParams(sql: string, offset: number): string {
  if (!offset) return sql;
  return sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
}

const IDENT = /^[a-z][a-z0-9_]*$/;

export type SizeInput = { client_tag: string; campaign_id: number; source: string; filters: Record<string, unknown> };

function emptyRemoved(): Record<string, number> {
  return Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0]));
}

function baseOf(input: SizeInput, size_id: string | null, status: SizeRead["status"]): Omit<SizeRead, "filters_used" | "pool" | "net_new" | "note"> {
  return {
    source: input.source,
    client_tag: input.client_tag,
    campaign_id: input.campaign_id,
    already_live: 0,
    already_ingested: 0,
    already_contacted: 0,
    already_used: 0,
    removed: emptyRemoved(),
    suppressed: 0,
    cost_cents: 0,
    job_id: null,
    size_id,
    status,
    last_error: null,
    rule: SIZE_RULE,
  };
}

export async function sizeRead(db: Queryable, input: SizeInput, size_id: string | null = null): Promise<SizeRead> {
  const base = baseOf(input, size_id, "done");
  if (input.source !== "maps") {
    return {
      ...base,
      filters_used: input.filters,
      pool: null,
      net_new: null,
      note: "size walks the stored Maps pool (plan_id + ICP view). For getleads use count + held. Ask Josh.",
    };
  }
  const spec = mapsPoolFromFilters(input.filters, input.client_tag);
  if ("error" in spec) {
    return { ...base, filters_used: input.filters, pool: null, net_new: null, note: spec.error };
  }
  const counted = await countMapsPool(db, input.client_tag, input.filters);
  if ("error" in counted) {
    return { ...base, filters_used: input.filters, pool: null, net_new: null, note: counted.error };
  }
  const resolved = await resolveMapsPool(db, input.client_tag, spec);
  const where = "error" in resolved ? "" : await mapsPoolWhere(db, spec, resolved);
  const removed =
    "error" in resolved ? emptyRemoved() : await suppressByReason(db, input.client_tag, input.campaign_id, resolved, spec.plan_id, where);
  const suppressed = Object.values(removed).reduce((a, b) => a + b, 0);
  const net_new = Math.max(0, counted.net_new - suppressed);
  return {
    ...base,
    filters_used: counted.filters_used,
    pool: counted.pool,
    already_live: counted.already_live,
    already_ingested: counted.already_ingested,
    already_contacted: counted.already_contacted,
    already_used: counted.already_used,
    removed,
    suppressed,
    net_new,
    note: `${counted.relation}: pool ${counted.pool}, already live ${counted.already_live}, already ingested ${counted.already_ingested}, already contacted ${counted.already_contacted}, used ${counted.already_used}, suppressed ${suppressed}, net new ${net_new}.`,
  };
}

/**
 * One aggregate pass: distinct pool emails, then LEFT JOIN the suppress
 * sets (D65). Correlated EXISTS per email is what timed out at the MCP
 * 60s limit on EMCOR Lane E.
 */
export function sizeSuppressJoinSql(resolved: MapsPoolResolved, destRef: string | null, whens: string[], where = ""): string {
  const fromSql = shiftSqlParams(resolved.fromSql, SIZE_SUPPRESS_BIND_OFFSET);
  const whereSql = shiftSqlParams(where, SIZE_SUPPRESS_BIND_OFFSET);
  return `with p as (
         select $2::int[] as positive, $3::int as dnc, $4::int as wrong_person, $5::int as bounce,
                $6::bigint as smartlead_client_id, $7::bigint[] as client_campaigns, $8::text[] as offer_keys, $9::text as client_tag,
                $10::int as recycle_after_days
       ),
       pool_emails as (
         select distinct lower(nullif(btrim(m.email), '')) as e
           from ${fromSql}
           left join "${resolved.schema}"."maps_raw" m on m.place_id = pool.place_id
           ${whereSql}
       ),
       r as (
         select e, split_part(e, '@', 2) as d from pool_emails
          where e is not null and position('@' in e) > 0
            ${destRef ? `and not exists (select 1 from ${destRef} h where lower(h.email) = e)` : ""}
       ),
       pos as (
         select distinct r.e from r, p where ${positiveReplySql("$10")}
       ),
       dnc as (
         select distinct lower(l.email) as e from public.leads l where l.category_id = $3
       ),
       wrong as (
         select distinct lower(l.email) as e from public.leads l where l.category_id = $4
       ),
       supp as (
         select distinct lower(s.email) as e from public.suppression s
       ),
       bounce as (
         select distinct lower(l.email) as e from public.leads l where l.category_id = $5
         union
         select distinct lower(l.email) from public.leads l join public.sends s on s.lead_id = l.id where s.bounced
       ),
       prior as (
         select distinct r.e from r, p where ${clientPriorContactSql("$10", true)}
       ),
       offer as (
         select distinct lower(l.email) as e
           from public.leads l
           join public.campaigns c on c.id = l.campaign_id
           join topup.campaign_registry cr on cr.campaign_id = c.smartlead_campaign_id
          where cr.offer_key = any($8::text[]) and cr.client_tag <> $9
       ),
       classified as (
         select r.e,
                case
                  when pos.e is not null then 'positive_reply'
                  when dnc.e is not null then 'do_not_contact'
                  when wrong.e is not null then 'wrong_person'
                  when supp.e is not null then 'suppression_list'
                  when bounce.e is not null then 'bounced'
                  when prior.e is not null then 'client_prior_contact'
                  when offer.e is not null then 'same_offer_other_client'
                  ${whens.length ? whens.map((w) => `when ${w}`).join("\n                  ") : ""}
                end as reason
           from r
           left join pos on pos.e = r.e
           left join dnc on dnc.e = r.e
           left join wrong on wrong.e = r.e
           left join supp on supp.e = r.e
           left join bounce on bounce.e = r.e
           left join prior on prior.e = r.e
           left join offer on offer.e = r.e
       )
       select coalesce(reason, 'none') as reason, count(*)::text as n from classified group by 1`;
}

async function suppressByReason(
  db: Queryable,
  clientTag: string,
  campaignId: number,
  resolved: MapsPoolResolved,
  planId: string,
  where = "",
): Promise<Record<string, number>> {
  const zero = emptyRemoved();
  if (!IDENT.test(clientTag)) return zero;
  try {
    const { rows: tables } = await db.query<{ leads: boolean; sends: boolean; suppression: boolean; campaigns: boolean }>(
      `select to_regclass('public.leads') is not null as leads, to_regclass('public.sends') is not null as sends,
              to_regclass('public.suppression') is not null as suppression, to_regclass('public.campaigns') is not null as campaigns`,
    );
    const t = tables[0];
    if (!t?.leads) return zero;
    const client = (await loadClientMap(db).catch(() => [])).find((c) => c.client_tag === clientTag);
    if (!client) return zero;
    const destTable = `${clientTag}_ingested_leads`;
    const offer = await db
      .query<{ offer_key: string | null }>(`select offer_key from topup.campaign_registry where campaign_id = $1`, [campaignId])
      .catch(() => ({ rows: [] as Array<{ offer_key: string | null }> }));
    const offerKeys = offer.rows.map((r) => r.offer_key).filter((k): k is string => Boolean(k));
    const campaignIds = t.campaigns
      ? (await db.query<{ id: string }>(`select smartlead_campaign_id::text as id from public.campaigns where smartlead_client_id = $1`, [client.smartlead_client_id]).catch(() => ({ rows: [] as Array<{ id: string }> }))).rows
          .map((r) => Number(r.id))
          .filter((n) => Number.isFinite(n))
      : [campaignId];
    const extra: string[] = [];
    if (!t.suppression) extra.push("false then 'suppression_list'");
    const destRef = IDENT.test(destTable) ? `"lp"."${destTable}"` : null;
    const sql = sizeSuppressJoinSql(resolved, destRef, extra, where);
    const params = [
      planId,
      [...INTERESTED_CATEGORY_IDS],
      DNC_CATEGORY_ID,
      WRONG_PERSON_CATEGORY_ID,
      BOUNCE_CATEGORY_ID,
      client.smartlead_client_id,
      campaignIds.length ? campaignIds : [campaignId],
      offerKeys,
      clientTag,
      DEFAULT_RECYCLE_DAYS,
      ...resolved.params,
    ];
    const run = async (q: Queryable) => {
      await q.query(`set local statement_timeout = ${SIZE_STATEMENT_TIMEOUT_MS}`).catch(() => undefined);
      return q.query<{ reason: string; n: string }>(sql, params);
    };
    const withTx = db as Queryable & { readOnly?: <T>(fn: (tx: Queryable) => Promise<T>) => Promise<T> };
    const { rows } = withTx.readOnly ? await withTx.readOnly((tx) => run(tx)) : await run(db);
    const out = { ...zero };
    for (const row of rows) {
      if (row.reason === "none") continue;
      if (row.reason in out) out[row.reason] = Number(row.n);
    }
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("size suppress failed", { client_tag: clientTag, error: message });
    throw err;
  }
}

export interface SizeJob {
  size_id: string;
  status: SizeRead["status"];
  started_at: string;
  result: SizeRead;
}

/**
 * In-process size runner (D65). One replica (D5). Returns the size_id at
 * once; poll size(size_id). Opens no run. A restart loses an in-flight
 * size — call size again. Nothing starts on its own.
 */
export class SizeRunner {
  private readonly jobs = new Map<string, SizeJob>();
  private readonly inFlight = new Set<string>();

  constructor(private readonly db: Queryable) {}

  async start(input: SizeInput): Promise<SizeRead> {
    const size_id = randomUUID();
    const started: SizeRead = {
      ...baseOf(input, size_id, "started"),
      filters_used: input.filters,
      pool: null,
      net_new: null,
      note: "size started. Poll size(size_id). Opens no job and spends nothing.",
    };
    this.jobs.set(size_id, { size_id, status: "started", started_at: new Date().toISOString(), result: started });
    if (!this.inFlight.has(size_id)) {
      this.inFlight.add(size_id);
      void this.run(size_id, input).finally(() => this.inFlight.delete(size_id));
    }
    return started;
  }

  async get(size_id: string): Promise<SizeRead> {
    const job = this.jobs.get(size_id);
    if (!job) {
      return {
        ...baseOf({ client_tag: "", campaign_id: 0, source: "", filters: {} }, size_id, "failed"),
        client_tag: "",
        campaign_id: 0,
        source: "",
        filters_used: {},
        pool: null,
        net_new: null,
        last_error: "no such size_id; call size(client_tag, campaign_id, source, filters) again",
        note: "no such size_id. A restart loses an in-flight size. Call size again.",
      };
    }
    return job.result;
  }

  private async run(size_id: string, input: SizeInput): Promise<void> {
    const job = this.jobs.get(size_id);
    if (!job) return;
    try {
      const result = await sizeRead(this.db, input, size_id);
      job.status = result.status;
      job.result = result;
      this.jobs.set(size_id, job);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("size failed in the background", { size_id, error: message });
      job.status = "failed";
      job.result = {
        ...job.result,
        status: "failed",
        last_error: message,
        note: `size failed: ${message.slice(0, 200)}`,
      };
      this.jobs.set(size_id, job);
    }
  }
}
