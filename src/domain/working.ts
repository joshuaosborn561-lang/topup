import type { Queryable } from "../db/pool.js";

/**
 * "Working" (decision D11 in DECISIONS.md): at least one interested reply per
 * 2,000 sends, counted from interested / meeting-request categories only,
 * never raw reply rate. Checked at the campaign level and per variant: if any
 * variant with at least 1,000 sends (D35 item 12) clears the bar the campaign
 * counts as working and the dead variant is named. An owner override from Slack
 * wins. The function takes `variantMinSends` so a recipe can set the floor.
 */

/** Smartlead lead categories that count as interested (design 3.3 A). */
export const INTERESTED_CATEGORY_IDS: readonly number[] = [1, 2, 131482];

export interface VariantStat {
  label: string;
  step_number: number | null;
  subject_line: string | null;
  sends: number;
  interested: number;
}

export interface WorkingInput {
  sends: number;
  interested: number;
  variants: VariantStat[];
  interestedPer2000: number;
  variantMinSends: number;
  override: boolean | null;
}

export interface WorkingVerdict {
  working: boolean;
  reason: string;
  deadVariants: string[];
  liveVariants: string[];
}

export function ratePer2000(sends: number, interested: number): number {
  return sends === 0 ? 0 : (interested / sends) * 2000;
}

export function isWorking(i: WorkingInput): WorkingVerdict {
  if (i.override !== null) {
    return { working: i.override, reason: `owner override ${i.override ? "on" : "off"}`, deadVariants: [], liveVariants: [] };
  }
  const bar = i.interestedPer2000;
  const withVolume = i.variants.filter((v) => v.sends >= i.variantMinSends);
  const live = withVolume.filter((v) => ratePer2000(v.sends, v.interested) >= bar).map((v) => v.label);
  const dead = withVolume.filter((v) => ratePer2000(v.sends, v.interested) < bar).map((v) => v.label);
  const campaignRate = ratePer2000(i.sends, i.interested);
  if (campaignRate >= bar) {
    return { working: true, reason: `${i.interested} interested in ${i.sends} sends (${campaignRate.toFixed(2)} per 2,000)`, deadVariants: dead, liveVariants: live };
  }
  if (live.length > 0) {
    return {
      working: true,
      reason: `campaign below bar (${campaignRate.toFixed(2)} per 2,000) but variant ${live.join(", ")} clears it; dead: ${dead.join(", ") || "none"}`,
      deadVariants: dead,
      liveVariants: live,
    };
  }
  if (i.sends < i.variantMinSends) {
    return { working: true, reason: `only ${i.sends} sends; too early to judge`, deadVariants: [], liveVariants: [] };
  }
  return { working: false, reason: `${i.interested} interested in ${i.sends} sends (${campaignRate.toFixed(2)} per 2,000); no variant clears the bar`, deadVariants: dead, liveVariants: live };
}

/** Sends and interested replies by variant from the hourly Supabase sync. Read-only. */
export async function variantStats(db: Queryable, smartleadCampaignId: number, sinceDays = 30): Promise<{ sends: number; interested: number; variants: VariantStat[] }> {
  const { rows } = await db.query<{ label: string | null; step_number: number | null; subject_line: string | null; sends: string; interested: string }>(
    `select coalesce(ss.variant_label, 'step ' || coalesce(s.step_number, ss.step_number)::text) as label,
            coalesce(ss.step_number, s.step_number) as step_number,
            ss.subject_line,
            count(*) filter (where s.sent) ::text as sends,
            count(*) filter (where s.sent and s.lead_category_id = any($2::int[])) ::text as interested
     from public.sends s
     join public.campaigns c on c.id = s.campaign_id
     left join public.sequence_steps ss on ss.id = s.sequence_step_id
     where c.smartlead_campaign_id = $1
       and s.sent_at >= now() - ($3 || ' days')::interval
     group by 1, 2, 3 order by 2, 1`,
    [smartleadCampaignId, INTERESTED_CATEGORY_IDS, String(sinceDays)],
  );
  const variants = rows.map((r) => ({ label: r.label ?? "unknown", step_number: r.step_number, subject_line: r.subject_line, sends: Number(r.sends), interested: Number(r.interested) }));
  return {
    sends: variants.reduce((a, v) => a + v.sends, 0),
    interested: variants.reduce((a, v) => a + v.interested, 0),
    variants,
  };
}
