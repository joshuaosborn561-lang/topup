import type { CampaignHealth } from "../ledger/health.js";
import type { ClientRunway } from "../ledger/client_runway.js";
import type { WorkingVerdict } from "../domain/working.js";
import type { RunStatus } from "../domain/runs.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";

export { recipeCampaignIds };

/**
 * The watch (D27, D38): a lane tops itself up when the *client* is under
 * the runway floor (or rem-exhausted when days cannot be computed) and
 * still working. One empty SEG camp is not the start signal while sibling
 * ACTIVE campaigns still hold rem. Josh is asked only when the reply rate
 * has died. `/topup` is the override, not the normal start.
 */

/** Per-campaign flag for the board. Not the watch start signal (D38). */
export function isNeedy(h: CampaignHealth): boolean {
  return h.flags.includes("low") || h.flags.includes("empty");
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
  /** Pull targets: the recipe's campaigns so the run can title-segment after a client-holistic pull. */
  recipeCampaignIds?: number[];
  /** Working verdicts for the recipe's ACTIVE campaigns (not only the dry ones). */
  camps?: NeedyCampaign[];
}): WatchDecision {
  if (input.openRun) return { kind: "skip", why: "a run is already open for this lane" };

  const client = input.client ?? null;
  if (client && !client.under_floor) {
    return {
      kind: "skip",
      why: client.sibling_rem
        ? `client-wide runway is healthy (rem ${client.email_rem} on ${client.active_campaigns} ACTIVE; ${client.email_days === null ? "days n/a" : `${client.email_days}d`} ≥ floor ${client.floor_days}). One-camp empty/low is not the start signal (D38).`
        : `client-wide runway is not under the floor (${client.email_days === null ? "days n/a" : `${client.email_days}d`}, rem ${client.email_rem}).`,
    };
  }

  if (!client && input.needy.length === 0) return { kind: "skip", why: "no campaign is low or empty" };

  const pool = input.camps ?? input.needy;
  const working = pool.filter((n) => n.working.working);
  const dead = pool.filter((n) => !n.working.working);
  const targets =
    input.recipeCampaignIds && input.recipeCampaignIds.length > 0
      ? input.recipeCampaignIds
      : working.map((n) => n.health.smartlead_campaign_id);

  if (working.length > 0) {
    return {
      kind: "go",
      why: client
        ? `client rem ${client.email_rem} · ${client.email_days === null ? "days n/a (rem exhausted)" : `${client.email_days}d`} under floor ${client.floor_days}; still working. Pull the client's DMs, then title-segment into existing campaigns (D38).`
        : working
            .map((n) => `#${n.health.smartlead_campaign_id} ${n.health.flags.join("/")} · ${n.working.reason}`)
            .join("; "),
      campaigns: targets,
      proposeMock: Boolean(client?.propose_holistic_mock),
    };
  }

  if (input.lastStatus === "not_working") {
    return { kind: "skip", why: "Josh left this lane; it is still not working. /working on or a recovered rate will start it again." };
  }

  if (dead.length === 0 && input.needy.length === 0) {
    return { kind: "skip", why: "client is under the floor but no ACTIVE campaign has a working verdict yet" };
  }

  const ask = pickAsk(dead.length ? dead : input.needy);
  return {
    kind: "ask",
    why: client
      ? `client-wide runway is low and not working; asking about #${ask.health.smartlead_campaign_id}: ${ask.working.reason}`
      : `${dead.length} low campaign(s) are not working; asking about #${ask.health.smartlead_campaign_id}: ${ask.working.reason}`,
    campaignId: ask.health.smartlead_campaign_id,
  };
}

/** Empty first, then shortest runway. */
export function pickAsk(dead: NeedyCampaign[]): NeedyCampaign {
  return [...dead].sort((a, b) => runwayKey(a.health) - runwayKey(b.health))[0];
}

export function runwayKey(h: CampaignHealth): number {
  if (h.flags.includes("empty")) return 0;
  return h.runway_days ?? Number.POSITIVE_INFINITY;
}
