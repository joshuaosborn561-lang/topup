import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { LaneLedger } from "../../ledger/lane.js";
import type { Recipe } from "../../recipes/schema.js";
import { qaHoldCard, qaSummaryBlocks } from "../../slack/cards.js";
import { attempt, columnsOf, finish, statusCounts, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 8 — QA (skill lead-list-build; skill lead-list-qa). Cayden clears the
 * holds. Rules are data in topup.qa_rules; the recipe names which apply.
 *
 *   purge    silent, counted (junk titles, retail and school districts)
 *   hold     one card per rule to Cayden with up to ten sample values —
 *            company names or titles, never an address; Accept, Purge, or
 *            Reroute when the recipe maps the rule's target to a campaign
 *   reroute  the skill's automatic reroute is a hold here with Reroute
 *            offered as the primary tap: a row leaving the lane for another
 *            offer is a human tap in this service, not a silent move (D26)
 *
 * Rows step 7 held for an empty merge field are one more hold group,
 * `merge_field_empty`. Gate: the ten-row sample posts in the thread and every
 * hold has a resolution; the step does not finish while a hold card is open.
 * Silence never means yes.
 */
export interface QaDeps extends StageDeps {
  ledger?: LaneLedger;
}

export interface QaRule {
  rule_id: string;
  action: "purge" | "hold" | "reroute";
  field: string;
  pattern: string;
  scope: string | null;
  reroute_to: string | null;
  reason: string | null;
}

/** qa_rules.field → column on lp.<tag>_ingested_leads. */
export const QA_FIELD_COLUMN: Readonly<Record<string, string>> = {
  title: "title",
  job_title: "title",
  company_name: "company_name",
  company_n: "company_n",
  industry: "industry",
  vertical: "vertical",
  local_sports_team: "local_sports_team",
};

export const MERGE_FIELD_EMPTY_RULE = "merge_field_empty";

/**
 * A rule's scope: null or this client → every row; `gift:<tier>` → rows the
 * normalizer put in that gift tier; another client's tag → not this lane.
 */
export function scopeSql(scope: string | null, clientTag: string): { sql: string; params: unknown[] } | null {
  if (scope === null || scope === clientTag) return { sql: "true", params: [] };
  const gift = /^gift:([a-z_]+)$/.exec(scope);
  if (gift) return { sql: `coalesce(normalize_flags->'gift_tier', '[]'::jsonb) ? $P`, params: [gift[1]] };
  return null;
}

export class QaStage {
  constructor(private readonly d: QaDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "qa", "qa", async () => {
      const table = ingestedTable(run.client_tag);
      const cols = await columnsOf(this.d.repo, table);
      const rules = await this.rules(recipe);
      const skipped: string[] = [];
      const applied: Array<{ ruleId: string; action: string; count: number; samples: string[] }> = [];

      // Step 7's holds join the queue under one group name.
      await this.d.repo.withRun(run.run_id, (tx) =>
        tx.query(
          `update ${table} set qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('hold_rule', $2::text)
           where run_id = $1 and lead_status = 'qa_hold' and qa_flags ? 'merge_field_empty' and not (qa_flags ? 'hold_rule')`,
          [run.run_id, MERGE_FIELD_EMPTY_RULE],
        ),
      );

      const order = (a: QaRule) => (a.action === "purge" ? 0 : 1);
      for (const rule of [...rules].sort((a, b) => order(a) - order(b))) {
        const col = QA_FIELD_COLUMN[rule.field];
        if (!col || !cols.has(col)) {
          skipped.push(`${rule.rule_id} (field ${rule.field} is not a column here)`);
          continue;
        }
        const scope = scopeSql(rule.scope, run.client_tag);
        if (!scope) {
          skipped.push(`${rule.rule_id} (scope ${rule.scope} is another client)`);
          continue;
        }
        const scopeClause = scope.sql.replace("$P", "$4");
        const params = [run.run_id, rule.pattern, rule.rule_id, ...scope.params];
        const where = `run_id = $1 and lead_status = 'normalized' and coalesce(${col}::text, '') ~* $2 and ${scopeClause}`;
        const [status, flag] = rule.action === "purge" ? ["qa_purged", "purge_rule"] : ["qa_hold", "hold_rule"];
        const matched = await this.d.repo.withRun(run.run_id, async (tx) => {
          const { rows } = await tx.query<{ v: string }>(
            `with hit as (update ${table} set lead_status = '${status}', status_changed_at = now(),
               qa_flags = coalesce(qa_flags, '{}'::jsonb) || jsonb_build_object('${flag}', $3::text)
               where ${where} returning ${col}::text as v)
             select v from hit`,
            params,
          );
          return rows.map((r) => r.v);
        });
        if (matched.length) applied.push({ ruleId: rule.rule_id, action: rule.action, count: matched.length, samples: distinct(matched, 10) });
      }

      const passed = await this.d.repo.withRun(run.run_id, async (tx) => {
        const r = await tx.query(`update ${table} set lead_status = 'qa_passed', status_changed_at = now() where run_id = $1 and lead_status = 'normalized'`, [run.run_id]);
        return r.rowCount ?? 0;
      });

      // The ten-row sample in the thread, once per run (the first pass through the step).
      const own = await this.d.repo.getStep(run.run_id, "qa");
      if (!own?.counts.summary_posted) {
        const summaryRows = [...applied];
        const mergeHeld = await this.holdGroups(table, run.run_id);
        const mfe = mergeHeld.find((g) => g.rule === MERGE_FIELD_EMPTY_RULE);
        if (mfe) summaryRows.push({ ruleId: MERGE_FIELD_EMPTY_RULE, action: "hold", count: mfe.count, samples: mfe.samples });
        await this.d.console.postInThread(run, `Step 8 QA: ${passed} passed · ${summaryRows.length} rule groups`, qaSummaryBlocks({ clientTag: run.client_tag, runId: run.run_id, rows: summaryRows, passed }));
        await this.d.repo.mergeStepCounts(run.run_id, "qa", { summary_posted: 1, ...Object.fromEntries(applied.map((a) => [`qa_${a.action}_${a.ruleId}`, a.count])) });
      }

      // Every hold group with rows still waiting gets exactly one open card.
      const groups = await this.holdGroups(table, run.run_id);
      if (groups.length > 0) {
        const open = await this.d.repo.openCardsForRun(run.run_id);
        for (const g of groups) {
          if (open.some((c) => c.kind === "qa_hold" && c.payload.rule_id === g.rule)) continue;
          const rule = rules.find((r) => r.rule_id === g.rule);
          const rerouteTo = rule?.reroute_to ?? null;
          const rerouteCampaign = rerouteTo ? recipe.reroute[rerouteTo] ?? null : null;
          const reason = g.rule === MERGE_FIELD_EMPTY_RULE ? `A required merge field came out empty in step 7${g.fields ? ` (${g.fields})` : ""}. Accept sends them with the field blank; Purge drops them.` : rule?.reason ?? g.rule;
          await this.d.console.ask({
            run,
            kind: "qa_hold",
            audience: "operator",
            payload: { step: "qa", rule_id: g.rule, count: g.count, reroute_to: rerouteTo, reroute_campaign_id: rerouteCampaign },
            text: `QA hold ${g.rule}: ${g.count} leads`,
            blocks: (cardId) => qaHoldCard({ cardId, runId: run.run_id, clientTag: run.client_tag, ruleId: g.rule, reason, count: g.count, samples: g.samples, rerouteTo: rerouteCampaign ? `${rerouteTo} (#${rerouteCampaign})` : null }),
          });
        }
        await this.d.ledger?.block(run.client_tag, run.lane, "operator", `${groups.length} QA hold group(s) open: ${groups.map((g) => `${g.rule} ${g.count}`).join(", ")}`, run.run_id);
        return { kind: "waiting", on: "operator", why: `${groups.reduce((a, g) => a + g.count, 0)} leads held in ${groups.length} group(s)` };
      }

      const c = await statusCounts(this.d.repo, table, run.run_id);
      const counts: Record<string, number> = {
        qa_passed: c.qa_passed ?? 0,
        qa_purged: c.qa_purged ?? 0,
        qa_rerouted: await this.rerouted(table, run.run_id),
        ...Object.fromEntries(applied.map((a) => [`qa_${a.action}_${a.ruleId}`, a.count])),
      };
      await this.d.ledger?.unblock(run.client_tag, run.lane, "Every QA hold has a resolution.", run.run_id);
      const line = `QA done: ${counts.qa_passed} passed · ${counts.qa_purged} purged · ${counts.qa_rerouted} rerouted by tap${skipped.length ? ` · rules not applied: ${skipped.join("; ")}` : ""}.`;
      return finish(this.d, run, "qa", counts.qa_passed, counts, line);
    });
  }

  private async rules(recipe: Recipe): Promise<QaRule[]> {
    if (recipe.qa.length === 0) return [];
    const { rows } = await this.d.repo.raw().query<QaRule>(`select rule_id, action, field, pattern, scope, reroute_to, reason from topup.qa_rules where rule_id = any($1::text[]) and enabled order by rule_id`, [recipe.qa]);
    const missing = recipe.qa.filter((id) => !rows.some((r) => r.rule_id === id));
    if (missing.length) throw new Error(`recipe names QA rules that are not in topup.qa_rules (or are disabled): ${missing.join(", ")}`);
    return rows;
  }

  /** Rows still on hold, by hold rule, with up to ten sample company names / titles. */
  private async holdGroups(table: string, runId: string): Promise<Array<{ rule: string; count: number; samples: string[]; fields: string | null }>> {
    const { rows } = await this.d.repo.raw().query<{ rule: string; n: string; samples: string[] | null; fields: string | null }>(
      `select coalesce(qa_flags->>'hold_rule', 'unknown') as rule, count(*)::text as n,
              (array_agg(distinct coalesce(nullif(company_n, ''), nullif(company_name, ''), nullif(title, ''), '(blank)')))[1:10] as samples,
              string_agg(distinct f.x, ', ') as fields
       from ${table} left join lateral jsonb_array_elements_text(coalesce(qa_flags->'merge_field_empty', '[]'::jsonb)) f(x) on true
       where run_id = $1 and lead_status = 'qa_hold' group by 1 order by 1`,
      [runId],
    );
    return rows.map((r) => ({ rule: r.rule, count: Number(r.n), samples: r.samples ?? [], fields: r.fields }));
  }

  private async rerouted(table: string, runId: string): Promise<number> {
    const { rows } = await this.d.repo.raw().query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status = 'routed' and qa_flags ? 'rerouted_by'`, [runId]);
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * A tap on a hold card: every row of the run still held under that rule
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
      else if (choice === "reroute") {
        const campaign = Number(payload.reroute_campaign_id);
        if (!Number.isInteger(campaign) || campaign <= 0) throw new Error(`reroute tapped on ${rule} but the card names no campaign`);
        r = await tx.query(`update ${table} set lead_status = 'routed', routed_campaign_id = $4, status_changed_at = now(), qa_flags = qa_flags || jsonb_build_object('rerouted_by', $3::text) ${where}`, [run.run_id, rule, by, campaign]);
      } else return 0;
      return r.rowCount ?? 0;
    });
  }
}

function distinct(values: string[], n: number): string[] {
  const out: string[] = [];
  for (const v of values) {
    const s = (v ?? "").trim() || "(blank)";
    if (!out.includes(s)) out.push(s);
    if (out.length >= n) break;
  }
  return out;
}
