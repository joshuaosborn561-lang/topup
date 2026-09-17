import type { Smartlead } from "../../clients/smartlead.js";
import type { RunRow } from "../../domain/runs.js";
import { postBackfillConfirmations } from "../../reason/confirm.js";
import type { Recipe } from "../../recipes/schema.js";
import { preLaunchBlocks } from "../../slack/cards.js";
import type { SpendRails } from "../../spend/rails.js";
import { gateUnmet } from "../../spine/gate.js";
import { STAGING_TABLE } from "../stage/index.js";
import { attempt, columnsOf, finish, type StageDeps, type StageOutcome } from "../common.js";
import { checkMergeTags, collectTags, CUSTOM_FIELDS_POSTED, mergeTagSummary, SYSTEM_FIELDS, type Coverage } from "./mergeTags.js";
import { settingsFindings } from "./settings.js";

/**
 * Step 12 — Pre launch check (skill lead-list-build; skill
 * smartlead-campaign-settings). On every campaign that received leads:
 * check_merge_tags (ported, pure) against the rows this run staged, and the
 * settings findings from get_campaign. The merge tag check is the gate: a
 * failure halts the run and posts once, because the leads are already in the
 * campaign and only Josh flips it active. Signatures, mailbox staffing and
 * placement are the deliverability wizard's; they are named as not checked.
 *
 * Gate: receipt posted — campaign, imported, runway before and after, spend
 * by vendor, holds, "ready for ACTIVE". The orchestrator posts the receipt as
 * the last event; this step leaves it the numbers.
 */
export interface PostImportDeps extends StageDeps {
  smartlead: Smartlead;
  rails: SpendRails;
}

/** Staging column → the key Smartlead sees (system field or custom field as the import job posts it). */
export const STAGING_TO_SMARTLEAD: ReadonlyArray<[string, string]> = [
  ["email", "email"],
  ["first_name", "first_name"],
  ["last_name", "last_name"],
  ["company_name", "company_name"],
  ["location", "location"],
  ["linkedin_profile", "linkedin_profile"],
  ["local_sports_team", "Local_Sports_Team"],
  ["vendor", "vendor"],
  ["job_title", "job_title"],
];

export class PostImportStage {
  constructor(private readonly d: PostImportDeps) {}

  async run(run: RunRow, _recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "post_import", "checking", async () => {
      const db = this.d.repo.raw();
      const importStep = await this.d.repo.getStep(run.run_id, "import");
      const { rows: campaigns } = await db.query<{ campaign: string; name: string | null; n: string }>(
        `select s.campaign_id::text as campaign, max(s.campaign_name) as name, count(*)::text as n from ${STAGING_TABLE} s where s.run_id = $1 group by 1 order by 1`,
        [run.run_id],
      );
      if (campaigns.length === 0) return { kind: "nothing" };
      const staging = await columnsOf(this.d.repo, STAGING_TABLE);
      const mapped = STAGING_TO_SMARTLEAD.filter(([col]) => staging.has(col));

      const counts: Record<string, number> = {};
      const report: Parameters<typeof preLaunchBlocks>[0]["campaigns"] = [];
      const fails: string[] = [];
      for (const c of campaigns) {
        const campaignId = Number(c.campaign);
        const imported = Number(importStep?.counts[`imported_${campaignId}`] ?? 0);
        if (imported === 0) continue; // the skill: every campaign that received leads

        const steps = await this.d.smartlead.sequences(campaignId);
        await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "post_import", vendor: "smartlead", action: "status", rows: 0, credits: null, worstCaseCents: 0, balanceBefore: null, balanceAfter: null, vendorJobId: null, approvedBy: null });
        const tags = collectTags(steps);
        const coverage = await this.coverage(run.run_id, campaignId, mapped);
        const merge = checkMergeTags(tags, coverage);
        if (!merge.ok) fails.push(`#${campaignId}: ${merge.fails.join(" ")}`);

        let settings: ReturnType<typeof settingsFindings> = [];
        try {
          settings = settingsFindings(await this.d.smartlead.campaign(campaignId));
        } catch (err) {
          settings = [{ check: "send_as_plain_text", verdict: "unknown", detail: `get_campaign failed: ${(err as Error).message.slice(0, 120)}` }];
        }
        const before = importStep?.counts[`runway_before_${campaignId}_x10`];
        const perDay = importStep?.counts[`per_day_${campaignId}_x10`];
        const runwayBefore = before === undefined ? null : Number(before) / 10;
        const runwayAfter = perDay && Number(perDay) > 0 && runwayBefore !== null ? Math.round((runwayBefore + imported / (Number(perDay) / 10)) * 10) / 10 : null;
        const ready = merge.ok && settings.every((s) => s.verdict !== "fail");
        report.push({ campaignId, name: c.name, imported, runwayBefore, runwayAfter, mergeTags: mergeTagSummary(merge), settings, ready });
        counts[`ready_${campaignId}`] = ready ? 1 : 0;
        counts[`merge_tags_${campaignId}`] = merge.tags;
        counts[`merge_fails_${campaignId}`] = merge.fails.length;
        counts[`settings_fail_${campaignId}`] = settings.filter((s) => s.verdict === "fail").length;
        counts[`settings_unknown_${campaignId}`] = settings.filter((s) => s.verdict === "unknown").length;
        if (runwayAfter !== null) counts[`runway_after_${campaignId}_x10`] = Math.round(runwayAfter * 10);
      }
      counts.campaigns_checked = report.length;
      counts.ready_for_active = report.filter((r) => r.ready).length;

