import type { Queryable } from "../db/pool.js";
import { INTERESTED_CATEGORY_IDS } from "../domain/working.js";
import { ratePer2000 } from "../policy/index.js";
import { buildRecordsFromRows, strategyLine, type BuildRecord } from "./record.js";
import { chooseBuildForCampaign, type CampaignPerformance, type ChosenBuild } from "./choose.js";

/**
 * Build records and campaign performance from the database (D47). Counts
 * and method text only. The rows the builds fed never leave Postgres.
 */
export interface BuildSource {
  campaignBuilds(clientTag: string, campaignIds: number[]): Promise<Record<string, unknown>[]>;
}

export async function loadBuildRecords(repo: BuildSource, clientTag: string, campaignIds: readonly number[]): Promise<BuildRecord[]> {
  if (campaignIds.length === 0) return [];
  const rows = await repo.campaignBuilds(clientTag, [...campaignIds]).catch(() => [] as Record<string, unknown>[]);
  return buildRecordsFromRows(rows, clientTag);
}

/** Lifetime sends and interested replies per campaign, from the Smartlead mirror. The reply bar is measured on this. */
export async function campaignPerformance(db: Queryable, campaignIds: readonly number[]): Promise<Map<number, CampaignPerformance>> {
  const out = new Map<number, CampaignPerformance>();
  if (campaignIds.length === 0) return out;
  for (const id of campaignIds) out.set(id, { campaign_id: id, sends: 0, positives: 0, per_2000: 0 });
  const { rows } = await db.query<{ id: string; sends: string; positives: string }>(
    `select c.smartlead_campaign_id::text as id,
            count(*) filter (where s.sent)::text as sends,
            count(*) filter (where s.sent and s.lead_category_id = any($2::int[]))::text as positives
       from public.campaigns c
       join public.sends s on s.campaign_id = c.id
      where c.smartlead_campaign_id = any($1::bigint[])
      group by 1`,
    [campaignIds, INTERESTED_CATEGORY_IDS],
  );
  for (const r of rows) {
    const sends = Number(r.sends);
    const positives = Number(r.positives);
    out.set(Number(r.id), { campaign_id: Number(r.id), sends, positives, per_2000: Math.round(ratePer2000(sends, positives) * 100) / 100 });
  }
  return out;
}

export interface CampaignHistory {
  campaign_id: number;
  client_tag: string;
  performance: CampaignPerformance;
  chosen: ChosenBuild;
  strategy: string;
  builds: Array<Omit<BuildRecord, "method_note"> & { method_note: string | null }>;
  cannot_reconstruct: boolean;
}

/** What `campaign_history` returns: the record, the choice and the strategy. Never a lead row. */
export async function campaignHistory(deps: { db: Queryable; repo: BuildSource }, clientTag: string, campaignId: number, recipeId = "the saved recipe"): Promise<CampaignHistory> {
  const [builds, perf] = await Promise.all([loadBuildRecords(deps.repo, clientTag, [campaignId]), campaignPerformance(deps.db, [campaignId])]);
  const chosen = chooseBuildForCampaign(campaignId, builds);
  return {
    campaign_id: campaignId,
    client_tag: clientTag,
    performance: perf.get(campaignId) ?? { campaign_id: campaignId, sends: 0, positives: 0, per_2000: 0 },
    chosen,
    strategy: strategyLine(chosen.build, recipeId),
    builds: chosen.candidates,
    cannot_reconstruct: !chosen.repeatable,
  };
}
