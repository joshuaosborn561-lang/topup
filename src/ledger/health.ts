import type { Queryable } from "../db/pool.js";
import { INTERESTED_CATEGORY_IDS } from "../domain/working.js";

/**
 * Campaign runway and health (addendum section 2). Read from the hourly
 * Smartlead mirror in campaignintelligence (public.campaigns / leads / sends),
 * never from Smartlead directly. The rules are deliberately few and plain:
 *
 *   silent   — the campaign is ACTIVE, has leads it has never touched, and
 *              sent nothing in the last WINDOW_DAYS days
 *   low      — days of runway (untouched / average daily sends) is under the
 *              floor (recipe runway.floor_days, or DEFAULT_FLOOR_DAYS)
 *   empty    — ACTIVE with nothing left to send
 *   bouncing — bounce share of sends in the window is over BOUNCE_LINE
 *
 * A live campaign with thousands of leads and zero sends for a week is the
 * exact case the addendum names; it is `silent` here and the digest carries it.
 */
export const WINDOW_DAYS = 7;
export const DEFAULT_FLOOR_DAYS = 7;
export const BOUNCE_LINE = 0.05;

export type HealthFlag = "silent" | "low" | "empty" | "bouncing";

export interface CampaignSnapshot {
  smartlead_campaign_id: number;
  name: string | null;
  status: string | null;
  leads_total: number;
  untouched: number;
  sends_window: number;
  last_send_at: string | null;
  interested_window: number;
  bounces_window: number;
  synced_at: string | null;
}

export interface CampaignHealth extends CampaignSnapshot {
  sending: boolean;
  runway_days: number | null;
  flags: HealthFlag[];
}

export function assessCampaign(c: CampaignSnapshot, floorDays = DEFAULT_FLOOR_DAYS): CampaignHealth {
  const active = c.status === "ACTIVE";
  const sending = c.sends_window > 0;
  const perDay = c.sends_window / WINDOW_DAYS;
  const runway = perDay > 0 ? Math.round((c.untouched / perDay) * 10) / 10 : null;
  const flags: HealthFlag[] = [];
  if (active && c.untouched > 0 && !sending) flags.push("silent");
  if (active && c.untouched === 0) flags.push("empty");
  if (active && c.untouched > 0 && runway !== null && runway < floorDays) flags.push("low");
  if (c.sends_window > 0 && c.bounces_window / c.sends_window > BOUNCE_LINE) flags.push("bouncing");
  return { ...c, sending, runway_days: runway, flags };
}

/**
 * Snapshot every campaign in `campaignIds` (Smartlead ids). "Untouched" is a
 * lead with no sent row at all; a lead Smartlead marks STARTED but has mailed
 * once is not untouched. Counts only.
 */
export async function campaignSnapshots(db: Queryable, campaignIds: readonly number[]): Promise<CampaignSnapshot[]> {
  if (campaignIds.length === 0) return [];
  const { rows } = await db.query<{
    smartlead_campaign_id: string;
    name: string | null;
    status: string | null;
    synced_at: string | null;
    leads_total: string;
    untouched: string;
    sends_window: string;
    last_send_at: string | null;
    interested_window: string;
    bounces_window: string;
  }>(
    `with c as (
       select id, smartlead_campaign_id, name, status, synced_at from public.campaigns
       where smartlead_campaign_id = any($1::bigint[])
     ),
     l as (
       select c.smartlead_campaign_id,
              count(*) as leads_total,
              count(*) filter (where not exists (select 1 from public.sends s where s.lead_id = l.id and s.sent)) as untouched
       from c join public.leads l on l.campaign_id = c.id
       group by 1
     ),
     s as (
       select c.smartlead_campaign_id,
              count(*) filter (where s.sent and s.sent_at >= now() - ($2 || ' days')::interval) as sends_window,
              max(s.sent_at) filter (where s.sent) as last_send_at,
              count(*) filter (where s.sent and s.sent_at >= now() - ($2 || ' days')::interval and s.lead_category_id = any($3::int[])) as interested_window,
              count(*) filter (where s.bounced and s.sent_at >= now() - ($2 || ' days')::interval) as bounces_window
       from c join public.sends s on s.campaign_id = c.id
       group by 1
     )
     select c.smartlead_campaign_id::text, c.name, c.status, c.synced_at::text,
            coalesce(l.leads_total,0)::text as leads_total, coalesce(l.untouched,0)::text as untouched,
            coalesce(s.sends_window,0)::text as sends_window, s.last_send_at::text,
            coalesce(s.interested_window,0)::text as interested_window, coalesce(s.bounces_window,0)::text as bounces_window
     from c left join l on l.smartlead_campaign_id = c.smartlead_campaign_id
            left join s on s.smartlead_campaign_id = c.smartlead_campaign_id
     order by c.smartlead_campaign_id`,
    [campaignIds, String(WINDOW_DAYS), INTERESTED_CATEGORY_IDS],
  );
  return rows.map((r) => ({
    smartlead_campaign_id: Number(r.smartlead_campaign_id),
    name: r.name,
    status: r.status,
    leads_total: Number(r.leads_total),
    untouched: Number(r.untouched),
    sends_window: Number(r.sends_window),
    last_send_at: r.last_send_at,
    interested_window: Number(r.interested_window),
    bounces_window: Number(r.bounces_window),
    synced_at: r.synced_at,
  }));
}

/** Campaign ids for a Smartlead client, from the mirror. Used when a lane names no campaigns yet. */
export async function campaignIdsForClient(db: Queryable, smartleadClientId: number, onlyActive = true): Promise<number[]> {
  const { rows } = await db.query<{ id: string }>(
    `select smartlead_campaign_id::text as id from public.campaigns
     where smartlead_client_id = $1 and ($2::boolean is false or status = 'ACTIVE') order by 1`,
    [smartleadClientId, onlyActive],
  );
  return rows.map((r) => Number(r.id));
}
