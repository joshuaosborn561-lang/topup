import { usd } from "../spend/prices.js";
import { clientRunwayLine } from "./client_runway.js";
import type { CampaignHealth } from "./health.js";
import { audienceName, type LaneState } from "./lane.js";

/** Minutes/hours/days since an ISO timestamp, short. */
export function ago(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function counts(o: Record<string, number>): string {
  const e = Object.entries(o);
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(", ") : "none";
}

function spend(o: Record<string, number>): string {
  const e = Object.entries(o);
  return e.length ? e.map(([k, v]) => `${k} ${usd(v)}`).join(", ") : "$0.00";
}

export function campaignLine(c: CampaignHealth): string {
  const flags = c.flags.length ? ` *${c.flags.join(", ")}*` : "";
  const last = c.last_send_at ? `last send ${ago(c.last_send_at)} ago` : "never sent";
  const runway = c.runway_days === null ? "runway n/a" : `runway ${c.runway_days}d`;
  return `• ${c.smartlead_campaign_id} ${c.name ?? ""} [${c.status ?? "?"}] · ${c.untouched} untouched of ${c.leads_total} · ${c.sends_window} sends/7d · ${last} · ${c.interested_window} interested · ${c.bounces_window} bounces · ${runway}${flags}`;
}

/** The `/where` answer. Plain text, counts and ids only. */
/** "Step 6 (owner: code)" or "idle"; the step number is the state, per the skill. */
export function stepLine(s: LaneState): string {
  if (s.step === null) return "idle";
  return `${s.step_label}${s.step_owner ? ` · owner ${s.step_owner === "josh" ? "Josh" : s.step_owner === "cayden" ? "Cayden" : "code"}` : ""}`;
}

export function renderWhere(s: LaneState, now = Date.now()): string {
  const lines: string[] = [];
  const run = s.run ? ` (run \`${s.run.run_id.slice(0, 8)}\` ${s.run.status})` : "";
  lines.push(`*${s.client_tag} / ${s.lane}* — ${stepLine(s)}${run} for ${ago(s.step_since, now)}`);
  if (!s.registered) lines.push("Nothing is registered for this lane: no recipe, no state, no queues.");
  if (s.gate_unmet) lines.push(`Gate unmet: ${s.gate_unmet}`);
  if (s.next_intent) lines.push(`Next: ${s.next_intent}`);

  if (s.blocked.length) {
    lines.push("Waiting on:");
    for (const b of s.blocked) {
      lines.push(`• ${audienceName(b.on)} — ${b.what} (${ago(b.since, now)})${b.card_id ? ` card \`${b.card_id.slice(0, 8)}\`` : ""}`);
    }
  } else {
    lines.push("Waiting on: nobody.");
  }

  lines.push(`Ingested queue: ${counts(s.queues.ingested_by_status)}`);
  if (s.queues.registry.length) {
    lines.push("Registered queues:");
    for (const q of s.queues.registry) {
      const n = q.last_count === null ? "uncounted" : `${q.last_count} rows${q.last_counted_at ? ` (${ago(q.last_counted_at, now)} ago)` : ""}`;
      const miss = q.missing === "none" ? "complete rows" : `missing ${q.missing}`;
      lines.push(`• ${q.queue_name} · ${q.source_table} · ${miss}${q.next_method ? ` → ${q.next_method}` : ""} · ${n}`);
    }
  }

  lines.push(`Spend: this run ${spend(s.spend.this_run_cents_by_vendor)}; this month ${spend(s.spend.this_month_cents_by_vendor)}`);
  if (s.client_runway) lines.push(clientRunwayLine(s.client_runway));

  if (s.campaigns_error) {
    lines.push(`Campaigns: could not read the Smartlead mirror (${s.campaigns_error.slice(0, 120)}).`);
  } else if (s.campaigns.length) {
    lines.push("Campaigns:");
    for (const c of s.campaigns) lines.push(campaignLine(c));
  } else {
    lines.push("Campaigns: none known for this lane yet.");
  }

  if (s.events.length) {
    lines.push("Recent:");
    for (const e of [...s.events].reverse()) lines.push(`• ${e.at.slice(0, 16).replace("T", " ")} ${e.line}${e.next_intent ? ` → ${e.next_intent}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * What the digest compares between days. Only stage, who it is blocked on,
 * health flags and the queue shape count; timestamps and spend do not, or the
 * digest would speak every day.
 */
export function fingerprint(s: LaneState): string {
  const flags = s.campaigns.map((c) => `${c.smartlead_campaign_id}:${[...c.flags].sort().join("+")}`).sort();
  const blocked = s.blocked.map((b) => `${b.on}:${b.card_id ?? b.what}`).sort();
  const queues = Object.entries(s.queues.ingested_by_status).sort().map(([k, v]) => `${k}=${v}`);
  const client = s.client_runway
    ? { under: s.client_runway.under_floor, rem: s.client_runway.email_rem, days: s.client_runway.email_days }
    : null;
  return JSON.stringify({ step: s.step, gate: s.gate_unmet, run: s.run?.status ?? null, blocked, flags, queues, client });
}

/** One digest line per lane whose fingerprint moved. Empty when nothing did. */
export function buildDigest(states: LaneState[], previous: Record<string, string | null>, now = Date.now()): { text: string | null; fingerprints: Record<string, string> } {
  const out: string[] = [];
  const fps: Record<string, string> = {};
  let changed = 0;
  for (const s of states) {
    const key = `${s.client_tag}/${s.lane}`;
    const fp = fingerprint(s);
    fps[key] = fp;
    if (previous[key] === fp) continue;
    changed += 1;
    const crossed = s.campaigns.filter((c) => c.flags.length);
    const blockedOn = s.blocked.length ? ` · waiting on ${[...new Set(s.blocked.map((b) => audienceName(b.on)))].join(", ")}` : "";
    const gate = s.gate_unmet ? ` · gate unmet: ${s.gate_unmet}` : "";
    const client = s.client_runway?.under_floor ? " · client under-7" : "";
    out.push(`*${key}* — ${stepLine(s)} for ${ago(s.step_since, now)}${gate}${blockedOn}${client}${s.next_intent ? ` · next: ${s.next_intent}` : ""}`);
    if (s.client_runway) out.push(`    ${clientRunwayLine(s.client_runway)}`);
    for (const c of crossed) out.push(`    ${campaignLine(c)}`);
  }
  return { text: changed ? `Daily digest — ${changed} lane${changed === 1 ? "" : "s"} changed or crossed a line:\n${out.join("\n")}` : null, fingerprints: fps };
}
