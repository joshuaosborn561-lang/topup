/**
 * D40 — look at the client first. Top up campaigns that are working.
 * One pull per shared ICP; segment into those campaigns.
 */

export type ScoredCampaign = {
  client_tag: string;
  lane: string;
  campaign_id: number;
  pull_key: string;
  working: boolean;
  needy: boolean;
};

export type PullGroup = {
  key: string;
  client_tag: string;
  lanes: string[];
  primaryLane: string;
  winnerIds: number[];
  needyWinnerIds: number[];
  askIds: number[];
};

export function primaryLane(lanes: string[]): string {
  const unique = [...new Set(lanes)].sort((a, b) => {
    const score = (s: string) => (/airpods/i.test(s) ? 1 : 0);
    return score(a) - score(b) || a.localeCompare(b);
  });
  return unique[0] ?? lanes[0] ?? "";
}

/** Working campaigns are the ones to top up. Dead / avoid stay out of the pull. */
export function winningCampaigns(rows: readonly ScoredCampaign[]): ScoredCampaign[] {
  return rows.filter((r) => r.working);
}

/**
 * Client-wide groups. Tickets + AirPods share a key (same persona, no industry
 * split). Goliath education vs finserv do not (different industries).
 */
export function pullGroups(rows: readonly ScoredCampaign[]): PullGroup[] {
  const byKey = new Map<string, ScoredCampaign[]>();
  for (const row of rows) {
    const list = byKey.get(row.pull_key) ?? [];
    list.push(row);
    byKey.set(row.pull_key, list);
  }
  return [...byKey.entries()].map(([key, group]) => {
    const winners = winningCampaigns(group);
    const needyWinners = winners.filter((w) => w.needy);
    const primaryPool = (needyWinners.length ? needyWinners : winners).map((w) => w.lane);
    return {
      key,
      client_tag: group[0]!.client_tag,
      lanes: [...new Set(group.map((g) => g.lane))].sort(),
      primaryLane: primaryLane(primaryPool.length ? primaryPool : group.map((g) => g.lane)),
      winnerIds: [...new Set(winners.map((w) => w.campaign_id))].sort((a, b) => a - b),
      needyWinnerIds: [...new Set(needyWinners.map((w) => w.campaign_id))].sort((a, b) => a - b),
      askIds: [...new Set(group.filter((g) => g.needy && !g.working).map((g) => g.campaign_id))].sort((a, b) => a - b),
    };
  });
}

export type ClientWatchDecision =
  | { kind: "skip"; why: string }
  | { kind: "go"; why: string; lane: string; campaigns: number[]; siblingLanes: string[] }
  | { kind: "ask"; why: string; campaignId: number; lane: string };

/** One go per pull that has a needy winner. Ask about a dead needy campaign only when that pull has no winner. */
export function clientWatchDecision(input: {
  group: PullGroup;
  openRun: boolean;
  lastStatus?: string | null;
}): ClientWatchDecision {
  if (input.openRun) return { kind: "skip", why: "a run is already open for this pull" };
  if (input.group.needyWinnerIds.length > 0 && input.group.winnerIds.length > 0) {
    return {
      kind: "go",
      why: `client-wide: top up ${input.group.needyWinnerIds.length} working campaign(s); segment into ${input.group.winnerIds.length}`,
      lane: input.group.primaryLane,
      campaigns: input.group.winnerIds,
      siblingLanes: input.group.lanes,
    };
  }
  if (input.group.askIds.length === 0) {
    return { kind: "skip", why: "no working campaign in this pull is low or empty" };
  }
  if (input.lastStatus === "not_working") {
    return { kind: "skip", why: "Josh left this pull; it is still not working." };
  }
  return {
    kind: "ask",
    why: `${input.group.askIds.length} low campaign(s) in this pull are not working`,
    campaignId: input.group.askIds[0]!,
    lane: input.group.primaryLane,
  };
}
