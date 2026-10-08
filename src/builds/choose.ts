import type { BuildRecord } from "./record.js";

/**
 * Which build earned a campaign's replies, and what repeating it means (D47).
 * Order: the build with the most interested replies that fed this campaign;
 * then the latest build that the service can repeat; then the latest build
 * at all, flagged as not repeatable. Nothing is invented for a campaign with
 * no record.
 */
export interface CampaignPerformance {
  campaign_id: number;
  sends: number;
  positives: number;
  per_2000: number;
}

export interface ChosenBuild {
  campaign_id: number;
  build: BuildRecord | null;
  /** True when the chosen build has interested replies on record. */
  earned_replies: boolean;
  repeatable: boolean;
  reason: string;
  /** Builds that fed the campaign, most interested first. */
  candidates: BuildRecord[];
}

function latestFirst(a: BuildRecord, b: BuildRecord): number {
  return String(b.written_at ?? "").localeCompare(String(a.written_at ?? ""));
}

export function rankBuilds(builds: readonly BuildRecord[]): BuildRecord[] {
  return [...builds].sort((a, b) => {
    const byInterest = (b.interested ?? -1) - (a.interested ?? -1);
    if (byInterest !== 0) return byInterest;
    return latestFirst(a, b);
  });
}

export function chooseBuildForCampaign(campaignId: number, builds: readonly BuildRecord[]): ChosenBuild {
  const candidates = rankBuilds(builds.filter((b) => b.campaigns.includes(campaignId)));
  if (candidates.length === 0) {
    return { campaign_id: campaignId, build: null, earned_replies: false, repeatable: false, reason: `#${campaignId} has no build on record; the method cannot be reconstructed. Ask Josh.`, candidates };
  }
  const earned = candidates.filter((b) => (b.interested ?? 0) > 0);
  if (earned.length) {
    const best = earned[0]!;
    return {
      campaign_id: campaignId,
      build: best,
      earned_replies: true,
      repeatable: best.repeatable.ok,
      reason: best.repeatable.ok
        ? `${best.build_label ?? best.build_id} earned ${best.interested} interested; repeating it`
        : `${best.build_label ?? best.build_id} earned ${best.interested} interested but ${best.repeatable.why}`,
      candidates,
    };
  }
  const repeatable = [...candidates].sort(latestFirst).find((b) => b.repeatable.ok) ?? null;
  if (repeatable) {
    return {
      campaign_id: campaignId,
      build: repeatable,
      earned_replies: false,
      repeatable: true,
      reason: `no build with interested replies; repeating the latest repeatable build ${repeatable.build_label ?? repeatable.build_id}`,
      candidates,
    };
  }
  const latest = [...candidates].sort(latestFirst)[0]!;
  return {
    campaign_id: campaignId,
    build: latest,
    earned_replies: false,
    repeatable: false,
    reason: `the latest build ${latest.build_label ?? latest.build_id} cannot be repeated: ${latest.repeatable.why}`,
    candidates,
  };
}
