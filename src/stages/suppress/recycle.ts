/**
 * Prior contact (D35 item 2). Do not load anyone this client *sent to*
 * in the last N days (default 90). Past that window, with no DNC or
 * wrong-person response, they are fair game.
 *
 * Positive replies are global and expire 90 days after the reply (D37).
 * DNC and wrong person stay blocked forever in the reason CASE.
 *
 * Never put someone in two live campaigns of the same client at once
 * (D36 item 2 addition). `exclude_other_live_campaigns` defaults true.
 */

export const DEFAULT_RECYCLE_DAYS = 90;

export function recycleDays(recipeDays: number | null | undefined): number {
  return recipeDays && recipeDays > 0 ? recipeDays : DEFAULT_RECYCLE_DAYS;
}

/**
 * Global positive-reply suppress (D37). Campaignintelligence positives
 * block every client for `recycle_after_days` (default 90) after the
 * reply. A send flagged `positive_reply` or tagged with an interested
 * category, or a lead still carrying that category, counts. Undated
 * current positives stay blocked (sync gap) so we do not re-email
 * someone still marked Interested.
 */
export function positiveReplySql(daysParam: string): string {
  const inWindow = `s.replied_at is not null and s.replied_at >= now() - (${daysParam}::int * interval '1 day')`;
  const positiveSend = `(s.positive_reply or s.lead_category_id = any($2::int[]))`;
  return `exists (
    select 1 from public.leads l
    where lower(l.email) = r.e
      and (
        exists (
          select 1 from public.sends s
          where s.lead_id = l.id and ${positiveSend} and ${inWindow}
        )
        or (
          l.category_id = any($2::int[])
          and exists (
            select 1 from public.sends s
            where s.lead_id = l.id and ${inWindow}
          )
        )
        or (
          l.category_id = any($2::int[])
          and not exists (
            select 1 from public.sends s
            where s.lead_id = l.id and s.replied_at is not null
          )
        )
      )
  )`;
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
