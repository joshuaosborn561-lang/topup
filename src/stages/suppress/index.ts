import { ingestedTable, type Queryable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { JobSettings } from "../../jobs/settings.js";
import { classifyArrivingNegatives } from "../../replies/arrive.js";
import { hasNegativeClassColumn } from "../../replies/store.js";
import { attempt, finish, type StageDeps, type StageOutcome } from "../common.js";
import { dncListSql, hardBounceSql, thisClientUnsubscribeSql } from "./recycle.js";

/**
 * Step 5 — Suppress and dedupe (D81).
 *
 * Only:
 *   unsubscribed       this client's classified unsubscribe, or Smartlead status unsubscribed
 *   suppression_list   the existing DNC list (`public.suppression`)
 *   bounced            a bounced send or Sender Originated Bounce (kept pending Josh)
 *
 * Not-interested is not suppressed. Smartlead category Do Not Contact is
 * not a class. No 90-day prior contact. No 6-month expiry. Never writes
 * dl_status, sg_exclude, or skip_*. Never unsuppresses in Smartlead.
 */
export interface SuppressDeps extends StageDeps {
  ledger?: LaneLedger;
}

export const DNC_CATEGORY_ID = 4;
export const WRONG_PERSON_CATEGORY_ID = 7;
export const BOUNCE_CATEGORY_ID = 9;

export const SUPPRESS_REASONS = ["unsubscribed", "suppression_list", "bounced"] as const;

interface Tables {
  leads: boolean;
  sends: boolean;
  suppression: boolean;
  campaigns: boolean;
  staging: boolean;
}

export class SuppressStage {
  constructor(private readonly d: SuppressDeps) {}

  async run(run: RunRow, settings: JobSettings): Promise<StageOutcome> {
    return attempt(this.d, run, "suppress", "suppressing", async () => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const t = await this.tables();
      const hasClass = await hasNegativeClassColumn(db);
      const arriving = await classifyArrivingNegatives(db, { clientId: settings.smartlead_client_id, apply: hasClass });

      const { rows: rawRows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'ingested'`, [run.run_id]);
      const raw = Number(rawRows[0]?.n ?? 0);

      const removed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const byReason = await this.removeByReason(tx, run, settings, t, hasClass, "ingested");

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
        classified_unsubscribe: arriving.wrote_unsubscribe,
        classified_not_interested: arriving.wrote_not_interested,
        classify_needs_ai: arriving.needs_ai,
      };
      const skipped: string[] = [];
      if (!t.leads) skipped.push("response-based (no public.leads mirror here)");
      if (!t.suppression) skipped.push("public.suppression (table missing)");
      if (!hasClass) skipped.push("negative_class (apply 0025_d81_negative_class.sql; Ask Josh)");
      const reasons = Object.entries(removed.byReason)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join(", ");
      const line =
        `Suppress done: raw ${raw} · removed ${suppressed}${reasons ? ` (${reasons})` : ""} · ${removed.deduped} duplicates within the pull · ${removed.needs_email} with no address · *net new ${removed.net_new}* — the number from here on.` +
        ` · D81: this client's unsubscribes, the existing DNC list, and hard bounces (pending Josh). Not-interested is not suppressed.` +
        (skipped.length ? ` · not applied: ${skipped.join("; ")}.` : "");
      return finish(this.d, run, "suppress", removed.net_new, counts, line);
    });
  }

  /**
   * D81 reasons for this job's rows in one status: unsubscribed, the DNC
   * list, hard bounces. The quote runs it on 'ingested'; the email finder
   * runs it on the addresses it found (D103).
   */
  async removeFound(run: RunRow, settings: JobSettings, status: string): Promise<Record<string, number>> {
    const t = await this.tables();
    const hasClass = await hasNegativeClassColumn(this.d.repo.raw());
    return this.d.repo.withRun(run.run_id, (tx) => this.removeByReason(tx, run, settings, t, hasClass, status));
  }

  private async removeByReason(tx: Queryable, run: RunRow, settings: JobSettings, t: Tables, hasClass: boolean, status: string): Promise<Record<string, number>> {
    const table = ingestedTable(run.client_tag);
    const reasonSql = this.reasonCase(settings, t, hasClass);
    const { rows } = await tx.query<{ reason: string; n: string }>(
      `with p as (
         select $2::int[] as unused_positive, $3::int as unused_dnc, $4::int as unused_wrong, $5::int as bounce,
                $6::bigint as smartlead_client_id
       ),
       r as (
         select id, lower(email) as e, split_part(lower(email), '@', 2) as d
         from ${table} where run_id = $1 and lead_status = $7 and coalesce(email, '') <> ''
       ),
       judged as (select r.id, (${reasonSql}) as reason from r, p),
       hit as (
         update ${table} t set lead_status = 'suppressed', status_changed_at = now(),
           qa_flags = coalesce(t.qa_flags, '{}'::jsonb) || jsonb_build_object('suppressed_reason', j.reason)
         from judged j where t.id = j.id and j.reason is not null
         returning j.reason
       )
       select reason, count(*)::text as n from hit group by reason`,
      [run.run_id, [] as number[], DNC_CATEGORY_ID, WRONG_PERSON_CATEGORY_ID, BOUNCE_CATEGORY_ID, settings.smartlead_client_id, status],
    );
    const byReason: Record<string, number> = Object.fromEntries(SUPPRESS_REASONS.map((r) => [r, 0]));
    for (const r of rows) byReason[r.reason] = Number(r.n);
    return byReason;
  }

  /** The CASE that names the first reason a row is removed. $5 bounce, $6 client. */
  private reasonCase(settings: JobSettings, t: Tables, hasClass: boolean): string {
    const whens: string[] = [];
    if (t.leads) whens.push(`when ${thisClientUnsubscribeSql(hasClass)} then 'unsubscribed'`);
    if (settings.suppression.public_suppression && t.suppression) whens.push(`when ${dncListSql()} then 'suppression_list'`);
    if (settings.suppression.bounced_any_client && t.leads) whens.push(`when ${hardBounceSql(t.sends)} then 'bounced'`);
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
}
