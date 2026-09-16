/**
 * Prior contact (D35 item 2). Do not load anyone this client *sent to*
 * in the last N days (default 90). Past that window, with no rule-1
 * response (positive / DNC / wrong person — those stay blocked forever
 * in the reason CASE), they are fair game.
 *
 * Never put someone in two live campaigns of the same client at once
 * (D36 item 2 addition). `exclude_other_live_campaigns` defaults true.
 */

export const DEFAULT_RECYCLE_DAYS = 90;

export function recycleDays(recipeDays: number | null | undefined): number {
  return recipeDays && recipeDays > 0 ? recipeDays : DEFAULT_RECYCLE_DAYS;
}

/** Sent by this Smartlead client inside the recycle window. */
export function recentClientSendSql(daysParam: string): string {
  return `exists (
    select 1 from public.leads l
    join public.sends s on s.lead_id = l.id
    where lower(l.email) = r.e and l.smartlead_client_id = $6
      and s.sent and s.sent_at is not null
      and s.sent_at >= now() - (${daysParam}::int * interval '1 day')
  )`;
}

/**
 * Pending addition to item 2: already sitting in another live campaign
 * of this client (mirror or staging), regardless of send state.
 */
export function liveCampaignSql(): string {
  const live = `upper(coalesce(c.status, '')) not in ('STOPPED', 'COMPLETED')`;
  return `(
    exists (
      select 1 from public.leads l
      join public.campaigns c on c.id = l.campaign_id
      where lower(l.email) = r.e and l.smartlead_client_id = $6
        and ${live}
    )
    or exists (
      select 1 from public.leads_staging s
      join public.campaigns c on c.smartlead_campaign_id = s.campaign_id
      where lower(s.email) = r.e and c.smartlead_client_id = $6
        and ${live}
    )
  )`;
}

export function clientPriorContactSql(daysParam: string, includeLiveCampaigns: boolean): string {
  const sent = recentClientSendSql(daysParam);
  if (!includeLiveCampaigns) return sent;
  return `(${sent} or ${liveCampaignSql()})`;
}
