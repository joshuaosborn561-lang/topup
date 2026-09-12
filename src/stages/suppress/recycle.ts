/**
 * Recycle window (D29). A person this client already emailed is not
 * suppressed forever: if the last send is older than recycle_after_days
 * (default 90) and they never replied positively / DNC / wrong person,
 * they can be emailed again.
 *
 * The emailed-per-client universe is campaignintelligence `public.leads`
 * joined to `public.sends` (`sent` and `sent_at`) scoped by
 * `smartlead_client_id`. Response-based reasons stay forever and are
 * applied first.
 */

export const DEFAULT_RECYCLE_AFTER_DAYS = 90;

/** True when a send for this Smartlead client is inside the recycle window. */
export function recentClientSendSql(daysParam: string): string {
  return `exists (
    select 1 from public.leads l
    join public.sends s on s.lead_id = l.id
    where lower(l.email) = r.e
      and l.smartlead_client_id = $6
      and s.sent
      and s.sent_at is not null
      and s.sent_at >= now() - (${daysParam}::int * interval '1 day')
  )`;
}

export function recycleDays(recipeDays: number | undefined): number {
  return recipeDays && recipeDays > 0 ? recipeDays : DEFAULT_RECYCLE_AFTER_DAYS;
}
