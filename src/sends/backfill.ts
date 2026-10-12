import type { Queryable } from "../db/pool.js";
import { extractSenderFromHistory, extractSenderFromLead, writeSendSenderByPair } from "./sender.js";

/**
 * Smartlead sender backfill (D81). Server to server. Dry-run by default.
 * Rate limited. Resumable. Counts and ids only — never a lead email or name.
 */

export const SMARTLEAD_API_BASE = "https://server.smartlead.ai/api/v1";
export const DEFAULT_BACKFILL_RPS = 2;
export const LEADS_PAGE_SIZE = 100;

export interface BackfillEstimate {
  sent_rows: number;
  distinct_pairs: number;
  campaigns: number;
  missing_sender: number;
  list_calls: number;
  history_calls_worst: number;
  rps: number;
  seconds_worst: number;
  hours_worst: number;
  dry_run: true;
  apply: false;
  note: string;
}

export interface BackfillOpts {
  apply?: boolean;
  rps?: number;
  limit?: number;
  resume?: boolean;
}

export function estimateFromCounts(input: {
  sent_rows: number;
  distinct_pairs: number;
  campaigns: number;
  missing_sender: number;
  rps?: number;
}): BackfillEstimate {
  const rps = input.rps && input.rps > 0 ? input.rps : DEFAULT_BACKFILL_RPS;
  const pairs = Math.max(0, input.missing_sender);
  const campaigns = Math.max(0, input.campaigns);
  const perCampaign = campaigns > 0 ? Math.ceil(pairs / campaigns) : 0;
  const list_calls = campaigns * Math.max(1, Math.ceil(perCampaign / LEADS_PAGE_SIZE));
  const history_calls_worst = pairs;
  const seconds_worst = history_calls_worst === 0 ? 0 : Math.ceil(history_calls_worst / rps);
  return {
    sent_rows: input.sent_rows,
    distinct_pairs: input.distinct_pairs,
    campaigns,
    missing_sender: pairs,
    list_calls,
    history_calls_worst,
    rps,
    seconds_worst,
    hours_worst: Math.round((seconds_worst / 3600) * 10) / 10,
    dry_run: true,
    apply: false,
    note: "Dry-run. Migration 0024_sends_sender.sql is unapplied. This does not call Smartlead and writes nothing.",
  };
}

export async function estimateBackfill(db: Queryable, rps = DEFAULT_BACKFILL_RPS): Promise<BackfillEstimate> {
  const hasSender = await columnExists(db, "public", "sends", "sender");
  const { rows } = await db.query<{ sent_rows: string; distinct_pairs: string; campaigns: string; missing_sender: string }>(
    `select
       count(*)::text as sent_rows,
       count(distinct (c.smartlead_campaign_id, l.smartlead_lead_id))::text as distinct_pairs,
       count(distinct c.smartlead_campaign_id)::text as campaigns,
       count(*) filter (where ${hasSender ? "s.sender is null" : "true"})::text as missing_sender
     from public.sends s
     join public.leads l on l.id = s.lead_id
     join public.campaigns c on c.id = s.campaign_id
     where s.sent
       and c.smartlead_campaign_id is not null
       and l.smartlead_lead_id is not null`,
  );
  const r = rows[0];
  return estimateFromCounts({
    sent_rows: Number(r?.sent_rows ?? 0),
    distinct_pairs: Number(r?.distinct_pairs ?? 0),
    campaigns: Number(r?.campaigns ?? 0),
    missing_sender: Number(r?.missing_sender ?? 0),
    rps,
  });
}

