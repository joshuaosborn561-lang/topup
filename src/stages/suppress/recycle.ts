/**
 * Suppression recycle (D63). A block for one client never applies to
 * another. After 6 months a suppressed person (including unsubscribes)
 * is eligible again for the same client; the sending inboxes stay
 * blocked forever. Hard bounces stay suppressed forever. Applied only
 * inside suppress at pull time (no cron).
 *
 * public.sends has no sender-inbox column (D38: no mailbox mirror).
 * excluded_inboxes / excluded_pods / excluded_generic_inboxes are
 * stamped empty until Josh names the sender column and the named-seat
 * A/B map. Campaign mailbox sets are not the routing key.
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

/**
 * Named-seat PODs (A/B) those inboxes belong to. Empty until Josh names
 * the sender column and the per-client named-seat split.
 */
export function excludedPodsSql(): string {
  return `'[]'::jsonb`;
}

/**
 * Generic seats that emailed this person. Empty until the seat map
 * exists. A non-empty list holds the lead (cannot enforce at send).
 */
export function excludedGenericInboxesSql(): string {
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

/** Named seats are a static A/B half-split per client (Deliverability). */
export type ClientPod = "A" | "B";
export type SeatKind = "named" | "generic";

export interface ClientSeat {
  kind: SeatKind;
  /** Named seats always have a POD. Generics rotate; POD is not the key. */
  pod: ClientPod | null;
}

export interface RecycleExclusion {
  excluded_inboxes: string[];
  excluded_pods: ClientPod[];
  excluded_generic_inboxes: string[];
}

export function otherPod(pod: ClientPod): ClientPod {
  return pod === "A" ? "B" : "A";
}

export function classifySeats(inboxes: readonly string[], seats: ReadonlyMap<string, ClientSeat>): RecycleExclusion {
  const excluded_inboxes = [...new Set(inboxes.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const pods = new Set<ClientPod>();
  const generics: string[] = [];
  for (const inbox of excluded_inboxes) {
    const seat = seats.get(inbox);
    if (!seat) continue;
    if (seat.kind === "generic") generics.push(inbox);
    else if (seat.pod === "A" || seat.pod === "B") pods.add(seat.pod);
  }
  return { excluded_inboxes, excluded_pods: [...pods], excluded_generic_inboxes: generics };
}

/**
 * Route a recycled lead. Named-seat exclusion keys on the client POD
 * (campaign mailbox sets are not stable: generics rotate, campaigns
 * swap on-week/off-week PODs). A named exclusion goes to a campaign
 * whose current POD is the other half. A generic exclusion holds —
 * Smartlead cannot exclude an inbox per lead, so it cannot be
 * re-checked at send. Unclassified inboxes also hold.
 */
export function recycleRouteOk(excl: RecycleExclusion, campaignPod: ClientPod | null): boolean {
  const pods = excl.excluded_pods;
  const generics = excl.excluded_generic_inboxes;
  const inboxes = excl.excluded_inboxes;
  if (pods.length === 0 && generics.length === 0 && inboxes.length === 0) return true;
  if (generics.length > 0) return false;
  if (inboxes.length > 0 && pods.length === 0) return false;
  if (pods.length === 0) return true;
  if (campaignPod === null) return false;
  return !pods.includes(campaignPod);
}

export function recycleHoldReason(excl: RecycleExclusion, campaignPod: ClientPod | null): string | null {
  if (recycleRouteOk(excl, campaignPod)) return null;
  if (excl.excluded_generic_inboxes.length > 0) return "excluded_generic";
  if (excl.excluded_inboxes.length > 0 && excl.excluded_pods.length === 0) return "excluded_inbox";
  return "excluded_pod";
}
