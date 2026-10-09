import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { Recipe } from "../../recipes/schema.js";
import type { DomainWaterfall } from "../../clients/domainWaterfall.js";
import { domainJobState } from "../../clients/domainWaterfall.js";
import type { PeopleWaterfall } from "../../clients/peopleWaterfall.js";
import { peopleJobState } from "../../clients/peopleWaterfall.js";
import { recipeAuthorises } from "../../recipes/schema.js";
import { PEOPLE_DEFAULT_ORDER } from "../../recipes/legacyLeadmagic.js";
import { peopleWaterfallWorstCaseCents, usd, worstCaseCents } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import { spendApprovalCard } from "../../console/cards.js";
import { attempt, columnsOf, finish, keepPhones, park, poll, realClock, statusCounts, type Clock, type StageDeps, type StageOutcome } from "../common.js";
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

      // D64: queue is what is sitting on the table now, not only this
      // attempt's updates from needs_email. Attempt 2 of job 46b1c941
      // classified 0 and skipped 19 already-queued needs_person rows.
      const queued = await statusCounts(this.d.repo, table, run.run_id);
      const needsDomain = queued.needs_domain ?? 0;
      const needsPerson = queued.needs_person ?? 0;
      const needsEmail = queued.needs_email ?? 0;
      const banked = await this.bankNames(run, table, cols);

      await this.registerQueues(run, table, needsDomain, needsPerson, needsEmail);

      const missing: string[] = [];
      if (needsDomain > 0 && !this.d.domain) missing.push(`${needsDomain} name-no-domain rows need Domain Waterfall (DOMAIN_WATERFALL_MCP_URL)`);
      if (needsPerson > 0 && !this.d.people) missing.push(`${needsPerson} domain-no-name rows need Find Named Person (PEOPLE_WATERFALL_MCP_URL)`);
      if (missing.length) {
        const reason = `Puzzle parked: ${missing.join("; ")}. Skills domain-waterfall / people-waterfall. Bound to ≤500 rows per job when those URLs are set.`;
        await this.d.repo.failStep(run.run_id, "puzzle", reason, true);
        return park(this.d, run, "puzzle", reason, attempts);
      }

      const spend = await this.askSpend(run, recipe, needsDomain, needsPerson);
      if (spend) return spend;

      let domainsResolved = 0;
      let peopleResolved = 0;
      let domainRan = false;
      let peopleRan = false;
      if (needsDomain > 0 && this.d.domain) {
        const n = await this.runDomain(run, recipe, table, needsDomain);
        if (n.kind !== "ran") return n;
        domainRan = true;
        domainsResolved = n.resolved;
      }
      if (needsPerson > 0 && this.d.people) {
        const n = await this.runPeople(run, recipe, table, needsPerson);
        if (n.kind !== "ran") return n;
        peopleRan = true;
        peopleResolved = n.resolved;
      }

      if (needsPerson > 0 && !peopleRan) {
        const reason = `Puzzle did not run Find Named Person on ${needsPerson} queued rows (0 of ${needsPerson} processed). Not done. Ask Josh.`;
        await this.d.repo.failStep(run.run_id, "puzzle", reason, true);
        return park(this.d, run, "puzzle", reason, attempts);
      }
      if (needsDomain > 0 && !domainRan) {
        const reason = `Puzzle did not run Domain Waterfall on ${needsDomain} queued rows (0 of ${needsDomain} processed). Not done. Ask Josh.`;
        await this.d.repo.failStep(run.run_id, "puzzle", reason, true);
        return park(this.d, run, "puzzle", reason, attempts);
      }

      const after = await statusCounts(this.d.repo, table, run.run_id);
      const counts = {
        classified_needs_domain: classified.needs_domain,
        classified_needs_person: classified.needs_person,
        needs_domain: needsDomain,
        needs_person: needsPerson,
        needs_email: needsEmail,
        banked,
        domains_resolved: domainsResolved,
        people_resolved: peopleResolved,
        people_ran: peopleRan ? 1 : 0,
        domain_ran: domainRan ? 1 : 0,
        ...Object.fromEntries(Object.entries(after).map(([k, v]) => [`after_${k}`, v])),
      };
      const line =
        `Puzzle: ${needsDomain} needed a domain · ${needsPerson} needed a person · ${needsEmail} already name+domain, no email · banked ${banked} names` +
        (domainsResolved || peopleResolved ? ` · resolved domain ${domainsResolved} / person ${peopleResolved}` : "") +
        `. People order ${PEOPLE_DEFAULT_ORDER.join(" → ")} (D58). Next is DiscoLike find emails (Name to Email is paused), then Email Waterfall.`;
      return finish(this.d, run, "puzzle", needsEmail + (after.needs_email ?? 0), counts, line);
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
        next_method: "discolike",
        registered_by: "puzzle",
      });
    }
  }

  /**
   * D64: paid puzzle work waits as spend_approval, not a parked card.
   * approved_by records the amount and the gate sees approvedCents.
   */
  private async askSpend(run: RunRow, recipe: Recipe, needsDomain: number, needsPerson: number): Promise<StageOutcome | null> {
    if (!this.d.rails) return null;
    let worst = 0;
    if (needsDomain > 0) worst += worstCaseCents("apify", "export", Math.min(500, needsDomain));
    if (needsPerson > 0) worst += peopleWaterfallWorstCaseCents(needsPerson);
    if (worst <= 0) return null;
    const own = await this.d.repo.getStep(run.run_id, "puzzle");
    const approved = own?.approved_cents ?? 0;
    const spentToday = await this.d.repo.spentTodayCents();
    const vendor = needsPerson > 0 && needsDomain > 0 ? "domain+people" : needsPerson > 0 ? "aiark_people" : "apify";
    const decision = this.d.rails.decide(
      {
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "puzzle",
        vendor: needsPerson > 0 ? "aiark_people" : "apify",
        action: "export",
        rows: needsPerson + needsDomain,
        recipeAuthorised:
          (needsDomain === 0 || recipeAuthorises(recipe, "puzzle", "apify")) &&
          (needsPerson === 0 || (recipeAuthorises(recipe, "puzzle", "aiark_people") && recipeAuthorises(recipe, "puzzle", "prospeo_search"))),
        approvedCents: approved,
        worstCaseCents: worst,
      },
      spentToday,
    );
    if (decision.kind === "blocked") throw new Error(`puzzle blocked: ${decision.reason}`);
    if (decision.kind === "proceed" || approved >= worst) return null;
    const open = await this.d.repo.openCardsForRun(run.run_id);
    const existing = open.find((card) => card.kind === "spend_approval" && card.payload.step === "puzzle");
    const payload = { step: "puzzle", vendor, action: "people_waterfall", rows: needsPerson + needsDomain, worst_case_cents: worst };
    const blocks = (cardId: string) =>
      spendApprovalCard({
        cardId,
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "puzzle",
        vendor,
        action: "people_waterfall",
        rows: needsPerson + needsDomain,
        worstCaseCents: worst,
        projectedUseful: null,
        spentTodayCents: spentToday,
        dailyCapCents: this.d.rails!.cfg.dailyCapCents,
      });
    if (existing) {
      await this.d.repo.updateCardPayload(existing.card_id, payload);
      await this.d.repo.setCardBlocks(existing.card_id, blocks(existing.card_id));
    } else {
      await this.d.console.ask({
        run,
        kind: "spend_approval",
        audience: "owner",
        payload,
        text: `Puzzle spend ${usd(worst)} (Find Named Person / Domain Waterfall) needs a named approval.`,
        blocks,
      });
    }
    return {
      kind: "waiting",
      on: "owner",
      why: `Find Named Person / Domain Waterfall estimate ${usd(worst)} is over the auto cap. Ask Josh.`,
      worstCaseCents: worst,
    };
  }

  private async runDomain(run: RunRow, recipe: Recipe, table: string, rows: number): Promise<StageOutcome | { kind: "ran"; resolved: number }> {
    const where = `run_id = '${run.run_id}' and lead_status = 'needs_domain'`;
    const quote = await this.d.domain!.estimate({ source_table: table, where, client_tag: run.client_tag, limit: 500 });
    const worst = this.d.rails ? worstCaseCents("apify", "export", Math.min(500, rows)) : 0;
    if (this.d.rails) {
      const approved = (await this.d.repo.getStep(run.run_id, "puzzle"))?.approved_cents ?? 0;
      const decision = await this.d.rails.gate({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "puzzle",
        vendor: "apify",
        action: "export",
        rows: Math.min(500, rows),
        recipeAuthorised: recipeAuthorises(recipe, "puzzle", "apify"),
        worstCaseCents: worst,
        approvedCents: approved,
      });
      if (decision.kind === "blocked") throw new Error(`domain waterfall blocked: ${decision.reason}`);
      if (decision.kind === "ask") {
        const reason = `Domain Waterfall estimate ${usd(decision.worstCaseCents)} (vendor quote ${quote.estimated_cost_usd ?? "n/a"}) is over the auto cap. Ask Josh.`;
        return { kind: "waiting", on: "owner", why: reason, worstCaseCents: decision.worstCaseCents };
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
    await keepPhones(this.d.repo, table, run.run_id, cols); // D56: the domain waterfall writes wf_phone too
    return { kind: "ran", resolved };
  }

  private async runPeople(run: RunRow, recipe: Recipe, table: string, rows: number): Promise<StageOutcome | { kind: "ran"; resolved: number }> {
    const where = `run_id = '${run.run_id}' and lead_status = 'needs_person'`;
    // D58: Find Named Person's default is site_staff → cache → discolike →
    // prospeo_search → aiark_people. Do not send a dropped-vendor filter
    // or ceiling; the people service no longer has those tiers.
    const quote = await this.d.people!.estimate({ source_table: table, where, client_tag: run.client_tag });
    const worst = this.d.rails ? peopleWaterfallWorstCaseCents(rows) : 0;
    if (this.d.rails) {
      const approved = (await this.d.repo.getStep(run.run_id, "puzzle"))?.approved_cents ?? 0;
      const decision = await this.d.rails.gate({
        runId: run.run_id,
        clientTag: run.client_tag,
        step: "puzzle",
        vendor: "aiark_people",
        action: "export",
        rows,
        recipeAuthorised: recipeAuthorises(recipe, "puzzle", "aiark_people") && recipeAuthorises(recipe, "puzzle", "prospeo_search"),
        worstCaseCents: worst,
        approvedCents: approved,
      });
      if (decision.kind === "blocked") throw new Error(`people waterfall blocked: ${decision.reason}`);
      if (decision.kind === "ask") {
        const reason = `Find Named Person estimate ${usd(decision.worstCaseCents)} (vendor quote ${quote.estimated_cost_usd ?? "n/a"}) is over the auto cap. Ask Josh.`;
        return { kind: "waiting", on: "owner", why: reason, worstCaseCents: decision.worstCaseCents };
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
    // D56: a phone the people waterfall found travels with the name.
    const phoneCols = ["cellphone", "wf_phone", "phone"].filter((c) => contactCols.has(c));
    const phoneSet = cols.has("phone") && phoneCols.length ? `phone = coalesce(nullif(t.phone, ''), ${phoneCols.map((c) => `nullif(c.${c}, '')`).join(", ")}), ` : "";
    const typeCols = ["line_type", "wf_phone_type"].filter((c) => contactCols.has(c));
    const typeSet = cols.has("phone_type") && typeCols.length ? `phone_type = coalesce(nullif(t.phone_type, ''), ${typeCols.map((c) => `nullif(c.${c}, '')`).join(", ")}), ` : "";
    const resolved = await this.d.repo.withRun(run.run_id, async (tx) => {
      const r = await tx.query(
        `update ${table} t set first_name = c.first_name, last_name = c.last_name, ${phoneSet}${typeSet}lead_status = 'needs_email', status_changed_at = now()
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