export async function runBackfill(
  db: Queryable,
  fetchImpl: typeof fetch,
  apiKey: string,
  opts: BackfillOpts = {},
): Promise<{ written: number; pairs: number; calls: number; dry_run: boolean }> {
  if (!opts.apply) {
    return { written: 0, pairs: 0, calls: 0, dry_run: true };
  }
  if (!(await columnExists(db, "public", "sends", "sender"))) {
    throw new Error("public.sends.sender is missing; apply 0024_sends_sender.sql first. Ask Josh.");
  }
  const rps = opts.rps && opts.rps > 0 ? opts.rps : DEFAULT_BACKFILL_RPS;
  const gapMs = Math.ceil(1000 / rps);
  const pairs = await loadPairs(db, opts.limit ?? 0, opts.resume !== false);
  let written = 0;
  let calls = 0;
  const byCampaign = new Map<number, Array<{ campaignUuid: string; leadUuid: string; slLead: number }>>();
  for (const p of pairs) {
    const list = byCampaign.get(p.slCampaign) ?? [];
    list.push({ campaignUuid: p.campaignUuid, leadUuid: p.leadUuid, slLead: p.slLead });
    byCampaign.set(p.slCampaign, list);
  }
  for (const [slCampaign, rows] of byCampaign) {
    const leftover = new Map(rows.map((r) => [r.slLead, r]));
    let offset = 0;
    for (;;) {
      await sleep(gapMs);
      const page = await smartleadGet(fetchImpl, apiKey, `/campaigns/${slCampaign}/leads`, { offset, limit: LEADS_PAGE_SIZE });
      calls += 1;
      const leads = leadRows(page);
      if (leads.length === 0) break;
      for (const lead of leads) {
        const slLead = Number(lead.id ?? lead.lead_id ?? asRecord(lead.lead)?.id);
        const row = leftover.get(slLead);
        if (!row) continue;
        const sender = extractSenderFromLead(lead);
        if (sender) {
          written += await writeSendSenderByPair(db, { campaignId: row.campaignUuid, leadId: row.leadUuid, sender });
          leftover.delete(slLead);
        }
      }
      if (leads.length < LEADS_PAGE_SIZE) break;
      offset += LEADS_PAGE_SIZE;
    }
    for (const row of leftover.values()) {
      await sleep(gapMs);
      const hist = await smartleadGet(fetchImpl, apiKey, `/campaigns/${slCampaign}/leads/${row.slLead}/message-history`);
      calls += 1;
      const sender = extractSenderFromHistory(hist);
      if (sender) {
        written += await writeSendSenderByPair(db, { campaignId: row.campaignUuid, leadId: row.leadUuid, sender });
      }
    }
    await checkpoint(db, slCampaign, rows.length, written);
  }
  return { written, pairs: pairs.length, calls, dry_run: false };
}

async function loadPairs(
  db: Queryable,
  limit: number,
  resume: boolean,
): Promise<Array<{ campaignUuid: string; leadUuid: string; slCampaign: number; slLead: number }>> {
  const resumeJoin = resume
    ? `left join topup.sender_backfill b on b.smartlead_campaign_id = c.smartlead_campaign_id`
    : "";
  const resumeWhere = resume
    ? `and (b.smartlead_campaign_id is null or b.status <> 'done' or l.smartlead_lead_id > coalesce(b.last_smartlead_lead_id, 0))`
    : "";
  const lim = limit > 0 ? `limit ${Math.floor(limit)}` : "";
  const { rows } = await db.query<{ campaign_id: string; lead_id: string; sl_campaign: string; sl_lead: string }>(
    `select distinct s.campaign_id::text as campaign_id, s.lead_id::text as lead_id,
            c.smartlead_campaign_id::text as sl_campaign, l.smartlead_lead_id::text as sl_lead
       from public.sends s
       join public.leads l on l.id = s.lead_id
       join public.campaigns c on c.id = s.campaign_id
       ${resumeJoin}
      where s.sent and s.sender is null
        and c.smartlead_campaign_id is not null
        and l.smartlead_lead_id is not null
        ${resumeWhere}
      order by c.smartlead_campaign_id, l.smartlead_lead_id
      ${lim}`,
  );
  return rows.map((r) => ({
    campaignUuid: r.campaign_id,
    leadUuid: r.lead_id,
    slCampaign: Number(r.sl_campaign),
    slLead: Number(r.sl_lead),
  }));
}

async function checkpoint(db: Queryable, slCampaign: number, seen: number, written: number): Promise<void> {
  await db.query(
    `insert into topup.sender_backfill (smartlead_campaign_id, pairs_seen, pairs_written, status, updated_at)
     values ($1, $2, $3, 'started', now())
     on conflict (smartlead_campaign_id) do update
       set pairs_seen = topup.sender_backfill.pairs_seen + $2,
           pairs_written = $3,
           status = 'started',
           updated_at = now()`,
    [slCampaign, seen, written],
  );
}

async function columnExists(db: Queryable, schema: string, table: string, column: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select count(*)::text as n from information_schema.columns
      where table_schema = $1 and table_name = $2 and column_name = $3`,
    [schema, table, column],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function smartleadGet(
  fetchImpl: typeof fetch,
  apiKey: string,
  path: string,
  query: Record<string, number> = {},
): Promise<unknown> {
  const url = new URL(`${SMARTLEAD_API_BASE}${path}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetchImpl(url, { method: "GET" });
  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? "2") * 1000;
    await sleep(Number.isFinite(wait) ? wait : 2000);
    return smartleadGet(fetchImpl, apiKey, path, query);
  }
  if (!res.ok) throw new Error(`Smartlead ${path} ${res.status}`);
  return res.json();
}

function leadRows(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  const o = asRecord(payload);
  for (const k of ["data", "leads", "items"]) {
    const v = o?.[k];
    if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  return [];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
