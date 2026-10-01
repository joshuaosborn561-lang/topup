/**
 * Client-wide email runway (D38, D45). Board and top-up start key on the
 * client's rem and capacity, not one campaign going dry.
 *
 * Email days, in order:
 *   1. rem ÷ (unique inboxes × MESSAGE_PER_DAY) when Josh has named both
 *   2. rem ÷ (sum of 7-day sends across ACTIVE campaigns ÷ 7) — D45
 *   3. null. n/a does not pass the floor (D45). A client with ACTIVE
 *      campaigns and no rate is under_floor, not healthy.
 *
 * LinkedIn days = rem ÷ 40. Unique inboxes and MESSAGE_PER_DAY stay
 * unnamed; the send-rate fallback is what makes the gate trip.
 */

import { WINDOW_DAYS } from "./health.js";

export const LI_SENDS_PER_DAY = 40;
export const CLIENT_FLOOR_DAYS = 7;
export const CLIENT_MOCK_DAYS = 2;
export const SALESGLIDER_CLIENT_TAG = "salesglider";

export type EmailDaysFrom = "inbox" | "send_rate";

export interface ClientCampaignRem {
  status: string | null;
  untouched: number;
  /** 7-day sent count for this campaign. Used when inbox × MPD is missing (D45). */
  sends_window?: number;
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
  /** How email_days was computed. null when days are unknown. */
  email_days_from: EmailDaysFrom | null;
  li_days: number | null;
  floor_days: number;
  /** Primary needy signal: client email days under the floor, or unknown days on an ACTIVE client. */
  under_floor: boolean;
  /** ACTIVE campaigns still hold rem — a thin SEG sibling is not the start signal when days are healthy. */
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

/** rem ÷ (sends in WINDOW_DAYS ÷ WINDOW_DAYS). Null when there were no sends. */
export function emailDaysFromSendRate(rem: number, sendsWindow: number, windowDays = WINDOW_DAYS): number | null {
  if (sendsWindow <= 0 || windowDays <= 0) return null;
  const perDay = sendsWindow / windowDays;
  return Math.round((rem / perDay) * 10) / 10;
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
  const sendsWindow = active.reduce((n, c) => n + (c.sends_window ?? 0), 0);
  const uniqueInboxes = input.uniqueInboxes ?? null;
  const messagePerDay = input.messagePerDay ?? null;
  let cap: number | null = null;
  let emailDays: number | null = null;
  let emailDaysFrom: EmailDaysFrom | null = null;
  if (uniqueInboxes !== null && messagePerDay !== null && uniqueInboxes > 0 && messagePerDay > 0) {
    cap = uniqueInboxes * messagePerDay;
    emailDays = emailDaysLeft(emailRem, uniqueInboxes, messagePerDay);
    emailDaysFrom = "inbox";
  } else {
    const fromSends = emailDaysFromSendRate(emailRem, sendsWindow);
    if (fromSends !== null) {
      cap = Math.round((sendsWindow / WINDOW_DAYS) * 10) / 10;
      emailDays = fromSends;
      emailDaysFrom = "send_rate";
    }
  }
  const liRem = input.liRem ?? 0;
  const liDays = input.liRem === undefined ? null : linkedinDaysLeft(liRem);
  const floorDays = input.floorDays ?? CLIENT_FLOOR_DAYS;
  const siblingRem = emailRem > 0;
  // D45: n/a is not a pass. Unknown days on an ACTIVE client trip the floor.
  const underFloor = emailDays !== null ? emailDays < floorDays : active.length > 0;
  const daysNote =
    emailDaysFrom === "inbox"
      ? null
      : emailDaysFrom === "send_rate"
        ? "email days from rem ÷ (7-day send rate). unique inboxes × MESSAGE_PER_DAY still unnamed — do not invent them."
        : "email days unknown (no inbox capacity and no 7-day sends). n/a does not pass the floor (D45). Ask Josh.";

  return {
    client_tag: input.clientTag,
    email_rem: emailRem,
    li_rem: liRem,
    active_campaigns: active.length,
    unique_inboxes: uniqueInboxes,
    message_per_day: messagePerDay,
    email_capacity_per_day: cap,
    email_days: emailDays,
    email_days_from: emailDaysFrom,
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
    r.email_days === null
      ? "days n/a (no inbox capacity and no send rate)"
      : `${r.email_days}d email${r.email_days_from === "send_rate" ? " (send rate)" : ""}`;
  const li = r.li_days === null ? "" : ` · ${r.li_days}d LI`;
  const flag = r.under_floor ? " *under floor*" : "";
  const mock = r.propose_holistic_mock ? " · propose holistic DM mock" : "";
  return `Client runway: rem ${r.email_rem} across ${r.active_campaigns} ACTIVE · ${days}${li} · floor ${r.floor_days}d${flag}${mock}`;
}
