import type { Queryable } from "../db/pool.js";
import {
  NOT_INTERESTED_CATEGORY_ID,
  NOT_INTERESTED_TEXT_SQL,
  SMARTLEAD_DNC_CATEGORY_ID,
  UNSUB_CATEGORY_SQL,
  UNSUB_TEXT_SQL,
} from "./classify.js";
import { hasNegativeClassColumn } from "./store.js";

/**
 * D81 — classify future negatives as they arrive. Text and category only,
 * in SQL, so reply bodies never enter service memory. Never calls AI.
 * No cron. The 0025 trigger does the same work on insert/update.
 * Suppress calls this for unclassified rows on this client so a missed
 * trigger still lands a class.
 */

export interface ArriveCounts {
  seen: number;
  wrote_unsubscribe: number;
  wrote_not_interested: number;
  needs_ai: number;
  skipped_no_column: number;
}

const EMPTY: ArriveCounts = { seen: 0, wrote_unsubscribe: 0, wrote_not_interested: 0, needs_ai: 0, skipped_no_column: 0 };

function classCase(): string {
  return `case
    when lower(coalesce(l.status, '')) = 'unsubscribed' then 'unsubscribe'
    when coalesce(i.body, '') ~ '${UNSUB_TEXT_SQL}' then 'unsubscribe'
    when coalesce(i.body, '') ~ '${NOT_INTERESTED_TEXT_SQL}' then 'not_interested'
    when lower(coalesce(l.category, '')) ~ '${UNSUB_CATEGORY_SQL}' then 'unsubscribe'
    when l.category_id = ${NOT_INTERESTED_CATEGORY_ID} then 'not_interested'
    else null
  end`;
}

function sourceCase(): string {
  return `case
    when lower(coalesce(l.status, '')) = 'unsubscribed' then 'status'
    when coalesce(i.body, '') ~ '${UNSUB_TEXT_SQL}' then 'text'
    when coalesce(i.body, '') ~ '${NOT_INTERESTED_TEXT_SQL}' then 'text'
    when lower(coalesce(l.category, '')) ~ '${UNSUB_CATEGORY_SQL}' then 'category'
    when l.category_id = ${NOT_INTERESTED_CATEGORY_ID} then 'category'
    else 'needs_ai'
  end`;
}

function latestBodySql(): string {
  return `latest as (
    select distinct on (m.lead_id) m.lead_id, lower(coalesce(m.body, '')) as body
      from public.messages m
     where m.direction = 'inbound'
     order by m.lead_id, coalesce(m.received_at, m.sent_at, m.created_at) desc
  )`;
}

function negativeWhere(clientSlot: string | null): string {
  const client = clientSlot ? `and l.smartlead_client_id = ${clientSlot}` : "";
  return `l.email is not null
        and l.negative_class is null
        and (l.category_id in (${NOT_INTERESTED_CATEGORY_ID}, ${SMARTLEAD_DNC_CATEGORY_ID})
             or lower(coalesce(l.status, '')) = 'unsubscribed')
        ${client}`;
}

export async function classifyArrivingNegatives(
  db: Queryable,
  input: { clientId?: number; apply?: boolean; limit?: number } = {},
): Promise<ArriveCounts> {
  if (!(await hasNegativeClassColumn(db))) return { ...EMPTY, skipped_no_column: 1 };
  const { rows: haveMsg } = await db.query<{ ok: boolean }>(`select to_regclass('public.messages') is not null as ok`);
  if (!haveMsg[0]?.ok) return { ...EMPTY };
  const limit = input.limit && input.limit > 0 ? Math.floor(input.limit) : 2000;
  const clientSlot = input.clientId != null ? "$1" : null;
  const limitSlot = input.clientId != null ? "$2" : "$1";
  const params: unknown[] = input.clientId != null ? [input.clientId, limit] : [limit];
  if (!input.apply) {
    const { rows } = await db.query<{ cls: string | null; n: string }>(
      `with ${latestBodySql()},
            scored as (
              select ${classCase()} as cls
                from public.leads l
                left join latest i on i.lead_id = l.id
               where ${negativeWhere(clientSlot)}
               limit ${limitSlot}
            )
       select cls, count(*)::text as n from scored group by 1`,
      params,
    );
    const out = { ...EMPTY };
    for (const r of rows) {
      const n = Number(r.n);
      out.seen += n;
      if (r.cls === "unsubscribe") out.wrote_unsubscribe += n;
      else if (r.cls === "not_interested") out.wrote_not_interested += n;
      else out.needs_ai += n;
    }
    return out;
  }
  const { rows } = await db.query<{ cls: string; n: string }>(
    `with ${latestBodySql()},
          scored as (
            select l.id, ${classCase()} as cls, ${sourceCase()} as src
              from public.leads l
              left join latest i on i.lead_id = l.id
             where ${negativeWhere(clientSlot)}
             limit ${limitSlot}
          ),
          hit as (
            update public.leads t
               set negative_class = s.cls,
                   negative_class_source = s.src,
                   negative_classed_at = now(),
                   updated_at = now()
              from scored s
             where t.id = s.id and s.cls is not null and t.negative_class is null
            returning s.cls
          )
     select cls, count(*)::text as n from hit group by 1`,
    params,
  );
  const out = { ...EMPTY };
  for (const r of rows) {
    if (r.cls === "unsubscribe") out.wrote_unsubscribe += Number(r.n);
    if (r.cls === "not_interested") out.wrote_not_interested += Number(r.n);
  }
  const leftover = await db.query<{ n: string }>(
    `select count(*)::text as n from public.leads l
      where ${negativeWhere(clientSlot)}`,
    input.clientId != null ? [input.clientId] : [],
  );
  out.needs_ai = Number(leftover.rows[0]?.n ?? 0);
  out.seen = out.wrote_unsubscribe + out.wrote_not_interested + out.needs_ai;
  return out;
}

/** Patterns the 0025 trigger uses. Guard keeps them in lockstep. */
export function arrivingClassifySql(): string {
  return [UNSUB_TEXT_SQL, NOT_INTERESTED_TEXT_SQL, UNSUB_CATEGORY_SQL, "negative_class", "unsubscribed"].join(" ");
}
