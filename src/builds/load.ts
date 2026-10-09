import type { Queryable } from "../db/pool.js";
import { INTERESTED_CATEGORY_IDS } from "../domain/working.js";
import { ratePer2000 } from "../policy/rules.js";

/** Lifetime sends and positive replies per campaign, from the Smartlead mirror. The reply bar is measured on this. */
export interface CampaignPerformance {
  campaign_id: number;
  sends: number;
  positives: number;
  per_2000: number;
}

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
