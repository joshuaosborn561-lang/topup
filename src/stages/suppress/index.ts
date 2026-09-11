import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { INTERESTED_CATEGORY_IDS } from "../../domain/working.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { Recipe } from "../../recipes/schema.js";
import { clientDomainListCard } from "../../slack/cards.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 5 — Suppress and dedupe (skill lead-list-build; skill global-suppression).
 *
 * One SQL pass, response based only. In priority order a row is removed for
 * the first reason that applies:
 *
 *   positive_reply        replied Interested / Meeting Request / Positive Reply to any client
 *   do_not_contact        category Do Not Contact, any client
 *   wrong_person          category Wrong Person, any client
 *   suppression_list      on public.suppression
 *   bounced               a bounced send or a Sender Originated Bounce, any client
 *   client_prior_contact  already in any of this client's campaigns (public.leads for
 *                         the client, or leads_staging for the client's campaigns) —
 *                         older copy wins, it has send history
 *   same_offer_other_client  received the same offer (registry offer_key) from another client
 *   client_domain         the client's own customer domain list (topup.client_domain_blocklist)
 *
 * Never against all of public.leads (that killed 87% of a good pull). Then
 * within-run dedupe by address. Gate: report raw, removed by reason, net new.
 *
 * The customer domain list "must be applied before anything loads, ask
 * Cayden for it if missing": an empty list for a client whose recipe wants
 * it is a card to Cayden and a halt, not a silent skip.
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

      // The customer domain list gate (Cayden).
      const domainList = await this.domainListReady(run, recipe);
      if (domainList.kind === "waiting") return domainList;

      const t = await this.tables();
      const clientCampaigns = await this.clientCampaignIds(recipe, t);
      const offerKeys = await this.offerKeys(recipe);
      const { rows: rawRows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'ingested'`, [run.run_id]);
      const raw = Number(rawRows[0]?.n ?? 0);

      const removed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const reasonSql = this.reasonCase(recipe, t, offerKeys.length > 0);
        const { rows } = await tx.query<{ reason: string; n: string }>(
          `with p as (
             -- every parameter typed once, so a reason the recipe turns off leaves no untyped placeholder
             select $2::int[] as positive, $3::int as dnc, $4::int as wrong_person, $5::int as bounce,
                    $6::bigint as smartlead_client_id, $7::bigint[] as client_campaigns, $8::text[] as offer_keys, $9::text as client_tag
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
          [run.run_id, INTERESTED_CATEGORY_IDS, DNC_CATEGORY_ID, WRONG_PERSON_CATEGORY_ID, BOUNCE_CATEGORY_ID, recipe.smartlead_client_id, clientCampaigns, offerKeys, run.client_tag],
        );
        const byReason: Record<string, number> = Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0]));
        for (const r of rows) byReason[r.reason] = Number(r.n);

        // Within-run dedupe by address: first row by id stays.
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
      };
      const skipped: string[] = [];
      if (!t.leads) skipped.push("response-based (no public.leads mirror here)");
      if (!t.suppression) skipped.push("public.suppression (table missing)");
      if (recipe.suppression.same_offer_any_client && offerKeys.length === 0) skipped.push("same offer other client (no offer_key in topup.campaign_registry for this lane's campaigns)");
      if (domainList.kind === "skipped") skipped.push("client customer domain list (Josh chose to proceed without it)");
      const reasons = Object.entries(removed.byReason)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      const line =
        `Suppress done: raw ${raw} · removed ${suppressed}${reasons ? ` (${reasons})` : ""} · ${removed.deduped} duplicates within the pull · ${removed.needs_email} with no address · *net new ${removed.net_new}* — the number from here on.` +
        (skipped.length ? ` · not applied: ${skipped.join("; ")}.` : "");
      return finish(this.d, run, "suppress", removed.net_new, counts, line);
    });
  }

  /** The CASE that names the first reason a row is removed. Parameters: $2 positive ids, $3 DNC, $4 wrong person, $5 bounce, $6 smartlead_client_id, $7 client campaign ids, $8 offer keys, $9 client_tag. */
  private reasonCase(recipe: Recipe, t: Tables, haveOffer: boolean): string {
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
    if (recipe.suppression.client_prior_contacts) {
      const prior = [t.leads ? inLeads("l.smartlead_client_id = $6") : null, t.staging ? `exists (select 1 from public.leads_staging st where lower(st.email) = r.e and st.campaign_id = any($7::bigint[]))` : null].filter(Boolean).join(" or ");
      if (prior) whens.push(`when ${prior} then 'client_prior_contact'`);
    }
    if (recipe.suppression.same_offer_any_client && haveOffer && t.leads && t.campaigns) {
      whens.push(
        `when exists (select 1 from public.leads l join public.campaigns c on c.id = l.campaign_id join topup.campaign_registry cr on cr.campaign_id = c.smartlead_campaign_id
                       where lower(l.email) = r.e and cr.offer_key = any($8::text[]) and cr.client_tag <> $9) then 'same_offer_other_client'`,
      );
    }
    if (recipe.suppression.client_domain_blocklist) whens.push(`when exists (select 1 from topup.client_domain_blocklist b where b.client_tag = $9 and b.domain = r.d) then 'client_domain'`);
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

  private async offerKeys(recipe: Recipe): Promise<string[]> {
    const ids = recipe.routing.map((r) => r.campaign_id);
    if (ids.length === 0) return [];
    const { rows } = await this.d.repo.raw().query<{ offer_key: string }>(`select distinct offer_key from topup.campaign_registry where campaign_id = any($1::bigint[]) and offer_key is not null`, [ids]);
    return rows.map((r) => r.offer_key);
  }

  /**
   * The client's customer domain list. Present → ready. Absent → one card to
   * Cayden (list_added once the MCP tool add_client_domains has been used;
   * no_list is Josh's call) and the lane is blocked on the operator.
   */
  private async domainListReady(run: RunRow, recipe: Recipe): Promise<{ kind: "ready" } | { kind: "skipped" } | Extract<StageOutcome, { kind: "waiting" }>> {
    if (!recipe.suppression.client_domain_blocklist) return { kind: "ready" };
    const db = this.d.repo.raw();
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from topup.client_domain_blocklist where client_tag = $1`, [run.client_tag]);
    if (Number(rows[0]?.n ?? 0) > 0) {
      await this.d.ledger?.unblock(run.client_tag, run.lane, `Customer domain list present for ${run.client_tag} (${rows[0].n} domains).`, run.run_id);
      return { kind: "ready" };
    }
    const { rows: cards } = await db.query<{ resolution: string | null; status: string }>(`select resolution, status from topup.cards where run_id = $1 and kind = 'client_domain_list' order by created_at desc limit 1`, [run.run_id]);
    const last = cards[0];
    if (last?.status === "resolved" && last.resolution === "no_list") {
      await this.d.ledger?.unblock(run.client_tag, run.lane, "Josh chose to suppress without a customer domain list.", run.run_id);
      return { kind: "skipped" };
    }
    if (last?.status === "open") return { kind: "waiting", on: "operator", why: "customer domain list missing" };
    await this.d.console.ask({
      run,
      kind: "client_domain_list",
      audience: "operator",
      payload: { step: "suppress", client_tag: run.client_tag },
      text: `Step 5 needs ${run.client_tag}'s customer domain list before anything loads`,
      blocks: (cardId) => clientDomainListCard({ cardId, runId: run.run_id, clientTag: run.client_tag, lane: run.lane }),
    });
    await this.d.ledger?.block(run.client_tag, run.lane, "operator", `customer domain list for ${run.client_tag} is missing (skill: ask Cayden; add with MCP add_client_domains)`, run.run_id);
    return { kind: "waiting", on: "operator", why: "customer domain list missing" };
  }
}
