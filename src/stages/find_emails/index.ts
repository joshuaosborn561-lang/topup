import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { EmailWaterfall } from "../../clients/emailWaterfall.js";
import { emailJobState } from "../../clients/emailWaterfall.js";
import type { NameToEmail } from "../../clients/nameToEmail.js";
import { nameToEmailSendable } from "../../clients/nameToEmail.js";
import { recipeAuthorises, type Recipe } from "../../recipes/schema.js";
import { usd, worstCaseCents } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import { attempt, columnsOf, finish, park, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";
import { domainSql } from "../puzzle/classify.js";

/**
 * Email enrichment, immediately before verify (D29; skills leadgen-mcp-routing
 * stage 3 and unresolved-name-routing). Name to Email first, then Email
 * Finder Waterfall on a source_table with writeback. Never inline rows into
 * start_run. A getleads VALID pull with no leftover names is a skip.
 */
export interface FindEmailsDeps extends StageDeps {
  rails?: SpendRails;
  nameToEmail?: NameToEmail | null;
  emailWaterfall?: EmailWaterfall | null;
  cfg?: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export class FindEmailsStage {
  private readonly clock: Clock;

  constructor(private readonly d: FindEmailsDeps) {
    this.clock = d.clock ?? realClock;
  }

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "find_emails", "resolving", async (attempts) => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'needs_email'`, [run.run_id]);
      const need = Number(rows[0]?.n ?? 0);
      if (need === 0) {
        return finish(
          this.d,
          run,
          "find_emails",
          0,
          { email_finding_skipped: 1, needs_email: 0 },
          "Find emails skipped: no name+domain rows without an address (a getleads VALID pull arrives with one).",
        );
      }

      let fromFinder = 0;
      if (this.d.nameToEmail) {
        fromFinder = await this.runNameToEmail(run, recipe, table);
      }

      const still = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'needs_email'`, [run.run_id]);
      const remaining = Number(still.rows[0]?.n ?? 0);
      let fromWaterfall = 0;
      if (remaining > 0 && this.d.emailWaterfall) {
        const w = await this.runWaterfall(run, recipe, table, remaining);
        if (w.kind !== "ran") return w;
        fromWaterfall = w.resolved;
      } else if (remaining > 0 && !this.d.emailWaterfall && !this.d.nameToEmail) {
        const reason = `Find emails parked: ${remaining} name+domain rows have no address. Configure NAME_TO_EMAIL_MCP_URL (verify_person only) and EMAIL_WATERFALL_MCP_URL (source_table + writeback).`;
        await this.d.repo.failStep(run.run_id, "find_emails", reason, true);
        return park(this.d, run, "find_emails", reason, attempts);
      } else if (remaining > 0 && !this.d.emailWaterfall) {
        const reason = `Find emails parked: Name to Email resolved ${fromFinder}; ${remaining} remain and Email Waterfall is not configured (EMAIL_WATERFALL_MCP_URL).`;
        await this.d.repo.failStep(run.run_id, "find_emails", reason, true);
        return park(this.d, run, "find_emails", reason, attempts);
      }

      const promoted = await this.promoteFound(run, table);
      const leftover = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'needs_email'`, [run.run_id]);
      const unresolved = Number(leftover.rows[0]?.n ?? 0);
      const counts = { needs_email: need, from_name_to_email: fromFinder, from_waterfall: fromWaterfall, promoted, unresolved };
      return finish(
        this.d,
        run,
        "find_emails",
        promoted,
        counts,
        `Find emails: ${need} needed an address · Name to Email ${fromFinder} · Waterfall ${fromWaterfall} · *${promoted}* now ready to verify · ${unresolved} banked with no address (not discarded).`,
      );
    });
  }

  /**
   * verify_person one row at a time. Names travel server-to-server only;
   * nothing is logged. Catch-all is never treated as valid.
   */
  private async runNameToEmail(run: RunRow, recipe: Recipe, table: string): Promise<number> {
    const cols = await columnsOf(this.d.repo, table);
    const dsql = domainSql(cols);
    const cap = Math.min(recipe.email_finding.batch_rows, 200);
    const { rows } = await this.d.repo.raw().query<{ id: string; first_name: string; last_name: string; domain: string }>(
      `select id::text as id, first_name, last_name, ${dsql} as domain
       from ${table}
       where run_id = $1 and lead_status = 'needs_email'
         and coalesce(btrim(first_name), '') <> '' and coalesce(btrim(last_name), '') <> ''
         and ${dsql} is not null
       order by id
       limit $2`,
      [run.run_id, cap],
    );
    let found = 0;
    for (const row of rows) {
      const result = await this.d.nameToEmail!.verifyPerson({ first_name: row.first_name, last_name: row.last_name, domain: row.domain });
      if (!nameToEmailSendable(result) || !result.email) continue;
      const n = await this.d.repo.withRun(run.run_id, async (tx) =>
        tx.query(`update ${table} set email = $2, lead_status = 'email_found', status_changed_at = now() where id = $1::uuid and run_id = $3 and lead_status = 'needs_email'`, [row.id, result.email, run.run_id]),
      );
      found += n.rowCount ?? 0;
    }
    if (this.d.rails && rows.length) {
      await this.d.rails.record({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "find_emails",
        vendor: "millionverifier",
        action: "verify",
        rows: rows.length,
        credits: 0,
        worstCaseCents: worstCaseCents("millionverifier", "verify", rows.length),
        balanceBefore: null,
        balanceAfter: null,
        vendorJobId: null,
        approvedBy: null,
      });
    }
    return found;
  }

  private async runWaterfall(run: RunRow, recipe: Recipe, table: string, rows: number): Promise<StageOutcome | { kind: "ran"; resolved: number }> {
    const where = `run_id = '${run.run_id}' and lead_status = 'needs_email'`;
    const maxTier = recipe.email_finding.max_tier;
    if (!recipeAuthorises(recipe, "find_emails", maxTier === "fullenrich" ? "fullenrich" : maxTier === "aiark" ? "aiark" : maxTier)) {
      throw new Error(`the recipe does not authorise email finding at max_tier ${maxTier}`);
    }
    const quote = await this.d.emailWaterfall!.estimate({ client_tag: run.client_tag, source_table: table, where, max_tier: maxTier, need: "email" });
    const vendor = maxTier === "getleads" || maxTier === "smartlead" ? maxTier : maxTier === "aiark" ? "aiark" : maxTier === "leadmagic" ? "leadmagic" : maxTier === "prospeo" ? "prospeo" : "aiark";
    const worst = this.d.rails ? worstCaseCents(vendor, "export", rows) : 0;
    if (this.d.rails) {
      const decision = await this.d.rails.gate({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "find_emails",
        vendor,
        action: "export",
        rows,
        recipeAuthorised: recipeAuthorises(recipe, "find_emails", vendor),
        worstCaseCents: worst,
      });
      if (decision.kind === "blocked") throw new Error(`email waterfall blocked: ${decision.reason}`);
      if (decision.kind === "ask") {
        const reason = `Email Waterfall estimate ${usd(decision.worstCaseCents)} (vendor quote ${quote.estimated_cost_usd ?? "n/a"}) is over the auto cap. Ask Josh.`;
        await this.d.repo.failStep(run.run_id, "find_emails", reason, true);
        return park(this.d, run, "find_emails", reason, 1);
      }
    }
    const started = await this.d.emailWaterfall!.start({
      client_tag: run.client_tag,
      source_table: table,
      where,
      max_tier: maxTier,
      need: "email",
    });
    await this.d.repo.setStepVendorJob(run.run_id, "find_emails", started.job_id);
    const pollCfg = this.d.cfg ?? { pollMs: 30_000, deadMs: 90 * 60_000 };
    await poll(
      async () => {
        const j = await this.d.emailWaterfall!.check(started.job_id);
        const st = emailJobState(j.status);
        if (st === "failed") return { state: "failed" as const, error: j.error ?? j.status };
        if (st === "done") return { state: "done" as const, value: j };
        return { state: "running" as const };
      },
      { ...pollCfg, clock: this.clock, what: `email waterfall ${started.job_id}` },
    );
    const cols = await columnsOf(this.d.repo, table);
    const resolved = await this.d.repo.withRun(run.run_id, async (tx) => {
      const src = cols.has("wf_email") ? "wf_email" : cols.has("candidate_email") ? "candidate_email" : null;
      if (!src) return 0;
      const r = await tx.query(
        `update ${table} set email = ${src}, lead_status = 'email_found', status_changed_at = now()
         where run_id = $1 and lead_status = 'needs_email' and coalesce(${src}, '') <> '' and ${src} like '%@%'`,
        [run.run_id],
      );
      return r.rowCount ?? 0;
    });
    return { kind: "ran", resolved };
  }

  private async promoteFound(run: RunRow, table: string): Promise<number> {
    const { rowCount } = await this.d.repo.withRun(run.run_id, async (tx) =>
      tx.query(`update ${table} set lead_status = 'needs_verify', status_changed_at = now() where run_id = $1 and lead_status = 'email_found' and coalesce(email, '') <> ''`, [run.run_id]),
    );
    return rowCount ?? 0;
  }
}
