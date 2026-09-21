/**
 * Client-wide email runway (D38). Board and top-up start key on the client's
 * rem and capacity, not one campaign going dry.
 *
 * Email days = rem across ACTIVE campaigns ÷ (unique inboxes × MESSAGE_PER_DAY).
 * LinkedIn days = rem ÷ 40. Unique inboxes and MESSAGE_PER_DAY are inputs —
 * this service does not invent them. When they are missing, days are null and
 * the watch treats "siblings still hold rem" as healthy (do not auto-start a
 * one-camp SEG refill).
 */

export const LI_SENDS_PER_DAY = 40;
export const CLIENT_FLOOR_DAYS = 7;
export const CLIENT_MOCK_DAYS = 2;
export const SALESGLIDER_CLIENT_TAG = "salesglider";

export interface ClientCampaignRem {
  status: string | null;
  untouched: number;
}

export interface ClientRunway {
  client_tag: string;
  email_rem: number;
  li_rem: number;
  active_campaigns: number;
  unique_inboxes: number | null;
  message_per_day: number | null;
  email_capacity_per_day: number | null;
  email_days: number | null;
  li_days: number | null;
  floor_days: number;
  /** Primary needy signal: client email days under the floor, or rem exhausted when days cannot be computed. */
  under_floor: boolean;
  /** ACTIVE campaigns still hold rem — a thin SEG sibling is not the start signal. */
  sibling_rem: boolean;
  /** Under-2 email days, non-SalesGlider. SalesGlider is excluded unless Josh asks. */
  propose_holistic_mock: boolean;
  days_note: string | null;
}

export function emailDaysLeft(rem: number, uniqueInboxes: number, messagePerDay: number): number | null {
  const cap = uniqueInboxes * messagePerDay;
  if (cap <= 0) return null;
  return Math.round((rem / cap) * 10) / 10;
}

export function linkedinDaysLeft(rem: number): number {
  return Math.round((rem / LI_SENDS_PER_DAY) * 10) / 10;
}

export function isSalesGlider(clientTag: string): boolean {
  return clientTag === SALESGLIDER_CLIENT_TAG;
}

/** Under-2 auto mock is for everyone except SalesGlider. */
export function shouldProposeHolisticMock(clientTag: string, emailDays: number | null): boolean {
  if (emailDays === null) return false;
  if (isSalesGlider(clientTag)) return false;
  return emailDays < CLIENT_MOCK_DAYS;
}

export function assessClientRunway(input: {
  clientTag: string;
  campaigns: readonly ClientCampaignRem[];
  uniqueInboxes?: number | null;
  messagePerDay?: number | null;
  liRem?: number;
  floorDays?: number;
}): ClientRunway {
  const active = input.campaigns.filter((c) => c.status === "ACTIVE");
  const emailRem = active.reduce((n, c) => n + c.untouched, 0);
  const uniqueInboxes = input.uniqueInboxes ?? null;
  const messagePerDay = input.messagePerDay ?? null;
  const cap =
    uniqueInboxes !== null && messagePerDay !== null && uniqueInboxes > 0 && messagePerDay > 0
      ? uniqueInboxes * messagePerDay
      : null;
  const emailDays = cap !== null ? emailDaysLeft(emailRem, uniqueInboxes, messagePerDay) : null;
  const liRem = input.liRem ?? 0;
  const liDays = input.liRem === undefined ? null : linkedinDaysLeft(liRem);
  const floorDays = input.floorDays ?? CLIENT_FLOOR_DAYS;
  const siblingRem = emailRem > 0;
  const underFloor = emailDays !== null ? emailDays < floorDays : active.length > 0 && emailRem === 0;
  const daysNote =
    emailDays !== null
      ? null
      : "email days need unique inboxes × MESSAGE_PER_DAY — not in this service yet. Ask Josh; do not invent a column.";

  return {
    client_tag: input.clientTag,
    email_rem: emailRem,
    li_rem: liRem,
    active_campaigns: active.length,
    unique_inboxes: uniqueInboxes,
    message_per_day: messagePerDay,
    email_capacity_per_day: cap,
    email_days: emailDays,
    li_days: liDays,
    floor_days: floorDays,
    under_floor: underFloor,
    sibling_rem: siblingRem,
    propose_holistic_mock: shouldProposeHolisticMock(input.clientTag, emailDays),
    days_note: daysNote,
  };
}

export function clientRunwayLine(r: ClientRunway): string {
  const days =
    r.email_days === null ? "days n/a (inboxes × MESSAGE_PER_DAY not wired)" : `${r.email_days}d email`;
  const li = r.li_days === null ? "" : ` · ${r.li_days}d LI`;
  const flag = r.under_floor ? " *under floor*" : "";
  const mock = r.propose_holistic_mock ? " · propose holistic DM mock" : "";
  return `Client runway: rem ${r.email_rem} across ${r.active_campaigns} ACTIVE · ${days}${li} · floor ${r.floor_days}d${flag}${mock}`;
}
