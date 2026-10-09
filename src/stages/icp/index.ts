import type { IcpGate } from "../../clients/icpGate.js";
import { jevModel } from "../../clients/icpGate.js";
import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { spendApprovalCard } from "../../console/cards.js";
import type { Recipe } from "../../recipes/schema.js";
import { usd, worstCaseCents } from "../../spend/prices.js";
import type { SpendRails } from "../../spend/rails.js";
import { attempt, columnsOf, finish, park, realClock, type Clock, type StageDeps, type StageOutcome } from "../common.js";
import { domainSql } from "../puzzle/classify.js";

/**
 * Step 5.5 — the ICP website gate (D57; skill icp-website-gate). After
 * suppression and before anything paid: fetch each distinct domain's site
 * with our own edge function (free), let Jev pick a category (about $0.11
 * per 1,000 sites), ask DiscoLike about the sites we could not read (about
 * $0.0038 each), then write the verdict onto the rows. Only icp_gate = yes
 * moves on; no and unknown are suppressed with a reason and stay in the
 * table. Rows with no domain are left for enrich; run icp again after it.
 * Counts only; the lane's domains never leave Postgres except to the edge
 * functions, and never reach chat.
 */
export interface IcpDeps extends StageDeps {
  rails: SpendRails;
  gate: IcpGate | null;
  cfg: { jevModel: string; pollMs: number; deadMs: number };
  clock?: Clock;
}

export interface IcpVariant {
  jev_variant: string;
  disco_icp: string | null;
}

/** Statuses a row can be in before anything paid has touched it. */
export const ICP_STATUSES = ["ingested", "needs_domain", "needs_person", "needs_email", "email_found", "needs_verify"] as const;
const FETCH_PER_CALL = 100;
const FETCH_WORKERS = 30;
const FETCH_PARALLEL = 3;
const GRADE_PER_CALL = 300;
const GRADE_WORKERS = 20;
const MAX_CALLS = 120;
/** Share of a list the fetch usually cannot read; DiscoLike worst case is priced on this. */
const UNREADABLE_SHARE = 0.1;
const SITE_TEXT = "client_salesglider.icp_site_text";
const LLM_RESULTS = "client_salesglider.icp_llm_results";
const DISCO_MODEL = "discolike:website";

/** Worst case for n domains: Jev on every one, DiscoLike on the unreadable tenth. */
export function icpWorstCaseCents(domains: number): number {
  return worstCaseCents("jev", "grade", domains) + worstCaseCents("discolike", "validate_icp", Math.ceil(domains * UNREADABLE_SHARE));
}

export function icpBatchName(runId: string): string {
  return `job_${runId.slice(0, 8)}`;
}

export class IcpStage {
  private readonly clock: Clock;

  constructor(private readonly d: IcpDeps) {
    this.clock = d.clock ?? realClock;
  }

