/**
 * D81 suppress set: this client's unsubscribes, the existing DNC list
 * (`public.suppression`), and hard bounces (kept pending Josh).
 * Not-interested is not suppressed. Smartlead category Do Not Contact
 * is not a class. No expiry. Never unsuppress in Smartlead.
 */

/** This client's classified unsubscribes (and Smartlead status unsubscribed). Permanent (D81). */
export function thisClientUnsubscribeSql(hasClass: boolean): string {
  const cls = hasClass ? `l.negative_class = 'unsubscribe' or ` : "";
  return `exists (select 1 from public.leads l where lower(l.email) = r.e and l.smartlead_client_id = $6 and (${cls}lower(coalesce(l.status, '')) = 'unsubscribed'))`;
}

/** Existing DNC list. Not Smartlead category 4 (D81). */
export function dncListSql(): string {
  return `exists (select 1 from public.suppression s where lower(s.email) = r.e)`;
}

/** Hard bounces stay blocked pending Josh (D81). */
export function hardBounceSql(hasSends: boolean): string {
  const send = hasSends
    ? `exists (select 1 from public.leads l join public.sends s on s.lead_id = l.id where lower(l.email) = r.e and s.bounced)`
    : "false";
  return `(exists (select 1 from public.leads l where lower(l.email) = r.e and l.category_id = $5) or ${send})`;
}
