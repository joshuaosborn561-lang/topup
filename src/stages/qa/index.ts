import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { JobSettings } from "../../jobs/settings.js";
import { qaHoldCard, qaSummaryBlocks } from "../../console/cards.js";
import { attempt, finish, statusCounts, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 8 — QA. The rows step 7 held for an empty required merge field go to
 * a person as one card per hold group with up to ten sample company names
 * or titles, never an address: Accept sends them with the field blank,
 * Purge drops them. There is no rule table and no reroute (D109): what a
 * list may or may not hold is in the transcript, and Grokbot applies it
 * before the pool is handed over. Gate: every hold has a resolution; the
 * step does not finish while a hold card is open. Silence never means yes.
 */
export interface QaDeps extends StageDeps {
  ledger?: LaneLedger;
}

export const MERGE_FIELD_EMPTY_RULE = "merge_field_empty";

export class QaStage {
  constructor(private readonly d: QaDeps) {}

  async run(run: RunRow, _settings: JobSettings): Promise<StageOutcome> {
    return attempt(this.d, run, "qa", "qa", async () => {
      const table = ingestedTable(run.client_tag);

      // Step 7's holds join the queue under one group name.
      await this.d.repo.withRun(run.run_id, (tx) =>
        tx.query(
          `update ${table} set qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('hold_rule', $2::text)
           where run_id = $1 and lead_status = 'qa_hold' and qa_flags ? 'merge_field_empty' and not (qa_flags ? 'hold_rule')`,
          [run.run_id, MERGE_FIELD_EMPTY_RULE],
        ),
      );

      const passed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const r = await tx.query(`update ${table} set lead_status = 'qa_passed', status_changed_at = now() where run_id = $1 and lead_status = 'normalized'`, [run.run_id]);
        return r.rowCount ?? 0;
      });

      // The ten-row sample in the thread, once per run (the first pass through the step).
      const own = await this.d.repo.getStep(run.run_id, "qa");
      if (!own?.counts.summary_posted) {
        const held = await this.holdGroups(table, run.run_id);
        const summaryRows = held.map((g) => ({ ruleId: g.rule, action: "hold", count: g.count, samples: g.samples }));
        await this.d.console.postInThread(run, `Step 8 QA: ${passed} passed · ${summaryRows.length} hold group(s)`, qaSummaryBlocks({ clientTag: run.client_tag, runId: run.run_id, rows: summaryRows, passed }));
        await this.d.repo.mergeStepCounts(run.run_id, "qa", { summary_posted: 1 });
      }

      // Every hold group with rows still waiting gets exactly one open card.
      const groups = await this.holdGroups(table, run.run_id);
      if (groups.length > 0) {
        const open = await this.d.repo.openCardsForRun(run.run_id);
        for (const g of groups) {
          if (open.some((c) => c.kind === "qa_hold" && c.payload.rule_id === g.rule)) continue;
          const reason = g.rule === MERGE_FIELD_EMPTY_RULE ? `A required merge field came out empty in step 7${g.fields ? ` (${g.fields})` : ""}. Accept sends them with the field blank; Purge drops them.` : g.rule;
          await this.d.console.ask({
            run,
            kind: "qa_hold",
            audience: "operator",
            payload: { step: "qa", rule_id: g.rule, count: g.count },
            text: `QA hold ${g.rule}: ${g.count} leads`,
            blocks: (cardId) => qaHoldCard({ cardId, runId: run.run_id, clientTag: run.client_tag, ruleId: g.rule, reason, count: g.count, samples: g.samples, rerouteTo: null }),
          });
        }
        await this.d.ledger?.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "blocked", line: `${groups.length} QA hold group(s) open: ${groups.map((g) => `${g.rule} ${g.count}`).join(", ")}`, actor: "service" }).catch(() => undefined);
        return { kind: "waiting", on: "operator", why: `${groups.reduce((a, g) => a + g.count, 0)} leads held in ${groups.length} group(s)` };
      }

      const c = await statusCounts(this.d.repo, table, run.run_id);
      const counts: Record<string, number> = { qa_passed: c.qa_passed ?? 0, qa_purged: c.qa_purged ?? 0 };
      await this.d.ledger?.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "unblocked", line: "Every QA hold has a resolution.", actor: "service" }).catch(() => undefined);
      return finish(this.d, run, "qa", counts.qa_passed, counts, `QA done: ${counts.qa_passed} passed · ${counts.qa_purged} purged.`);
    });
  }

  /** Rows still on hold, by hold group, with up to ten sample company names / titles. */
  private async holdGroups(table: string, runId: string): Promise<Array<{ rule: string; count: number; samples: string[]; fields: string | null }>> {
    const { rows } = await this.d.repo.raw().query<{ rule: string; n: string; samples: string[] | null; fields: string | null }>(qaHoldGroupsSql(table), [runId]);
    return rows.map((r) => ({ rule: r.rule, count: Number(r.n), samples: r.samples ?? [], fields: r.fields }));
  }

  /**
   * A tap on a hold card: every row of the run still held under that group
   * takes the choice. Called by the orchestrator, then the run is driven on.
   */
  async applyTap(run: RunRow, payload: Record<string, unknown>, choice: string, by: string): Promise<number> {
    const table = ingestedTable(run.client_tag);
    const rule = String(payload.rule_id ?? "");
    if (!rule) return 0;
    return this.d.repo.withRun(run.run_id, async (tx) => {
      const where = `where run_id = $1 and lead_status = 'qa_hold' and qa_flags->>'hold_rule' = $2`;
      let r;
      if (choice === "accept") r = await tx.query(`update ${table} set lead_status = 'qa_passed', status_changed_at = now(), qa_flags = qa_flags || jsonb_build_object('accepted_by', $3::text) ${where}`, [run.run_id, rule, by]);
      else if (choice === "purge") r = await tx.query(`update ${table} set lead_status = 'qa_purged', status_changed_at = now(), qa_flags = qa_flags || jsonb_build_object('purged_by', $3::text) ${where}`, [run.run_id, rule, by]);
      else return 0;
      return r.rowCount ?? 0;
    });
  }
}

/**
 * QA hold groups for one job (D65). Count is distinct rows of this
 * run_id, never the whole lane table and never multiplied by the
 * merge_field_empty array (147 × 4 fields was 588 on card 419e7169).
 */
export function qaHoldGroupsSql(table: string): string {
  return `select coalesce(qa_flags->>'hold_rule', 'unknown') as rule, count(*)::text as n,
              (array_agg(distinct coalesce(nullif(company_n, ''), nullif(company_name, ''), nullif(title, ''), '(blank)')))[1:10] as samples,
              string_agg(distinct fields, ', ') as fields
       from (
         select qa_flags, company_n, company_name, title,
                (select string_agg(distinct x, ', ') from jsonb_array_elements_text(coalesce(qa_flags->'merge_field_empty', '[]'::jsonb)) x) as fields
           from ${table}
          where run_id = $1 and lead_status = 'qa_hold'
       ) job_holds
       group by 1 order by 1`;
}