  async run(run: RunRow, _recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "icp", "suppressing", async (attempts) => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const cols = await columnsOf(this.d.repo, table);
      if (!cols.has("icp_gate")) throw new Error(`${table} has no icp_gate column; run migration 0019 (topup.install_lead_locks)`);
      if (!this.d.gate) return park(this.d, run, "icp", "the ICP gate is not configured on this service (ICP_SITE_FETCH_KEY, ICP_LLM_KEY, ICP_DISCO_KEY). Ask Josh.", attempts);
      const variant = await this.variant(run.client_tag);
      if (!variant) {
        return park(this.d, run, "icp", `no ICP variant for ${run.client_tag}: write the label set per skills/icp-website-gate (JEV_Q and PASS in icp-llm, then a row in topup.icp_variants). Ask Josh.`, attempts);
      }
      const dsql = domainSql(cols);
      const statuses = ICP_STATUSES.map((s) => `'${s}'`).join(", ");
      const scope = `run_id = $1 and lead_status in (${statuses}) and icp_gate is null`;
      const { rows: sized } = await db.query<{ domains: string; no_domain: string; rows: string }>(
        `select count(distinct ${dsql})::text as domains, count(*) filter (where ${dsql} is null)::text as no_domain, count(*)::text as rows from ${table} where ${scope}`,
        [run.run_id],
      );
      const domains = Number(sized[0]?.domains ?? 0);
      const noDomain = Number(sized[0]?.no_domain ?? 0);
      if (domains === 0) {
        return finish(this.d, run, "icp", 0, { domains: 0, no_domain: noDomain, passed: 0, flagged: 0 }, `ICP gate: nothing to grade (${noDomain} rows have no domain; enrich(job_id) first, then icp(job_id) again).`);
      }

      // Spend (D51): Jev plus the DiscoLike fallback, approved by name before either runs.
      const worst = icpWorstCaseCents(domains);
      const own = await this.d.repo.getStep(run.run_id, "icp");
      const approved = own?.approved_cents ?? 0;
      const spentToday = await this.d.repo.spentTodayCents();
      const decision = this.d.rails.decide(
        { runId: run.run_id, clientTag: run.client_tag, step: "icp", vendor: "jev", action: "grade", rows: domains, recipeAuthorised: true, approvedCents: approved, worstCaseCents: worst },
        spentToday,
      );
      if (decision.kind === "blocked") throw new Error(`icp blocked: ${decision.reason}`);
      if (worst > 0 && approved < worst) {
        const open = await this.d.repo.openCardsForRun(run.run_id);
        if (!open.some((card) => card.kind === "spend_approval" && card.payload.step === "icp")) {
          await this.d.console.ask({
            run,
            kind: "spend_approval",
            audience: "owner",
            payload: { step: "icp", vendor: "jev+discolike", action: "icp_gate", rows: domains, worst_case_cents: worst },
            text: `ICP gate on ${domains} domains: worst case ${usd(worst)} (Jev on every site, DiscoLike on the unreadable tenth).`,
            blocks: (cardId) =>
              spendApprovalCard({ cardId, runId: run.run_id, clientTag: run.client_tag, step: "icp", vendor: "jev + discolike", action: "icp_gate", rows: domains, worstCaseCents: worst, projectedUseful: null, spentTodayCents: spentToday, dailyCapCents: this.d.rails.cfg.dailyCapCents }),
          });
        }
        return { kind: "waiting", on: "owner", why: `ICP gate on ${domains} domains needs a named approval for a worst case of ${usd(worst)} (D51)`, worstCaseCents: worst };
      }

      const batch = icpBatchName(run.run_id);
      const model = jevModel(this.d.cfg.jevModel, variant.jev_variant);
      // 1. The distinct domains join the batch. A domain seen on an earlier batch keeps its fetched text and is re-pointed here so Jev grades it under this variant if it has not been.
      const ins = await db.query(
        `insert into ${SITE_TEXT} (domain, batch)
         select distinct ${dsql}, $2 from ${table} where ${scope} and ${dsql} is not null
         on conflict (domain) do update set batch = excluded.batch where ${SITE_TEXT}.http_status is distinct from -1`,
        [run.run_id, batch],
      );
      // 2. Fetch the sites (free). Up to three calls side by side; rows are claimed server side.
      let fetched = 0;
      let fetchedOk = 0;
      let remaining = Number.POSITIVE_INFINITY;
      for (let calls = 0; remaining > 0 && calls < MAX_CALLS; calls += FETCH_PARALLEL) {
        const results = await Promise.all(Array.from({ length: FETCH_PARALLEL }, () => this.d.gate!.fetchSites(batch, FETCH_PER_CALL, FETCH_WORKERS)));
        fetched += results.reduce((a, r) => a + r.processed, 0);
        fetchedOk += results.reduce((a, r) => a + r.ok, 0);
        remaining = Math.min(...results.map((r) => r.remaining));
        if (results.every((r) => r.processed === 0) && remaining > 0) break;
      }
      // 3. Jev picks a category. One call at a time per batch.
      let graded = 0;
      let gradeErrors = 0;
      let lastError: string | null = null;
      let left = Number.POSITIVE_INFINITY;
      let idle = 0;
      for (let calls = 0; left > 0 && calls < MAX_CALLS && idle < 2; calls++) {
        const r = await this.d.gate.grade(batch, model, GRADE_PER_CALL, GRADE_WORKERS);
        graded += r.processed;
        gradeErrors += r.errors;
        if (r.last_error) lastError = r.last_error;
        left = r.remaining;
        idle = r.processed === 0 ? idle + 1 : 0;
      }
      const jevCost = await this.costCents(batch, model);
      await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "icp", vendor: "jev", action: "grade", rows: graded, credits: graded, worstCaseCents: worst, balanceBefore: null, balanceAfter: null, vendorJobId: batch, approvedBy: null });
      // 4. DiscoLike on what we could not read. One task at a time.
      let fallback = 0;
      let fallbackTally: Record<string, number> = {};
      if (variant.disco_icp) {
        const sub = await this.d.gate.discoSubmit(batch, variant.disco_icp);
        fallback = sub.domains;
        if (sub.task_id) {
          const started = this.clock.now();
          for (;;) {
            if ((await this.d.repo.getRun(run.run_id))?.status === "aborted") return { kind: "stopped" };
            const c = await this.d.gate.discoCollect(sub.task_id, batch);
            if (c.status === "completed") {
              fallbackTally = c.tally ?? {};
              break;
            }
            if (this.clock.now() - started > this.d.cfg.deadMs) throw new Error(`DiscoLike task ${sub.task_id} still running after ${Math.round(this.d.cfg.deadMs / 60000)} min`);
            await this.clock.sleep(this.d.cfg.pollMs);
          }
          await this.d.rails.record({ runId: run.run_id, clientTag: run.client_tag, step: "icp", vendor: "discolike", action: "validate_icp", rows: fallback, credits: fallback, worstCaseCents: null, balanceBefore: null, balanceAfter: null, vendorJobId: sub.task_id, approvedBy: null });
        }
      }
      // 5. The verdict onto the rows; Jev's answer wins over DiscoLike's. Flagged rows are suppressed with a reason, never deleted.
      const written = await this.d.repo.withRun(run.run_id, async (tx) => {
        const v = await tx.query(
          `update ${table} t set icp_gate = v.fit, icp_gate_label = v.label, icp_gate_at = now()
           from (select distinct on (domain) domain, fit, coalesce(reason, model) as label
                   from ${LLM_RESULTS} where model in ($2, '${DISCO_MODEL}') and error is null and fit in ('yes', 'no')
                   order by domain, (model = $2) desc) v
           where t.run_id = $1 and t.lead_status in (${statuses}) and t.icp_gate is null and ${domainSql(cols, "t.")} = v.domain`,
          [run.run_id, model],
        );
        const u = await tx.query(
          `update ${table} set icp_gate = 'unknown', icp_gate_label = 'unreadable', icp_gate_at = now() where ${scope} and ${dsql} is not null`,
          [run.run_id],
        );
        const f = await tx.query(
          `update ${table} set lead_status = 'suppressed', status_changed_at = now(),
             qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('suppressed_reason', case when icp_gate = 'no' then 'off_icp' else 'icp_unreadable' end)
           where run_id = $1 and lead_status in (${statuses}) and icp_gate in ('no', 'unknown')`,
          [run.run_id],
        );
        return { verdicts: v.rowCount ?? 0, unknown: u.rowCount ?? 0, flagged: f.rowCount ?? 0 };
      });
      const { rows: labels } = await db.query<{ label: string | null; gate: string | null; n: string }>(
        `select icp_gate_label as label, icp_gate as gate, count(*)::text as n from ${table} where run_id = $1 and icp_gate_at >= now() - interval '1 day' group by 1, 2 order by 3 desc`,
        [run.run_id],
      );
      const byLabel: Record<string, number> = {};
      let passed = 0;
      let flaggedNo = 0;
      let unknown = 0;
      for (const l of labels) {
        const n = Number(l.n);
        byLabel[`label_${(l.label ?? "none").replace(/[^a-z0-9_]/gi, "_").slice(0, 40)}`] = (byLabel[`label_${(l.label ?? "none").replace(/[^a-z0-9_]/gi, "_").slice(0, 40)}`] ?? 0) + n;
        if (l.gate === "yes") passed += n;
        else if (l.gate === "no") flaggedNo += n;
        else unknown += n;
      }
      const samples = await this.samples(table, run.run_id, dsql);
      const counts: Record<string, number> = {
        domains,
        no_domain: noDomain,
        joined_batch: ins.rowCount ?? 0,
        fetched,
        fetched_ok: fetchedOk,
        graded,
        grade_errors: gradeErrors,
        fallback_domains: fallback,
        verdicts: written.verdicts,
        passed,
        flagged: flaggedNo,
        unknown,
        suppressed_by_icp: written.flagged,
        cost_cents: jevCost + worstCaseCents("discolike", "validate_icp", fallback),
        ...byLabel,
      };
      const line =
        `ICP gate (${variant.jev_variant}): ${domains} domains · fetched ${fetchedOk} of ${fetched} · Jev graded ${graded}${gradeErrors ? ` (${gradeErrors} errors${lastError ? `: ${lastError.slice(0, 80)}` : ""})` : ""}` +
        ` · DiscoLike ${fallback}${Object.keys(fallbackTally).length ? ` (${Object.entries(fallbackTally).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}` +
        ` · passed ${passed} · flagged ${flaggedNo} · unreadable ${unknown} · ${noDomain} rows had no domain (enrich, then icp again)` +
        ` · ${usd(counts.cost_cents)}` +
        (samples.flagged.length ? `\nflagged samples: ${samples.flagged.join("; ")}` : "") +
        (samples.passed.length ? `\npassed samples: ${samples.passed.join("; ")}` : "") +
        `\nIf one label swallows a big share, the label set is wrong: fix it before going further (icp-website-gate).`;
      return finish(this.d, run, "icp", passed, counts, line);
    });
  }

  private async variant(clientTag: string): Promise<IcpVariant | null> {
    try {
      const { rows } = await this.d.repo.raw().query<{ jev_variant: string; disco_icp: string | null }>(`select jev_variant, disco_icp from topup.icp_variants where client_tag = $1`, [clientTag]);
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  /** What Jev reports it cost for this batch and model, in cents, rounded up. */
  private async costCents(batch: string, model: string): Promise<number> {
    try {
      const { rows } = await this.d.repo.raw().query<{ usd: string | null }>(`select coalesce(sum(cost), 0)::text as usd from ${LLM_RESULTS} where batch = $1 and model = $2`, [batch, model]);
      return Math.ceil(Number(rows[0]?.usd ?? 0) * 100);
    } catch {
      return 0;
    }
  }

  /** The ten-sample rule (D2): at most ten flagged and four passed domains with their label, for the lane event line. Domains, never people. */
  private async samples(table: string, runId: string, dsql: string): Promise<{ flagged: string[]; passed: string[] }> {
    const pick = async (gate: string, limit: number) => {
      const { rows } = await this.d.repo.raw().query<{ d: string; label: string | null }>(
        `select distinct ${dsql} as d, icp_gate_label as label from ${table} where run_id = $1 and icp_gate = $2 and ${dsql} is not null order by 1 limit $3`,
        [runId, gate, limit],
      );
      return rows.map((r) => `${r.d} (${r.label ?? "?"})`);
    };
    try {
      return { flagged: await pick("no", 10), passed: await pick("yes", 4) };
    } catch {
      return { flagged: [], passed: [] };
    }
  }
}
