/**
 * Prior contact (D34). Anyone already in this Smartlead client's
 * `public.leads` or in `public.leads_staging` for any of this client's
 * campaigns is excluded — sent or not. Smartlead only dedupes inside one
 * campaign; an untouched lead in campaign A is still a duplicate in B.
 *
 * A 90-day recycle is opt-in (`recycle_after_days` set on the recipe) and
 * only lifts the exclude when every prior campaign is STOPPED or COMPLETED
 * and the last send is older than the window. Default is never.
 */

export function recycleDays(recipeDays: number | null | undefined): number | null {
  return recipeDays && recipeDays > 0 ? recipeDays : null;
}

/** Email already belongs to this Smartlead client in the mirror or staging. */
export function alreadyInClientSql(): string {
  return `(
    exists (
      select 1 from public.leads l
      where lower(l.email) = r.e and l.smartlead_client_id = $6
    )
    or exists (
      select 1 from public.leads_staging s
      join public.campaigns c on c.smartlead_campaign_id = s.campaign_id
      where lower(s.email) = r.e and c.smartlead_client_id = $6
    )
  )`;
}

/**
 * Opt-in recycle: every prior campaign is STOPPED/COMPLETED and the last
 * send is older than `$N` days. Otherwise they stay excluded.
 */
export function recycleExceptionSql(daysParam: string): string {
  const stopped = `upper(coalesce(c.status, '')) in ('STOPPED', 'COMPLETED')`;
  return `(
    not exists (
      select 1 from public.leads l
      join public.campaigns c on c.id = l.campaign_id
      where lower(l.email) = r.e and l.smartlead_client_id = $6
        and not (${stopped})
    )
    and not exists (
      select 1 from public.leads_staging s
      join public.campaigns c on c.smartlead_campaign_id = s.campaign_id
      where lower(s.email) = r.e and c.smartlead_client_id = $6
        and not (${stopped})
    )
    and not exists (
      select 1 from public.leads l
      join public.sends s on s.lead_id = l.id
      where lower(l.email) = r.e and l.smartlead_client_id = $6
        and s.sent and s.sent_at is not null
        and s.sent_at >= now() - (${daysParam}::int * interval '1 day')
    )
  )`;
}

export function clientPriorContactSql(recycleDaysParam: string | null): string {
  const already = alreadyInClientSql();
  if (!recycleDaysParam) return already;
  return `(${already} and not ${recycleExceptionSql(recycleDaysParam)})`;
}
