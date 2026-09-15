import { CAMPAIGN_SETTING_CHECKS } from "../../recipes/schema.js";

/**
 * Step 12 settings findings (skill smartlead-campaign-settings §5, §6, §4):
 * plain text on, tracking off, stop on reply, bounce autopause off (the
 * string "100"), schedule Monday to Thursday. Read from `get_campaign` as the
 * server returns it; a key the response does not carry is "unknown", never
 * a guess. Findings only — the merge tag check is the gate; the deliverability
 * wizard converges settings after the fact.
 */
export type Verdict = "pass" | "fail" | "unknown";

export interface Finding {
  check: (typeof CAMPAIGN_SETTING_CHECKS)[number];
  verdict: Verdict;
  detail: string;
}

export function settingsFindings(c: Record<string, unknown>): Finding[] {
  const out: Finding[] = [];

  const plain = c.send_as_plain_text;
  out.push(plain === undefined ? unknown("send_as_plain_text") : { check: "send_as_plain_text", verdict: plain === true ? "pass" : "fail", detail: `send_as_plain_text=${String(plain)}` });

  const track = c.track_settings;
  if (track === undefined) out.push(unknown("tracking_off"));
  else {
    const list = Array.isArray(track) ? track.map(String) : typeof track === "string" ? track.split(",").map((s) => s.trim()) : [];
    const off = list.includes("DONT_TRACK_EMAIL_OPEN") && list.includes("DONT_TRACK_LINK_CLICK");
    out.push({ check: "tracking_off", verdict: off ? "pass" : "fail", detail: `track_settings=${list.join(",") || String(track)}` });
  }

  const stop = c.stop_lead_settings;
  out.push(stop === undefined ? unknown("stop_on_reply") : { check: "stop_on_reply", verdict: stop === "REPLY_TO_AN_EMAIL" ? "pass" : "fail", detail: `stop_lead_settings=${String(stop)}` });

  const bounce = c.bounce_autopause_threshold ?? (c.ai_bounce_settings as Record<string, unknown> | undefined)?.bounce_autopause_threshold;
  out.push(bounce === undefined ? unknown("bounce_autopause_off") : { check: "bounce_autopause_off", verdict: String(bounce) === "100" ? "pass" : "fail", detail: `bounce_autopause_threshold=${JSON.stringify(bounce)}` });

  const days = scheduleDays(c);
  if (days === null) out.push(unknown("schedule_mon_thu"));
  else {
    const sorted = [...days].sort((a, b) => a - b);
    const ok = sorted.length > 0 && sorted.every((d) => d >= 1 && d <= 4);
    out.push({ check: "schedule_mon_thu", verdict: ok ? "pass" : "fail", detail: `days_of_the_week=[${sorted.join(",")}]` });
  }
  return out;
}

/** days_of_the_week from the campaign, or from scheduler_cron_value (JSON string or object). */
export function scheduleDays(c: Record<string, unknown>): number[] | null {
  const direct = c.days_of_the_week;
  if (Array.isArray(direct)) return direct.map(Number).filter(Number.isInteger);
  let cron = c.scheduler_cron_value;
  if (typeof cron === "string") {
    try {
      cron = JSON.parse(cron);
    } catch {
      return null;
    }
  }
  if (cron && typeof cron === "object") {
    const d = (cron as Record<string, unknown>).days_of_the_week;
    if (Array.isArray(d)) return d.map(Number).filter(Number.isInteger);
  }
  return null;
}

function unknown(check: Finding["check"]): Finding {
  return { check, verdict: "unknown", detail: "not in the get_campaign response" };
}
