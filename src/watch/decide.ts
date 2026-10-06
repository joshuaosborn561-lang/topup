import type { CampaignHealth } from "../ledger/health.js";
import type { ClientRunway } from "../ledger/client_runway.js";
import type { WorkingVerdict } from "../domain/working.js";
import type { RunStatus } from "../domain/runs.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";

export { recipeCampaignIds };

/**
 * The watch (D27, D38, D45): each ACTIVE campaign is judged on its own
 * runway so a dry campaign does not stop sending while a sibling still
 * has leads. Client-wide days stay on the board. A campaign under its
 * floor that is still working is filled. Josh is asked only when the
 * campaigns that need leads are not working. `/topup` is the override.
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
  working: WorkingVerdict;
}

export type WatchDecision =
  | { kind: "skip"; why: string }
  | { kind: "go"; why: string; campaigns: number[]; proposeMock: boolean }
  | { kind: "ask"; why: string; campaignId: number };

export function watchDecision(input: {
  needy: NeedyCampaign[];
  openRun: boolean;
  lastStatus: RunStatus | null;
  /** D38 primary signal. When omitted, fall back is refuse: do not start on one-camp empty. */
  client?: ClientRunway | null;
  /** Campaigns this lane owns. A refill only targets ids in this list when it is set. */
  recipeCampaignIds?: number[];
  /** Working verdicts for the recipe's ACTIVE campaigns (not only the dry ones). */
  camps?: NeedyCampaign[];
}): WatchDecision {
  if (input.openRun) return { kind: "skip", why: "a run is already open for this lane" };
  if (input.lastStatus === "aborted") {
    return { kind: "skip", why: "the last run on this lane was aborted; /topup starts it again" };
  }

  const client = input.client ?? null;
  const pool = input.camps ?? input.needy;
  const needy = input.needy.length > 0 ? input.needy : pool.filter((n) => isNeedy(n.health));
  const workingNeedy = needy.filter((n) => n.working.working);
  const deadNeedy = needy.filter((n) => !n.working.working);

  if (workingNeedy.length > 0) {
    const owned = new Set(input.recipeCampaignIds ?? []);
    const campaigns = workingNeedy
      .map((n) => n.health.smartlead_campaign_id)
      .filter((id) => owned.size === 0 || owned.has(id));
    if (campaigns.length === 0) return { kind: "skip", why: "the dry campaigns are not on this lane's recipe" };
    return {
      kind: "go",
      why: fillWhy(
        workingNeedy.filter((n) => campaigns.includes(n.health.smartlead_campaign_id)),
        client,
      ),
      campaigns,
      proposeMock: Boolean(client?.propose_holistic_mock),
    };
  }

  if (input.lastStatus === "not_working") {
    return { kind: "skip", why: "Josh left this lane; it is still not working. /working on or a recovered rate will start it again." };
  }

  if (deadNeedy.length > 0) {
    const ask = pickAsk(deadNeedy);
    return {
      kind: "ask",
      why: `#${ask.health.smartlead_campaign_id} needs leads and is not working: ${ask.working.reason}`,
      campaignId: ask.health.smartlead_campaign_id,
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

/** Name the campaigns being filled. Healthy siblings are not in the list. */
function fillWhy(workingNeedy: NeedyCampaign[], client: ClientRunway | null): string {
  const lists = workingNeedy.map(campaignLine).join("; ");
  const context = client
    ? ` Client-wide ${client.email_days === null ? "days n/a" : `${client.email_days}d`}, rem ${client.email_rem}.`
    : "";
  return `${lists}. Filling these campaigns so their sends do not stop.${context}`;
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

/** Empty first, then shortest runway. */
export function pickAsk(dead: NeedyCampaign[]): NeedyCampaign {
  return [...dead].sort((a, b) => runwayKey(a.health) - runwayKey(b.health))[0];
}

export function runwayKey(h: { flags: readonly string[]; runway_days: number | null }): number {
  if (h.flags.includes("empty")) return 0;
  return h.runway_days ?? Number.POSITIVE_INFINITY;
}
