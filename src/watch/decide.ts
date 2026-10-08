import type { CampaignHealth } from "../ledger/health.js";
import type { ClientRunway } from "../ledger/client_runway.js";
import type { CampaignVerdict } from "../policy/index.js";
import type { RunStatus } from "../domain/runs.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";

export { recipeCampaignIds };

/**
 * The watch (D27, D38, D45, D46): each ACTIVE campaign is judged on its own
 * runway so a dry campaign does not stop sending while a sibling still has
 * leads. Client-wide days stay on the board. A campaign under its floor that
 * the policy passes is filled. A campaign the policy refuses (under the
 * reply bar, paused, dropped, retired, excluded) is named with its reason
 * and never started, not even with a card: the report says why, and Josh's
 * /working override is the only way past the bar. `/topup` is the override
 * for everything else.
 */

/** Per-campaign flag. Empty or low is the refill signal for that campaign. */
export function isNeedy(h: CampaignHealth): boolean {
  return h.flags.includes("low") || h.flags.includes("empty");
}

/**
 * #campaign-watchdog "nearly done (90%, N left)" — remaining new leads
 * are 10% or less of the list. Visibility for the queue (D44), not a
 * new Josh-named floor and not the auto-start signal.
 */
export const WATCHDOG_NEARLY_DONE_REMAINING_SHARE = 0.1;

export type WatchdogLeadFlag = "empty" | "low" | "nearly_done";

/** Same lead-refill lines the watchdog channel posts. Not senders, not silent. */
export function watchdogLeadFlag(h: CampaignHealth): WatchdogLeadFlag | null {
  if (h.status !== "ACTIVE") return null;
  if (h.flags.includes("empty") || h.untouched === 0) return "empty";
  if (h.flags.includes("low")) return "low";
  if (h.leads_total > 0 && h.untouched / h.leads_total <= WATCHDOG_NEARLY_DONE_REMAINING_SHARE) return "nearly_done";
  return null;
}

export function isWatchdogLeadNeed(h: CampaignHealth): boolean {
  return watchdogLeadFlag(h) !== null;
}

export interface NeedyCampaign {
  health: CampaignHealth;
  /** The policy layer's verdict on this campaign (D46). */
  verdict: CampaignVerdict;
}

export type WatchDecision =
  | { kind: "skip"; why: string; refused?: Array<{ campaign_id: number; gate: string; reason: string }> }
  | { kind: "go"; why: string; campaigns: number[]; proposeMock: boolean; refused: Array<{ campaign_id: number; gate: string; reason: string }> };

export function watchDecision(input: {
  needy: NeedyCampaign[];
  openRun: boolean;
  lastStatus: RunStatus | null;
  /** D38 primary signal. When omitted, fall back is refuse: do not start on one-camp empty. */
  client?: ClientRunway | null;
  /** Campaigns this lane owns. A refill only targets ids in this list when it is set. */
  recipeCampaignIds?: number[];
  /** Verdicts for the recipe's ACTIVE campaigns (not only the dry ones). */
  camps?: NeedyCampaign[];
}): WatchDecision {
  if (input.openRun) return { kind: "skip", why: "a run is already open for this lane" };
  if (input.lastStatus === "aborted") {
    return { kind: "skip", why: "the last run on this lane was aborted; /topup starts it again" };
  }

  const client = input.client ?? null;
  const pool = input.camps ?? input.needy;
  const needy = input.needy.length > 0 ? input.needy : pool.filter((n) => isNeedy(n.health));
  const passing = needy.filter((n) => n.verdict.qualifies);
  const refused = needy
    .filter((n) => !n.verdict.qualifies)
    .map((n) => ({ campaign_id: n.health.smartlead_campaign_id, gate: n.verdict.gate, reason: n.verdict.reason }));

  if (passing.length > 0) {
    const owned = new Set(input.recipeCampaignIds ?? []);
    const campaigns = passing.map((n) => n.health.smartlead_campaign_id).filter((id) => owned.size === 0 || owned.has(id));
    if (campaigns.length === 0) return { kind: "skip", why: "the dry campaigns are not on this lane's recipe", refused };
    return {
      kind: "go",
      why: fillWhy(passing.filter((n) => campaigns.includes(n.health.smartlead_campaign_id)), client, refused),
      campaigns,
      proposeMock: Boolean(client?.propose_holistic_mock),
      refused,
    };
  }

  if (refused.length > 0) {
    return {
      kind: "skip",
      why: `${refused.map((r) => `#${r.campaign_id} needs leads but ${r.gate}: ${r.reason}`).join("; ")}. Nothing starts on its own; /working on is Josh's override for the bar.`,
      refused,
    };
  }

  if (pool.length === 0 && input.needy.length === 0) return { kind: "skip", why: "no campaign is low or empty" };
  return { kind: "skip", why: coveredWhy(pool, client) };
}

function campaignLine(n: NeedyCampaign): string {
  const h = n.health;
  const days = h.runway_days === null ? "days n/a" : `${h.runway_days}d`;
  const flag = h.flags.filter((f) => f === "empty" || f === "low").join("/") || "covered";
  return `#${h.smartlead_campaign_id} ${flag} · ${days} · ${h.untouched} untouched`;
}

/** Name the campaigns being filled and the ones refused. Healthy siblings are not in the list. */
function fillWhy(passing: NeedyCampaign[], client: ClientRunway | null, refused: Array<{ campaign_id: number; gate: string }>): string {
  const lists = passing.map(campaignLine).join("; ");
  const context = client ? ` Client-wide ${client.email_days === null ? "days n/a" : `${client.email_days}d`}, rem ${client.email_rem}.` : "";
  const left = refused.length ? ` Not started: ${refused.map((r) => `#${r.campaign_id} (${r.gate})`).join(", ")}.` : "";
  return `${lists}. Filling these campaigns so their sends do not stop.${context}${left}`;
}

/** Every campaign on the lane still has runway. Say so per campaign. */
function coveredWhy(pool: NeedyCampaign[], client: ClientRunway | null): string {
  if (pool.length === 0) {
    return client
      ? `client-wide runway is not under the floor (${client.email_days === null ? "days n/a" : `${client.email_days}d`}, rem ${client.email_rem}). No campaign was listed.`
      : "no campaign is low or empty";
  }
  const lists = pool.map(campaignLine).join("; ");
  return `${lists}. No campaign is under its own floor, so this lane does not need a refill.`;
}

export function runwayKey(h: { flags: readonly string[]; runway_days: number | null }): number {
  if (h.flags.includes("empty")) return 0;
  return h.runway_days ?? Number.POSITIVE_INFINITY;
}
