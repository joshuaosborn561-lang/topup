import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { INTERESTED_CATEGORY_IDS } from "../../domain/working.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { Recipe } from "../../recipes/schema.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";
import { clientDomainListCard } from "../../slack/cards.js";
import { clientPriorContactSql, recycleDays } from "./recycle.js";

/**
 * Step 5 — Suppress and dedupe (skill lead-list-build; skill global-suppression; D29).
 *
 * One SQL pass, response based only. In priority order a row is removed for
 * the first reason that applies:
 *
 *   positive_reply        replied Interested / Meeting Request / Positive Reply to any client
 *   do_not_contact        category Do Not Contact, any client
 *   wrong_person          category Wrong Person, any client
 *   suppression_list      on public.suppression
 *   bounced               a bounced send or a Sender Originated Bounce, any client
 *   client_prior_contact  email in public.leads for this smartlead_client_id
 *                         or in leads_staging for any campaign of this client
 *                         (sent or not). Recycle is opt-in and only lifts
 *                         STOPPED/COMPLETED campaigns older than the window.
 *   same_offer_other_client  received the same offer (registry offer_key) from another client
 *   client_domain         the client's own customer domain list
 *
 * Never against all of public.leads (every client). This client's leads are
 * in-campaign duplicates, not "someone else emailed them."
 * Empty customer list: halt with a Cayden card unless confirmed_empty (D34).
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
      if (recipe.suppression.same_offer_any_client && offerKeys.length === 0) {
        return gateUnmet(
          "suppress",
          "same_offer_any_client is on and topup.campaign_registry has no offer_key for this lane's campaigns. Seed the registry; do not skip.",
          { raw: 0, offer_keys: 0 },
        );
      }
      if (recipe.suppression.client_domain_blocklist && domainCount === 0) {
        const confirmed = await this.d.repo.clientDomainListConfirmedEmpty(run.client_tag);
        if (!confirmed) {
          const open = await this.d.repo.openCardsForRun(run.run_id);
          const card = open.find((c) => c.kind === "client_domain_list");
          if (!card) {
            await this.d.console.ask({
              run,
              kind: "client_domain_list",
              audience: "operator",
              payload: { step: "suppress", client_tag: run.client_tag },
              text: `Step 5: no customer list on file for ${run.client_tag}`,
              blocks: (cardId) => clientDomainListCard({ cardId, runId: run.run_id, clientTag: run.client_tag, lane: run.lane }),
            });
            await this.d.ledger?.block(run.client_tag, run.lane, "operator", `no customer list on file for ${run.client_tag}; Cayden uploads or Josh confirms none`, run.run_id);
          }
          return { kind: "waiting", on: "operator", why: `no customer list on file for ${run.client_tag}` };
        }
      }
      const { rows: rawRows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'ingested'`, [run.run_id]);
      const raw = Number(rawRows[0]?.n ?? 0);

      const removed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const reasonSql = this.reasonCase(recipe, t, offerKeys.length > 0, domainCount > 0);
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
          [run.run_id, INTERESTED_CATEGORY_IDS, DNC_CATEGORY_ID, WRONG_PERSON_CATEGORY_ID, BOUNCE_CATEGORY_ID, recipe.smartlead_client_id, clientCampaigns, offerKeys, run.client_tag, days],
        );
        const byReason: Record<string, number> = Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0]));
        for (const r of rows) byReason[r.reason] = Number(r.n);

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
        return { byReason, deduped: dup.rowCount ?? 0, needs_email: noEmail.rowCount ?? 0, net_new: survivors.rowCount ?? 0 };
      });

      const suppressed = Object.values(removed.byReason).reduce((a, b) => a + b, 0);
      const counts: Record<string, number> = {
        raw,
        suppressed,
        ...Object.fromEntries(Object.entries(removed.byReason).map(([k, v]) => [`removed_${k}`, v])),
        deduped: removed.deduped,
        needs_email: removed.needs_email,
        net_new: removed.net_new,
        recycle_after_days: days ?? 0,
        client_domain_list: domainCount,
      };
      const skipped: string[] = [];
      if (!t.leads) skipped.push("response-based (no public.leads mirror here)");
      if (!t.suppression) skipped.push("public.suppression (table missing)");
      if (!t.leads && !t.staging) skipped.push("client prior contact (no public.leads or leads_staging)");
      if (recipe.suppression.client_domain_blocklist && domainCount === 0) skipped.push("client customer domain list (confirmed empty)");
      const reasons = Object.entries(removed.byReason)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      const line =
        `Suppress done: raw ${raw} · removed ${suppressed}${reasons ? ` (${reasons})` : ""} · ${removed.deduped} duplicates within the pull · ${removed.needs_email} with no address · *net new ${removed.net_new}* — the number from here on.` +
        ` · prior contact is this client's leads or staging, lifetime` +
        (days ? ` (recycle ${days}d only on STOPPED/COMPLETED).` : ".") +
        (skipped.length ? ` · not applied: ${skipped.join("; ")}.` : "");
      return finish(this.d, run, "suppress", removed.net_new, counts, line);
    });
  }

  /** The CASE that names the first reason a row is removed. $2–$10 as in run(). */
  private reasonCase(recipe: Recipe, t: Tables, haveOffer: boolean, haveDomains: boolean): string {
    const whens: string[] = [];
    const inLeads = (cond: string) => `exists (select 1 from public.leads l where lower(l.email) = r.e and ${cond})`;
    if (t.leads) {
      whens.push(`when ${inLeads("l.category_id = any($2::int[])")} then 'positive_reply'`);
      whens.push(`when ${inLeads("l.category_id = $3")} then 'do_not_contact'`);
      whens.push(`when ${inLeads("l.category_id = $4")} then 'wrong_person'`);
    }
    if (recipe.suppression.public_suppression && t.suppression) whens.push(`when exists (select 1 from public.suppression s where lower(s.email) = r.e) then 'suppression_list'`);
    if (recipe.suppression.bounced_any_client && t.leads) {
      const bounce = [t.sends ? `exists (select 1 from public.leads l join public.sends s on s.lead_id = l.id where lower(l.email) = r.e and s.bounced)` : null, inLeads("l.category_id = $5")].filter(Boolean).join(" or ");
      whens.push(`when ${bounce} then 'bounced'`);
    }
    if (recipe.suppression.client_prior_contacts && (t.leads || t.staging)) {
      const recycleParam = daysForSql(recipe) && t.sends && t.campaigns ? "$10" : null;
      whens.push(`when ${clientPriorContactSql(recycleParam)} then 'client_prior_contact'`);
    }
    if (recipe.suppression.same_offer_any_client && haveOffer && t.leads && t.campaigns) {
      whens.push(
        `when exists (select 1 from public.leads l join public.campaigns c on c.id = l.campaign_id join topup.campaign_registry cr on cr.campaign_id = c.smartlead_campaign_id
                       where lower(l.email) = r.e and cr.offer_key = any($8::text[]) and cr.client_tag <> $9) then 'same_offer_other_client'`,
      );
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

function daysForSql(recipe: Recipe): number | null {
  return recycleDays(recipe.suppression.recycle_after_days);
}
