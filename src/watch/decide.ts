import type { CampaignHealth } from "../ledger/health.js";
import type { WorkingVerdict } from "../domain/working.js";
import type { RunStatus } from "../domain/runs.js";
import { recipeCampaignIds } from "../recipes/campaigns.js";

export { recipeCampaignIds };

/**
 * The watch (D27): a lane tops itself up when a campaign it feeds is low
 * (or empty) and still working. Josh is asked only when the reply rate has
 * died. `/topup` is the override, not the normal start.
 */

/** A campaign needs more leads: ACTIVE and either empty or under the floor. Silent is not needy — it already has leads it is not sending. */
export function isNeedy(h: CampaignHealth): boolean {
  return h.flags.includes("low") || h.flags.includes("empty");
}

export interface NeedyCampaign {
  health: CampaignHealth;
  working: WorkingVerdict;
}

export type WatchDecision =
  | { kind: "skip"; why: string }
  | { kind: "go"; why: string; campaigns: number[] }
  | { kind: "ask"; why: string; campaignId: number };

export function watchDecision(input: {
  needy: NeedyCampaign[];
  openRun: boolean;
  lastStatus: RunStatus | null;
}): WatchDecision {
  if (input.openRun) return { kind: "skip", why: "a run is already open for this lane" };
  if (input.needy.length === 0) return { kind: "skip", why: "no campaign is low or empty" };

  const working = input.needy.filter((n) => n.working.working);
  const dead = input.needy.filter((n) => !n.working.working);

  if (working.length > 0) {
    return {
      kind: "go",
      why: working
        .map((n) => `#${n.health.smartlead_campaign_id} ${n.health.flags.join("/")} · ${n.working.reason}`)
        .join("; "),
      campaigns: working.map((n) => n.health.smartlead_campaign_id),
    };
  }

  // Josh already said leave it, and nothing has started working since.
  if (input.lastStatus === "not_working") {
    return { kind: "skip", why: "Josh left this lane; it is still not working. /working on or a recovered rate will start it again." };
  }

  const ask = pickAsk(dead);
  return {
    kind: "ask",
    why: `${dead.length} low campaign(s) are not working; asking about #${ask.health.smartlead_campaign_id}: ${ask.working.reason}`,
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
