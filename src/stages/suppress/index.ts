import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { INTERESTED_CATEGORY_IDS } from "../../domain/working.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { Recipe } from "../../recipes/schema.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";
import {
  clientPriorContactSql,
  excludedCampaignsSql,
  excludedGenericInboxesSql,
  excludedInboxesSql,
  excludedPodsSql,
  expiredEligibleSql,
  hardBounceSql,
  positiveReplySql,
  publicSuppressionSql,
  recycleDays,
  SUPPRESS_RECYCLE_MONTHS,
  thisClientLead,
} from "./recycle.js";

/**
 * Step 5 — Suppress (D63). Per client only; applied at pull time, no cron.
 *
 *   positive_reply        this client's Interested / Meeting Request /
 *                         Positive Reply, inside 6 months
 *   do_not_contact        this client's current DNC category
 *   wrong_person          this client's current Wrong Person category
 *   suppression_list      public.suppression if permanent or first_seen
 *                         inside 6 months (older unsubscribes expire)
 *   bounced               this client's hard bounce, forever
 *   client_prior_contact  this client sent in the last 6 months, or the
 *                         address is in a live campaign of this client
 *   client_domain         this client's own customer domain list
 *
 * A block for another client never applies. After 6 months the person is
 * eligible again for this client; excluded_inboxes stay on the row, plus
 * the named-seat POD (A/B) and any generic seats. Route keys on the
 * other POD for named seats; generic seats hold. same_offer_other_client
 * is not applied (D63). Empty customer list does not halt. Never writes
 * dl_status, sg_exclude, or skip_*.
 */
export interface SuppressDeps extends StageDeps {
  ledger?: LaneLedger;
}

export const DNC_CATEGORY_ID = 4;
export const WRONG_PERSON_CATEGORY_ID = 7;
export const BOUNCE_CATEGORY_ID = 9;

export const SUPPRESS_REASONS = ["positive_reply", "do_not_contact", "wrong_person", "suppression_list", "bounced", "client_prior_contact", "same_offer_other_client", "client_domain"] as const;

interface Tables {
  leads: boolean;
  sends: boolean;
  suppression: boolean;
  campaigns: boolean;
  staging: boolean;
}

