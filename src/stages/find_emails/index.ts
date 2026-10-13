import type { EmailFinder, FinderJob } from "../../clients/emailFinder.js";
import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { spendApprovalCard } from "../../console/cards.js";
import type { JobSettings } from "../../jobs/settings.js";
import { PRICES, usd, worstCaseCents } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import type { DedupeStage } from "../dedupe/index.js";
import type { SuppressStage } from "../suppress/index.js";
import { attempt, finish, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";

/**
 * D103 — find emails for the people the export named without one. After
 * the ICP website check (so no money goes on companies that are not a fit)
 * and before verification. The Email Finder Waterfall reads this job's
 * needs_email rows from the lane table by id and writes its own result
 * columns back; the service then copies a found address onto the row and
 * runs it through the same checks the quote ran (already held, unsubscribed,
 * DNC, bounced) before it goes to verification. Not found stays in the table
 * as email_not_found. Paid; the approver's yes to the quote is the ceiling,
 * and the finder is told the same ceiling and refuses above it.
 */
export const FIND_VENDOR = "aiark" as const;
export const FIND_ACTION = "find_email";
/** The deepest paid tier the finder may use (D58: a recorded leadmagic means aiark; Prospeo and FullEnrich only when Josh says). */
export const FIND_MAX_TIER = "aiark";

/** Rows the finder can look up: a first and last name, and a company domain or name. */
export function findableSql(prefix = ""): string {
  return `coalesce(btrim(${prefix}first_name), '') <> '' and coalesce(btrim(${prefix}last_name), '') <> ''
    and (coalesce(btrim(${prefix}company_domain), '') <> '' or coalesce(btrim(${prefix}company_name), '') <> '')`;
}

/** Worst case from the service's own price table (brief section 8): the paid tier on every row. getleads and Smartlead are on flat plans. */
export function findWorstCaseCents(rows: number): number {
  return worstCaseCents(FIND_VENDOR, FIND_ACTION, rows);
}

export interface FindEmailsDeps extends StageDeps {
  rails: SpendRails;
  finder: EmailFinder | null;
  dedupe: DedupeStage;
  suppress: SuppressStage;
  cfg: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export class FindEmailsStage {
  private readonly clock: Clock;

  constructor(private readonly d: FindEmailsDeps) {
    this.clock = d.clock ?? realClock;
  }

  /** The finder is connected on this service. The quote prices the look-up only when it is. */
  ready(): boolean {
    return Boolean(this.d.finder?.configured());
  }

  async run(run: RunRow, settings: JobSettings): Promise<StageOutcome> {
    return attempt(this.d, run, "find_emails", "resolving", async () => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const { rows: sized } = await db.query<{ findable: string; unfindable: string }>(
        `select count(*) filter (where ${findableSql()})::text as findable, count(*) filter (where not (${findableSql()}))::text as unfindable
           from ${table} where run_id = $1 and lead_status = 'needs_email'`,
        [run.run_id],
      );
      const findable = Number(sized[0]?.findable ?? 0);
      const unfindable = Number(sized[0]?.unfindable ?? 0);
      if (findable === 0) {
        const left = await this.closeUnfound(run, table, "no name and company to look up");
        return finish(this.d, run, "find_emails", 0, { looked_up: 0, not_found: left }, `Find emails: nobody to look up (${left} rows without an email had no full name and company).`);
      }
      if (!this.d.finder?.configured()) {
        const left = await this.closeUnfound(run, table, "email finder not connected");
        return finish(this.d, run, "find_emails", 0, { looked_up: 0, not_found: left, finder_not_connected: 1 }, `Find emails: the email finder is not connected (EMAIL_WATERFALL_MCP_URL on Railway), so ${left} people without an email were left out. Ask Josh.`);
      }

      const own = await this.d.repo.getStep(run.run_id, "find_emails");
      const approved = own?.approved_cents ?? 0;
      const approvedBy = typeof own?.counts?.approved_by === "string" ? String(own.counts.approved_by) : null;
      let jobId = own?.vendor_job_id ?? null;
      const worst = findWorstCaseCents(findable);
      if (!jobId) {
        const spentToday = await this.d.repo.spentTodayCents();
        const decision = this.d.rails.decide(
          { runId: run.run_id, clientTag: run.client_tag, step: "find_emails", vendor: FIND_VENDOR, action: FIND_ACTION, rows: findable, recipeAuthorised: true, approvedCents: approved, worstCaseCents: worst },
          spentToday,
        );
        if (decision.kind === "blocked") throw new Error(`find emails blocked: ${decision.reason}`);
        if (decision.kind === "ask") return this.askForMore(run, findable, worst, spentToday);
        const started = await this.d.finder.start(run.client_tag, this.source(run), FIND_MAX_TIER, Math.max(0, approved) / 100);
        if ("refused" in started) {
          // The finder's own estimate is above what the person said yes to: show them its number.
          return this.askForMore(run, findable, worst, spentToday, started.refused);
        }
        jobId = started.job_id;
        await this.d.repo.setStepVendorJob(run.run_id, "find_emails", jobId);
        await this.d.console.postInThread(run, `Find emails: looking up ${findable} people without an email (email finder job \`${jobId}\`, up to ${usd(worst)}, approved by ${approvedBy ?? "the quote"}).`);
      }
      const job = await poll<FinderJob>(
        async () => {
          const j = await this.d.finder!.check(jobId!);
          if (j.status === "failed") return { state: "failed", error: j.error ?? "the email finder job failed" };
          if (j.status === "done") return { state: "done", value: j };
          return { state: "running" };
        },
        { pollMs: this.d.cfg.pollMs, deadMs: this.d.cfg.deadMs, clock: this.clock, what: `email finder ${jobId}`, stop: async () => (await this.d.repo.getRun(run.run_id))?.status === "aborted" },
      );
      if (job.outcome === "refused_over_ceiling") {
        await this.d.repo.setStepVendorJob(run.run_id, "find_emails", null);
        return this.askForMore(run, findable, worst, await this.d.repo.spentTodayCents(), "the email finder priced the run above the approved amount");
      }
      const spentCents = Math.ceil(job.spend_usd * 100);
      await this.d.rails.record({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "find_emails",
        vendor: FIND_VENDOR,
        action: FIND_ACTION,
        rows: findable,
        // The finder reports dollars; the ledger books credits at the table's unit price, so this is the same dollars rounded up.
        credits: spentCents / PRICES[FIND_VENDOR].unitCents,
        worstCaseCents: worst,
        balanceBefore: null,
        balanceAfter: null,
        vendorJobId: jobId,
        approvedBy,
      });

      // Found → the same checks the quote ran → verification. Not found stays, banked.
      // The lane table holds each email once (a unique index): a found address already on another row is a person the
      // lane already has, so it is held, and two people the finder gave the same address keep only the first.
      const promoted = await this.d.repo.withRun(run.run_id, async (tx) => {
        const inLane = await tx.query(
          `update ${table} t set lead_status = 'held', status_changed_at = now(),
             qa_flags = coalesce(t.qa_flags, '{}'::jsonb) || '{"held_reason": "found_email_already_in_lane"}'::jsonb
           where t.run_id = $1 and t.lead_status = 'needs_email' and coalesce(t.wf_email, '') like '%_@_%'
             and exists (select 1 from ${table} o where lower(o.email) = lower(btrim(t.wf_email)))`,
          [run.run_id],
        );
        const twice = await tx.query(
          `with ranked as (
             select id, row_number() over (partition by lower(btrim(wf_email)) order by id) as rn
               from ${table} where run_id = $1 and lead_status = 'needs_email' and coalesce(wf_email, '') like '%_@_%'
           )
           update ${table} t set lead_status = 'deduped', status_changed_at = now(),
             qa_flags = coalesce(t.qa_flags, '{}'::jsonb) || '{"deduped_reason": "same_found_email"}'::jsonb
             from ranked k where t.id = k.id and k.rn > 1`,
          [run.run_id],
        );
        const r = await tx.query(
          `update ${table} set email = lower(btrim(wf_email)), lead_status = 'email_found', status_changed_at = now(),
             qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('email_found_by', coalesce(wf_vendor, 'email_finder'))
           where run_id = $1 and lead_status = 'needs_email' and coalesce(wf_email, '') like '%_@_%'`,
          [run.run_id],
        );
        return { inLane: inLane.rowCount ?? 0, dup: twice.rowCount ?? 0, found: r.rowCount ?? 0 };
      });
      const found = promoted.found + promoted.inLane + promoted.dup;
      const dup = promoted.dup;
      const heldOther = promoted.found ? await this.d.dedupe.holdByStatus(run, settings, "email_found") : { held: 0 };
      const held = { held: promoted.inLane + heldOther.held };
      const removed = promoted.found ? await this.d.suppress.removeFound(run, settings, "email_found") : {};
      const suppressed = Object.values(removed).reduce((a, b) => a + b, 0);
      const ready = await this.d.repo.withRun(run.run_id, async (tx) => {
        const r = await tx.query(`update ${table} set lead_status = 'needs_verify', status_changed_at = now() where run_id = $1 and lead_status = 'email_found'`, [run.run_id]);
        return r.rowCount ?? 0;
      });
      const notFound = await this.closeUnfound(run, table, "no email found");
      const counts: Record<string, number> = {
        looked_up: findable,
        emails_found: found,
        found_already_held: held.held,
        found_duplicate: dup,
        found_suppressed: suppressed,
        found_ready_to_verify: ready,
        not_found: notFound,
        unfindable,
        finder_spend_cents: spentCents,
      };
      const line =
        `Find emails done: looked up ${findable} · found ${found}` +
        (held.held ? ` · ${held.held} of those the client already has` : "") +
        (dup ? ` · ${dup} duplicates` : "") +
        (suppressed ? ` · ${suppressed} unsubscribed or bounced` : "") +
        ` · *${ready}* go on to verification · ${notFound} not found (kept, not loaded) · spent ${usd(spentCents)} of ${usd(approved)} approved.`;
      return finish(this.d, run, "find_emails", ready, counts, line, undefined, spentCents);
    });
  }

  private source(run: RunRow): { schema: string; table: string; where: string } {
    const [schema, table] = ingestedTable(run.client_tag).replace(/"/g, "").split(".");
    return { schema: schema!, table: table!, where: `run_id = '${run.run_id}' and lead_status = 'needs_email'` };
  }

  /** Rows still without an email at the end: email_not_found, with why. Never loaded, never deleted. */
  private async closeUnfound(run: RunRow, table: string, why: string): Promise<number> {
    return this.d.repo.withRun(run.run_id, async (tx) => {
      const r = await tx.query(
        `update ${table} set lead_status = 'email_not_found', status_changed_at = now(),
           qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('email_not_found', $2::text)
         where run_id = $1 and lead_status = 'needs_email'`,
        [run.run_id, why],
      );
      return r.rowCount ?? 0;
    });
  }

  /** The look-up costs more than the yes covered: one card with the new number; the job waits for a named yes to it. */
  private async askForMore(run: RunRow, rows: number, worst: number, spentToday: number, note?: string): Promise<StageOutcome> {
    const open = await this.d.repo.openCardsForRun(run.run_id);
    const existing = open.find((c) => c.kind === "spend_approval" && c.payload.step === "find_emails");
    const payload = { step: "find_emails", vendor: "email finder", action: FIND_ACTION, rows, worst_case_cents: worst };
    const blocks = (cardId: string) =>
      spendApprovalCard({ cardId, runId: run.run_id, clientTag: run.client_tag, step: "find_emails", vendor: "email finder", action: FIND_ACTION, rows, worstCaseCents: worst, projectedUseful: null, spentTodayCents: spentToday, dailyCapCents: this.d.rails.cfg.dailyCapCents });
    if (existing) {
      await this.d.repo.updateCardPayload(existing.card_id, payload);
      await this.d.repo.setCardBlocks(existing.card_id, blocks(existing.card_id));
    } else {
      await this.d.console.ask({ run, kind: "spend_approval", audience: "owner", payload, text: `Find emails for ${rows} people: worst case ${usd(worst)}.`, blocks });
    }
    return { kind: "waiting", on: "owner", why: `Looking up emails for ${rows} people needs a named yes to ${usd(worst)}${note ? ` (${note})` : ""} (D51)`, worstCaseCents: worst };
  }
}
