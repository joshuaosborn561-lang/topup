/**
 * Suppression recycle (D63). A block for one client never applies to
 * another. After 6 months a suppressed person (including unsubscribes)
 * is eligible again for the same client; the sending inboxes stay
 * blocked forever. Hard bounces stay suppressed forever. Applied only
 * inside suppress at pull time (no cron).
 *
 * public.sends has no sender-inbox column (D38: no mailbox mirror).
 * excluded_inboxes is stamped empty until Josh names the source.
 */

export const SUPPRESS_RECYCLE_MONTHS = 6;
/** Display / recipe default. The SQL window is `interval '6 months'`. */
export const DEFAULT_RECYCLE_DAYS = 180;

export function recycleDays(recipeDays: number | null | undefined): number {
  return recipeDays && recipeDays > 0 ? recipeDays : DEFAULT_RECYCLE_DAYS;
}

export function recycleWindowSql(): string {
  return `interval '${SUPPRESS_RECYCLE_MONTHS} months'`;
}

/** This client's leads only. A block for another client does not apply (D63). */
export function thisClientLead(cond: string): string {
  return `exists (select 1 from public.leads l where lower(l.email) = r.e and l.smartlead_client_id = $6 and ${cond})`;
}

/**
 * Positive replies on this client, inside the 6-month window (D63).
 * Undated current positives on this client stay blocked (sync gap).
 */
export function positiveReplySql(): string {
  const inWindow = `s.replied_at is not null and s.replied_at >= now() - ${recycleWindowSql()}`;
  const positiveSend = `(s.positive_reply or s.lead_category_id = any($2::int[]))`;
  return `exists (
    select 1 from public.leads l
    where lower(l.email) = r.e and l.smartlead_client_id = $6
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

/** Hard bounce on this client. Forever (D63). */
export function hardBounceSql(): string {
  return `(
    exists (
      select 1 from public.leads l
      join public.sends s on s.lead_id = l.id
      where lower(l.email) = r.e and l.smartlead_client_id = $6 and s.bounced
    )
    or ${thisClientLead("l.category_id = $5")}
  )`;
}

/** Sent by this client inside the 6-month window. */
export function recentClientSendSql(): string {
  return `exists (
    select 1 from public.leads l
    join public.sends s on s.lead_id = l.id
    where lower(l.email) = r.e and l.smartlead_client_id = $6
      and s.sent and s.sent_at is not null
      and s.sent_at >= now() - ${recycleWindowSql()}
  )`;
}

/**
 * Already sitting in another live campaign of this client (D36).
 * Not a cross-client block.
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

export function clientPriorContactSql(includeLiveCampaigns: boolean): string {
  const sent = recentClientSendSql();
  if (!includeLiveCampaigns) return sent;
  return `(${sent} or ${liveCampaignSql()})`;
}

/**
 * public.suppression rows that still block: permanent, or first_seen
 * inside the 6-month window. Older non-permanent unsubscribes expire
 * (Josh accepts the unsubscribe risk, D63).
 */
export function publicSuppressionSql(): string {
  return `exists (
    select 1 from public.suppression s
     where lower(s.email) = r.e
       and (
         coalesce(s.permanent, false)
         or s.first_seen is null
         or s.first_seen >= (now() - ${recycleWindowSql()})::date
       )
  )`;
}

/**
 * Eligible again: this client suppressed them earlier, the 6-month
 * window has passed, and they are not a hard bounce. Counts only.
 */
export function expiredEligibleSql(): string {
  return `(
    exists (
      select 1 from public.leads l
      join public.sends s on s.lead_id = l.id
      where lower(l.email) = r.e and l.smartlead_client_id = $6
        and s.sent and s.sent_at is not null
        and s.sent_at < now() - ${recycleWindowSql()}
    )
    and not ${recentClientSendSql()}
    and not ${hardBounceSql()}
  )`;
}

/**
 * Inboxes that emailed this person for this client. public.sends has
 * no sender column; returns an empty jsonb array until Josh names one.
 */
export function excludedInboxesSql(): string {
  return `'[]'::jsonb`;
}

/** Smartlead campaign ids this client already sent this person from. */
export function excludedCampaignsSql(): string {
  return `coalesce((
    select jsonb_agg(distinct c.smartlead_campaign_id)
      from public.leads l
      join public.sends s on s.lead_id = l.id
      join public.campaigns c on c.id = l.campaign_id
     where lower(l.email) = r.e and l.smartlead_client_id = $6
       and s.sent
       and c.smartlead_campaign_id is not null
  ), '[]'::jsonb)`;
}

/**
 * A campaign whose mailbox set overlaps the lead's excluded inboxes is
 * refused. An unknown mailbox set is refused when the lead has exclusions
 * (cannot prove the inboxes are absent).
 */
export function campaignMailboxSetOk(excludedInboxes: readonly string[], campaignMailboxes: readonly string[]): boolean {
  const blocked = [...new Set(excludedInboxes.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (blocked.length === 0) return true;
  if (campaignMailboxes.length === 0) return false;
  const onCampaign = new Set(campaignMailboxes.map((m) => m.trim().toLowerCase()).filter(Boolean));
  return !blocked.some((inbox) => onCampaign.has(inbox));
}
