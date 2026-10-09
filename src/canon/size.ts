import type { Queryable } from "../db/pool.js";
import { INTERESTED_CATEGORY_IDS } from "../domain/working.js";
import { MIN_NET_NEW } from "../policy/rules.js";
import { BOUNCE_CATEGORY_ID, DNC_CATEGORY_ID, SUPPRESS_REASONS, WRONG_PERSON_CATEGORY_ID } from "../stages/suppress/index.js";
import { clientPriorContactSql, DEFAULT_RECYCLE_DAYS, positiveReplySql } from "../stages/suppress/recycle.js";
import { loadClientMap } from "./clients.js";
import { countMapsPool, mapsPoolFromFilters, resolveMapsPool, type MapsPoolResolved } from "./mapsPool.js";

/**
 * Free dry-run sizing (D64). Walks the stored maps pool the way `count`
 * does (plan_id + ICP view), then reports already held, suppression drops
 * by reason, and net new. Opens no job, spends nothing, does not block
 * the lane. Counts only.
 */

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
  rule: string;
  note: string;
}

export const SIZE_RULE = `This is a dry run of the stored Maps pool: pool, already held (live + ingested + contacted), suppression drops by reason, then net new. Under ${MIN_NET_NEW} more, the TAM for this campaign is exhausted. Opens no job and spends nothing.`;

const IDENT = /^[a-z][a-z0-9_]*$/;

export async function sizeRead(
  db: Queryable,
  input: { client_tag: string; campaign_id: number; source: string; filters: Record<string, unknown> },
): Promise<SizeRead> {
  const emptyRemoved = Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0]));
  const base = {
    source: input.source,
    client_tag: input.client_tag,
    campaign_id: input.campaign_id,
    already_live: 0,
    already_ingested: 0,
    already_contacted: 0,
    already_used: 0,
    removed: emptyRemoved,
    suppressed: 0,
    cost_cents: 0 as const,
    job_id: null,
    rule: SIZE_RULE,
  };
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
  const removed =
    "error" in resolved ? emptyRemoved : await suppressByReason(db, input.client_tag, input.campaign_id, resolved, spec.plan_id);
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

async function suppressByReason(
  db: Queryable,
  clientTag: string,
  campaignId: number,
  resolved: MapsPoolResolved,
  planId: string,
): Promise<Record<string, number>> {
  const zero = Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0]));
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
    const whens: string[] = [];
    whens.push(`when ${positiveReplySql("$10")} then 'positive_reply'`);
    whens.push(`when exists (select 1 from public.leads l where lower(l.email) = r.e and l.category_id = $3) then 'do_not_contact'`);
    whens.push(`when exists (select 1 from public.leads l where lower(l.email) = r.e and l.category_id = $4) then 'wrong_person'`);
    if (t.suppression) whens.push(`when exists (select 1 from public.suppression s where lower(s.email) = r.e) then 'suppression_list'`);
    if (t.sends) {
      whens.push(
        `when exists (select 1 from public.leads l join public.sends s on s.lead_id = l.id where lower(l.email) = r.e and s.bounced) or exists (select 1 from public.leads l where lower(l.email) = r.e and l.category_id = $5) then 'bounced'`,
      );
      whens.push(`when ${clientPriorContactSql("$10", Boolean(t.campaigns))} then 'client_prior_contact'`);
    }
    if (offerKeys.length && t.campaigns) {
      whens.push(
        `when exists (select 1 from public.leads l join public.campaigns c on c.id = l.campaign_id join topup.campaign_registry cr on cr.campaign_id = c.smartlead_campaign_id where lower(l.email) = r.e and cr.offer_key = any($8::text[]) and cr.client_tag <> $9) then 'same_offer_other_client'`,
      );
    }
    const destRef = IDENT.test(destTable) ? `"lp"."${destTable}"` : null;
    const { rows } = await db.query<{ reason: string; n: string }>(
      `with p as (
         select $2::int[] as positive, $3::int as dnc, $4::int as wrong_person, $5::int as bounce,
                $6::bigint as smartlead_client_id, $7::bigint[] as client_campaigns, $8::text[] as offer_keys, $9::text as client_tag,
                $10::int as recycle_after_days
       ),
       pool_emails as (
         select distinct lower(nullif(btrim(m.email), '')) as e
           from ${resolved.fromSql}
           left join "${resolved.schema}"."maps_raw" m on m.place_id = pool.place_id
       ),
       r as (
         select e, split_part(e, '@', 2) as d from pool_emails
          where e is not null and position('@' in e) > 0
            ${destRef ? `and not exists (select 1 from ${destRef} h where lower(h.email) = e)` : ""}
       )
       select coalesce((case ${whens.join(" ")} end), 'none') as reason, count(*)::text as n from r, p group by 1`,
      [
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
      ],
    );
    const out = { ...zero };
    for (const row of rows) {
      if (row.reason === "none") continue;
      if (row.reason in out) out[row.reason] = Number(row.n);
    }
    return out;
  } catch {
    return zero;
  }
}
