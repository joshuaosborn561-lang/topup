import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { Recipe } from "../../recipes/schema.js";
import type { DomainWaterfall } from "../../clients/domainWaterfall.js";
import { domainJobState } from "../../clients/domainWaterfall.js";
import type { PeopleWaterfall } from "../../clients/peopleWaterfall.js";
import { peopleJobState } from "../../clients/peopleWaterfall.js";
import { recipeAuthorises } from "../../recipes/schema.js";
import { usd, worstCaseCents } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import { attempt, columnsOf, finish, park, poll, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";
import { domainSql, nameSql } from "./classify.js";

/**
 * Puzzle pieces, after suppress and before email finding (D29).
 * Name without a domain → Domain Waterfall. Domain without a name →
 * Find Named Person. A found name is banked in public.name_bank and never
 * discarded (unresolved-name-routing).
 */
export interface PuzzleDeps extends StageDeps {
  ledger?: LaneLedger;
  rails?: SpendRails;
  domain?: DomainWaterfall | null;
  people?: PeopleWaterfall | null;
  cfg?: { pollMs: number; deadMs: number };
  clock?: Clock;
}

export class PuzzleStage {
  private readonly clock: Clock;

  constructor(private readonly d: PuzzleDeps) {
    this.clock = d.clock ?? realClock;
  }

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "puzzle", "resolving", async (attempts) => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const cols = await columnsOf(this.d.repo, table);
      const dsql = domainSql(cols);
      const nsql = nameSql();

      const classified = await this.d.repo.withRun(run.run_id, async (tx) => {
        const toDomain = await tx.query(
          `update ${table} set lead_status = 'needs_domain', status_changed_at = now(),
             qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('puzzle', 'needs_domain')
           where run_id = $1 and lead_status = 'needs_email' and ${nsql} and ${dsql} is null`,
          [run.run_id],
        );
        const toPerson = await tx.query(
          `update ${table} set lead_status = 'needs_person', status_changed_at = now(),
             qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('puzzle', 'needs_person')
           where run_id = $1 and lead_status = 'needs_email' and not ${nsql} and ${dsql} is not null`,
          [run.run_id],
        );
        return { needs_domain: toDomain.rowCount ?? 0, needs_person: toPerson.rowCount ?? 0 };
      });

      const leftover = await db.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'needs_email'`, [run.run_id]);
      const needsEmail = Number(leftover.rows[0]?.n ?? 0);
      const banked = await this.bankNames(run, table, cols);

      await this.registerQueues(run, table, classified.needs_domain, classified.needs_person, needsEmail);

      const missing: string[] = [];
      if (classified.needs_domain > 0 && !this.d.domain) missing.push(`${classified.needs_domain} name-no-domain rows need Domain Waterfall (DOMAIN_WATERFALL_MCP_URL)`);
      if (classified.needs_person > 0 && !this.d.people) missing.push(`${classified.needs_person} domain-no-name rows need Find Named Person (PEOPLE_WATERFALL_MCP_URL)`);
      if (missing.length) {
        const reason = `Puzzle parked: ${missing.join("; ")}. Skills domain-waterfall / people-waterfall. Bound to ≤500 rows per job when those URLs are set.`;
        await this.d.repo.failStep(run.run_id, "puzzle", reason, true);
        return park(this.d, run, "puzzle", reason, attempts);
      }

      let domainsResolved = 0;
      let peopleResolved = 0;
      if (classified.needs_domain > 0 && this.d.domain) {
        const n = await this.runDomain(run, recipe, table, classified.needs_domain);
        if (n.kind !== "ran") return n;
        domainsResolved = n.resolved;
      }
      if (classified.needs_person > 0 && this.d.people) {
        const n = await this.runPeople(run, recipe, table, classified.needs_person);
        if (n.kind !== "ran") return n;
        peopleResolved = n.resolved;
      }

      const after = await db.query<{ lead_status: string; n: string }>(`select lead_status, count(*)::text as n from ${table} where run_id = $1 and lead_status in ('needs_domain','needs_person','needs_email','needs_verify') group by 1`, [run.run_id]);
      const byStatus = Object.fromEntries(after.rows.map((r) => [r.lead_status, Number(r.n)]));
      const counts = {
        needs_domain: classified.needs_domain,
        needs_person: classified.needs_person,
        needs_email: needsEmail,
        banked,
        domains_resolved: domainsResolved,
        people_resolved: peopleResolved,
        ...Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [`after_${k}`, v])),
      };
      const line =
        `Puzzle: ${classified.needs_domain} needed a domain · ${classified.needs_person} needed a person · ${needsEmail} already name+domain, no email · banked ${banked} names` +
        (domainsResolved || peopleResolved ? ` · resolved domain ${domainsResolved} / person ${peopleResolved}` : "") +
        `. Next is Name to Email then Email Waterfall.`;
      return finish(this.d, run, "puzzle", needsEmail + (byStatus.needs_email ?? 0), counts, line);
    });
  }

  private async bankNames(run: RunRow, table: string, cols: Set<string>): Promise<number> {
    const { rows: has } = await this.d.repo.raw().query<{ ok: boolean }>(`select to_regclass('public.name_bank') is not null as ok`);
    if (!has[0]?.ok) return 0;
    const dsql = domainSql(cols);
    const title = cols.has("title") ? "title" : cols.has("job_title") ? "job_title" : "null";
    const { rowCount } = await this.d.repo.withRun(run.run_id, async (tx) =>
      tx.query(
        `insert into public.name_bank (client_tag, domain, first_name, last_name, job_title, source, status)
         select $2, ${dsql}, first_name, last_name, ${title}, 'topup_puzzle', 'pending'
         from ${table} t
         where t.run_id = $1
           and t.lead_status in ('needs_email', 'needs_domain', 'needs_person')
           and (coalesce(btrim(t.first_name), '') <> '' or coalesce(btrim(t.last_name), '') <> '')
           and not exists (
             select 1 from public.name_bank b
             where b.client_tag = $2
               and coalesce(b.domain, '') = coalesce(${dsql}, '')
               and lower(coalesce(b.first_name, '')) = lower(coalesce(t.first_name, ''))
               and lower(coalesce(b.last_name, '')) = lower(coalesce(t.last_name, ''))
           )`,
        [run.run_id, run.client_tag],
      ),
    );
    return rowCount ?? 0;
  }

  private async registerQueues(run: RunRow, table: string, domains: number, people: number, emails: number): Promise<void> {
    if (!this.d.ledger) return;
    const src = table;
    if (domains) {
      await this.d.ledger.registerQueue({
        client_tag: run.client_tag,
        lane: run.lane,
        queue_name: "domain_queue",
        source_table: src,
        where_sql: `run_id = '${run.run_id}' and lead_status = 'needs_domain'`,
        missing: "domain",
        next_method: "domain_waterfall",
        registered_by: "puzzle",
      });
    }
    if (people) {
      await this.d.ledger.registerQueue({
        client_tag: run.client_tag,
        lane: run.lane,
        queue_name: "people_queue",
        source_table: src,
        where_sql: `run_id = '${run.run_id}' and lead_status = 'needs_person'`,
        missing: "person",
        next_method: "people_waterfall",
        registered_by: "puzzle",
      });
    }
    if (emails) {
      await this.d.ledger.registerQueue({
        client_tag: run.client_tag,
        lane: run.lane,
        queue_name: "email_queue",
        source_table: src,
        where_sql: `run_id = '${run.run_id}' and lead_status = 'needs_email'`,
        missing: "email",
        next_method: "name_to_email",
        registered_by: "puzzle",
      });
    }
  }

  private async runDomain(run: RunRow, recipe: Recipe, table: string, rows: number): Promise<StageOutcome | { kind: "ran"; resolved: number }> {
    const where = `run_id = '${run.run_id}' and lead_status = 'needs_domain'`;
    const quote = await this.d.domain!.estimate({ source_table: table, where, client_tag: run.client_tag, limit: 500 });
    const worst = this.d.rails ? worstCaseCents("apify", "export", Math.min(500, rows)) : 0;
    if (this.d.rails) {
      const decision = await this.d.rails.gate({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "puzzle",
        vendor: "apify",
        action: "export",
        rows: Math.min(500, rows),
        recipeAuthorised: recipeAuthorises(recipe, "puzzle", "apify"),
        worstCaseCents: worst,
      });
      if (decision.kind === "blocked") throw new Error(`domain waterfall blocked: ${decision.reason}`);
      if (decision.kind === "ask") {
        const reason = `Domain Waterfall estimate ${usd(decision.worstCaseCents)} (vendor quote ${quote.estimated_cost_usd ?? "n/a"}) is over the auto cap. Ask Josh.`;
        await this.d.repo.failStep(run.run_id, "puzzle", reason, true);
        return park(this.d, run, "puzzle", reason, 1);
      }
    }
    const started = await this.d.domain!.start({
      source_table: table,
      where,
      client_tag: run.client_tag,
      approve_cost_usd: Math.max(0.01, (quote.estimated_cost_usd ?? worst / 100) || 5),
      limit: 500,
    });
    await this.d.repo.setStepVendorJob(run.run_id, "puzzle", started.job_id);
    const pollCfg = this.d.cfg ?? { pollMs: 30_000, deadMs: 90 * 60_000 };
    await poll(
      async () => {
        const j = await this.d.domain!.check(started.job_id);
        const st = domainJobState(j.status);
        if (st === "failed") return { state: "failed" as const, error: j.error ?? j.status };
        if (st === "done") return { state: "done" as const, value: j };
        return { state: "running" as const };
      },
      { ...pollCfg, clock: this.clock, what: `domain waterfall ${started.job_id}` },
    );
    const cols = await columnsOf(this.d.repo, table);
    const resolved = await this.d.repo.withRun(run.run_id, async (tx) => {
      if (cols.has("wf_domain") && cols.has("company_domain")) {
        await tx.query(`update ${table} set company_domain = wf_domain, status_changed_at = now() where run_id = $1 and lead_status = 'needs_domain' and coalesce(wf_domain, '') <> ''`, [run.run_id]);
      } else if (cols.has("wf_domain") && cols.has("domain")) {
        await tx.query(`update ${table} set domain = wf_domain, status_changed_at = now() where run_id = $1 and lead_status = 'needs_domain' and coalesce(wf_domain, '') <> ''`, [run.run_id]);
      }
      const r = await tx.query(
        `update ${table} set lead_status = 'needs_email', status_changed_at = now()
         where run_id = $1 and lead_status = 'needs_domain' and ${domainSql(await columnsOf(this.d.repo, table))} is not null and ${nameSql()}`,
        [run.run_id],
      );
      return r.rowCount ?? 0;
    });
    return { kind: "ran", resolved };
  }

  private async runPeople(run: RunRow, recipe: Recipe, table: string, rows: number): Promise<StageOutcome | { kind: "ran"; resolved: number }> {
    const where = `run_id = '${run.run_id}' and lead_status = 'needs_person'`;
    const quote = await this.d.people!.estimate({ source_table: table, where, client_tag: run.client_tag });
    const worst = this.d.rails ? worstCaseCents("aiark", "export", rows) : 0;
    if (this.d.rails) {
      const decision = await this.d.rails.gate({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "puzzle",
        vendor: "aiark",
        action: "export",
        rows,
        recipeAuthorised: recipeAuthorises(recipe, "puzzle", "aiark"),
        worstCaseCents: worst,
      });
      if (decision.kind === "blocked") throw new Error(`people waterfall blocked: ${decision.reason}`);
      if (decision.kind === "ask") {
        const reason = `Find Named Person estimate ${usd(decision.worstCaseCents)} (vendor quote ${quote.estimated_cost_usd ?? "n/a"}) is over the auto cap. Ask Josh.`;
        await this.d.repo.failStep(run.run_id, "puzzle", reason, true);
        return park(this.d, run, "puzzle", reason, 1);
      }
    }
    const started = await this.d.people!.start({
      source_table: table,
      where,
      client_tag: run.client_tag,
      approve_cost_usd: Math.max(0.01, (quote.estimated_cost_usd ?? worst / 100) || 5),
    });
    const pollCfg = this.d.cfg ?? { pollMs: 30_000, deadMs: 90 * 60_000 };
    await poll(
      async () => {
        const j = await this.d.people!.check(started.job_id);
        const st = peopleJobState(j.status);
        if (st === "failed") return { state: "failed" as const, error: j.error ?? j.status };
        if (st === "done") return { state: "done" as const, value: j };
        return { state: "running" as const };
      },
      { ...pollCfg, clock: this.clock, what: `people waterfall ${started.job_id}` },
    );
    const contacts = `public.${run.client_tag}_wf_contacts`;
    const { rows: has } = await this.d.repo.raw().query<{ ok: boolean }>(`select to_regclass($1) is not null as ok`, [contacts]);
    if (!has[0]?.ok) return { kind: "ran", resolved: 0 };
    const contactCols = await columnsOf(this.d.repo, contacts);
    if (!contactCols.has("first_name") || !contactCols.has("domain")) return { kind: "ran", resolved: 0 };
    const cols = await columnsOf(this.d.repo, table);
    const dsql = domainSql(cols);
    const titleOk = contactCols.has("title_match") ? "coalesce(c.title_match, true)" : "true";
    const resolved = await this.d.repo.withRun(run.run_id, async (tx) => {
      const r = await tx.query(
        `update ${table} t set first_name = c.first_name, last_name = c.last_name, lead_status = 'needs_email', status_changed_at = now()
         from ${contacts} c
         where t.run_id = $1 and t.lead_status = 'needs_person'
           and lower(coalesce(c.domain, '')) = ${dsql}
           and coalesce(c.first_name, '') <> ''
           and ${titleOk}`,
        [run.run_id],
      );
      return r.rowCount ?? 0;
    });
    return { kind: "ran", resolved };
  }
}