export class SuppressStage {
  constructor(private readonly d: SuppressDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "suppress", "suppressing", async () => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const domainCount = await this.domainListCount(run.client_tag);
      const days = recycleDays(recipe.suppression.recycle_after_days);

      const t = await this.tables();
      const clientCampaigns = await this.clientCampaignIds(recipe, t);
      const offerKeys = await this.offerKeys(recipe, t);
      const { rows: rawRows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'ingested'`, [run.run_id]);
      const raw = Number(rawRows[0]?.n ?? 0);

      const headcountDropped = 0;
      const removed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const reasonSql = this.reasonCase(recipe, t, domainCount > 0);
        const bind = [run.run_id, INTERESTED_CATEGORY_IDS, DNC_CATEGORY_ID, WRONG_PERSON_CATEGORY_ID, BOUNCE_CATEGORY_ID, recipe.smartlead_client_id, clientCampaigns, offerKeys, run.client_tag, days, [] as string[]];
        const { rows } = await tx.query<{ reason: string; n: string }>(
          `with p as (
             select $2::int[] as positive, $3::int as dnc, $4::int as wrong_person, $5::int as bounce,
                    $6::bigint as smartlead_client_id, $7::bigint[] as client_campaigns, $8::text[] as offer_keys, $9::text as client_tag,
                    $10::int as recycle_after_days
           ),
           r as (
             select id, lower(email) as e, split_part(lower(email), '@', 2) as d
             from ${table} where run_id = $1 and lead_status = 'ingested' and coalesce(email, '') <> ''
           ),
           judged as (select r.id, (${reasonSql}) as reason from r, p),
           hit as (
             update ${table} t set lead_status = 'suppressed', status_changed_at = now(),
               qa_flags = coalesce(t.qa_flags, '{}'::jsonb) || jsonb_build_object('suppressed_reason', j.reason)
             from judged j where t.id = j.id and j.reason is not null
             returning j.reason
           )
           select reason, count(*)::text as n from hit group by reason`,
          bind,
        );
        const byReason: Record<string, number> = Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0]));
        for (const r of rows) byReason[r.reason] = Number(r.n);

        let expiredEligible = 0;
        if (t.leads && t.sends) {
          const expired = await tx.query(
            `with r as (
               select id, lower(email) as e
               from ${table} where run_id = $1 and lead_status = 'ingested' and coalesce(email, '') <> ''
             )
             update ${table} t
                set qa_flags = coalesce(t.qa_flags, '{}'::jsonb) || jsonb_build_object(
                  'expired_eligible', true,
                  'excluded_inboxes', ${excludedInboxesSql()},
                  'excluded_pods', ${excludedPodsSql()},
                  'excluded_generic_inboxes', ${excludedGenericInboxesSql()},
                  'excluded_campaigns', ${excludedCampaignsSql()}
                )
               from r
              where t.id = r.id and ${expiredEligibleSql()}`,
            [run.run_id, INTERESTED_CATEGORY_IDS, DNC_CATEGORY_ID, WRONG_PERSON_CATEGORY_ID, BOUNCE_CATEGORY_ID, recipe.smartlead_client_id],
          );
          expiredEligible = expired.rowCount ?? 0;
        }

        const dup = await tx.query(
          `with ranked as (
             select id, row_number() over (partition by lower(email) order by id) as rn
             from ${table} where run_id = $1 and lead_status = 'ingested' and coalesce(email, '') <> ''
           )
           update ${table} t set lead_status = 'deduped', status_changed_at = now()
           from ranked k where t.id = k.id and k.rn > 1`,
          [run.run_id],
        );
        const noEmail = await tx.query(`update ${table} set lead_status = 'needs_email', status_changed_at = now() where run_id = $1 and lead_status = 'ingested' and coalesce(email, '') = ''`, [run.run_id]);
        const survivors = await tx.query(`update ${table} set lead_status = 'needs_verify', status_changed_at = now() where run_id = $1 and lead_status = 'ingested'`, [run.run_id]);
        return { byReason, deduped: dup.rowCount ?? 0, needs_email: noEmail.rowCount ?? 0, net_new: survivors.rowCount ?? 0, expired_eligible: expiredEligible };
      });

      const suppressed = Object.values(removed.byReason).reduce((a, b) => a + b, 0);
      const counts: Record<string, number> = {
        raw,
        suppressed: suppressed + headcountDropped,
        removed_linkedin_headcount: headcountDropped,
        ...Object.fromEntries(Object.entries(removed.byReason).map(([k, v]) => [`removed_${k}`, v])),
        deduped: removed.deduped,
        needs_email: removed.needs_email,
        net_new: removed.net_new,
        expired_eligible: removed.expired_eligible,
        recycle_after_days: days,
        recycle_months: SUPPRESS_RECYCLE_MONTHS,
        client_domain_list: domainCount,
      };
      const skipped: string[] = [];
      if (!t.leads) skipped.push("response-based (no public.leads mirror here)");
      if (!t.suppression) skipped.push("public.suppression (table missing)");
      if (!t.leads || !t.sends) skipped.push("client prior contact (no public.leads/sends mirror)");
      if (recipe.suppression.client_domain_blocklist && domainCount === 0) skipped.push("client customer domain list (none on file; not required)");
      const reasons = Object.entries(removed.byReason)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      const line =
        `Suppress done: raw ${raw} · removed ${suppressed + headcountDropped}${reasons ? ` (${reasons})` : ""}${headcountDropped ? ` · linkedin headcount ${headcountDropped}` : ""} · ${removed.deduped} duplicates within the pull · ${removed.needs_email} with no address · expired-and-eligible ${removed.expired_eligible} · *net new ${removed.net_new}* — the number from here on.` +
        ` · per client only; prior contact and positives recycle after ${SUPPRESS_RECYCLE_MONTHS} months; hard bounces stay forever; named-seat PODs stay blocked; generics hold.` +
        (recipe.suppression.exclude_other_live_campaigns ? ` Live campaigns of this client still exclude.` : "") +
        (skipped.length ? ` · not applied: ${skipped.join("; ")}.` : "");
      return finish(this.d, run, "suppress", removed.net_new, counts, line);
    });
  }

  /** The CASE that names the first reason a row is removed. This client only (D63). */
  private reasonCase(recipe: Recipe, t: Tables, haveDomains: boolean): string {
    const whens: string[] = [];
    if (t.leads) {
      whens.push(`when ${positiveReplySql()} then 'positive_reply'`);
      whens.push(`when ${thisClientLead("l.category_id = $3")} then 'do_not_contact'`);
      whens.push(`when ${thisClientLead("l.category_id = $4")} then 'wrong_person'`);
    }
    if (recipe.suppression.public_suppression && t.suppression) whens.push(`when ${publicSuppressionSql()} then 'suppression_list'`);
    if (recipe.suppression.bounced_any_client && t.leads) {
      whens.push(`when ${hardBounceSql()} then 'bounced'`);
    }
    if (recipe.suppression.client_prior_contacts && t.leads && t.sends) {
      whens.push(`when ${clientPriorContactSql(recipe.suppression.exclude_other_live_campaigns && t.staging && t.campaigns)} then 'client_prior_contact'`);
    }
    if (recipe.suppression.client_domain_blocklist && haveDomains) {
      whens.push(`when exists (select 1 from topup.client_domain_blocklist b where b.client_tag = $9 and b.domain = r.d) then 'client_domain'`);
    }
    return whens.length ? `case ${whens.join(" ")} end` : "null::text";
  }

  private async tables(): Promise<Tables> {
    const { rows } = await this.d.repo.raw().query<Tables>(
      `select to_regclass('public.leads') is not null as leads, to_regclass('public.sends') is not null as sends,
              to_regclass('public.suppression') is not null as suppression, to_regclass('public.campaigns') is not null as campaigns,
              to_regclass('public.leads_staging') is not null as staging`,
    );
    return rows[0];
  }

  private async clientCampaignIds(recipe: Recipe, t: Tables): Promise<number[]> {
    const ids = new Set<number>(recipe.routing.map((r) => r.campaign_id));
    if (t.campaigns) {
      const { rows } = await this.d.repo.raw().query<{ id: string }>(`select smartlead_campaign_id::text as id from public.campaigns where smartlead_client_id = $1`, [recipe.smartlead_client_id]);
      for (const r of rows) ids.add(Number(r.id));
    }
    return [...ids];
  }

  private async offerKeys(recipe: Recipe, _t: Tables): Promise<string[]> {
    const ids = recipe.routing.map((r) => r.campaign_id);
    if (ids.length === 0) return [];
    const { rows: have } = await this.d.repo.raw().query<{ ok: boolean }>(`select to_regclass('topup.campaign_registry') is not null as ok`);
    if (!have[0]?.ok) return [];
    const { rows } = await this.d.repo.raw().query<{ offer_key: string }>(`select distinct offer_key from topup.campaign_registry where campaign_id = any($1::bigint[]) and offer_key is not null`, [ids]);
    return rows.map((r) => r.offer_key);
  }

  private async domainListCount(clientTag: string): Promise<number> {
    const { rows: have } = await this.d.repo.raw().query<{ ok: boolean }>(`select to_regclass('topup.client_domain_blocklist') is not null as ok`);
    if (!have[0]?.ok) return 0;
    const { rows } = await this.d.repo.raw().query<{ n: string }>(`select count(*)::text as n from topup.client_domain_blocklist where client_tag = $1`, [clientTag]);
    return Number(rows[0]?.n ?? 0);
  }
}