      await this.d.console.postInThread(run, `Step 12 pre launch: ${counts.ready_for_active} of ${report.length} campaign(s) ready for ACTIVE`, [
        ...preLaunchBlocks({ clientTag: run.client_tag, runId: run.run_id, campaigns: report }),
        { type: "context", elements: [{ type: "mrkdwn", text: "Not checked here: mailbox signatures, pod staffing, placement test — the deliverability wizard's. Only Josh sets a campaign ACTIVE." }] },
      ]);
      await this.d.repo.mergeStepCounts(run.run_id, "post_import", counts);
      try {
        counts.receipt_confirms = await postBackfillConfirmations(this.d, run);
      } catch {
        counts.receipt_confirms = 0;
      }
      if (fails.length) {
        return gateUnmet("post_import", `merge tag check failed: ${fails.join(" | ")}. The leads are in the campaign; do not flip it active until the tag or the field is fixed.`, counts);
      }
      return finish(this.d, run, "post_import", counts.ready_for_active, counts, `Pre launch done: ${report.length} campaign(s) checked · ${counts.ready_for_active} ready for ACTIVE · merge tags resolve on every one.`);
    });
  }

  /** Coverage on the rows this run staged for the campaign, keyed as Smartlead will see them. */
  private async coverage(runId: string, campaignId: number, mapped: ReadonlyArray<[string, string]>): Promise<Coverage> {
    const selects = mapped.map(([col, key]) => `count(*) filter (where coalesce(${col}::text, '') <> '')::text as "${key}"`).join(", ");
    const { rows } = await this.d.repo.raw().query<Record<string, string>>(`select count(*)::text as total${selects ? `, ${selects}` : ""} from ${STAGING_TABLE} where run_id = $1 and campaign_id = $2`, [runId, campaignId]);
    const r = rows[0] ?? { total: "0" };
    const present: Record<string, number> = {};
    for (const [, key] of mapped) present[key] = Number(r[key] ?? 0);
    // Custom fields the job posts but staging lacks a column for are on zero leads, and must say so.
    for (const key of CUSTOM_FIELDS_POSTED) if (!(key in present)) present[key] = 0;
    for (const key of SYSTEM_FIELDS) if (!(key in present)) present[key] = 0;
    return { present, total: Number(r.total ?? 0) };
  }
}
