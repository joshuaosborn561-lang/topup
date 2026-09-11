import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import { SENDABLE_LEAD_STATUSES } from "../../domain/leadStatus.js";
import type { Recipe } from "../../recipes/schema.js";
import { gateUnmet } from "../../spine/gate.js";
import { attempt, columnsOf, finish, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Step 10 — Stage for import (skill lead-list-build). Routed rows are written
 * to public.leads_staging with campaign_id, the merge fields, imported=false
 * and the dedupe key; the Smartlead import job reads from there and nowhere
 * else. Only `routed` rows are ever staged (SENDABLE_LEAD_STATUSES). Gate:
 * every routed row has a staging row for this run, on its campaign.
 *
 * first_name and company_name in staging are the conversational values
 * (first_name_n, company_n) because the copy's {{first_name}} and
 * {{company_name}} are what a person reads; the raw values stay on the lane
 * table. Flagged in the PR as a question for Josh (D26).
 */
export const STAGING_TABLE = "public.leads_staging";

export function dedupeKeySql(campaignExpr: string, emailExpr: string): string {
  return `md5(${campaignExpr}::text || '|' || lower(${emailExpr}))`;
}

export class StageStage {
  constructor(private readonly d: StageDeps) {}

  async run(run: RunRow, recipe: Recipe): Promise<StageOutcome> {
    return attempt(this.d, run, "stage", "staging", async () => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const { rows: t } = await db.query<{ ok: boolean }>(`select to_regclass('${STAGING_TABLE}') is not null as ok`);
      if (!t[0]?.ok) throw new Error(`${STAGING_TABLE} is not in this database; run the migrations (0007) on campaignintelligence first`);
      const staging = await columnsOf(this.d.repo, STAGING_TABLE);
      for (const c of ["campaign_id", "email", "first_name", "last_name", "company_name", "source_dedupe_key", "run_id"]) {
        if (!staging.has(c)) throw new Error(`${STAGING_TABLE} has no ${c} column; migration 0007 has not run`);
      }
      const lane = await columnsOf(this.d.repo, table);
      const sendable = SENDABLE_LEAD_STATUSES.map((s) => `'${s}'`).join(", ");
      const vendor = recipe.source.kind === "getleads" ? "getleads" : "supabase";

      // Column → source expression, only for columns staging actually has.
      const pairs: Array<[string, string]> = [
        ["campaign_id", "t.routed_campaign_id"],
        ["campaign_name", "c.name"],
        ["email", "t.email"],
        ["first_name", lane.has("first_name_n") ? "coalesce(nullif(t.first_name_n, ''), t.first_name)" : "t.first_name"],
        ["last_name", "t.last_name"],
        ["company_name", lane.has("company_n") ? "coalesce(nullif(t.company_n, ''), t.company_name)" : "t.company_name"],
        ["location", lane.has("location") ? "t.location" : "null"],
        ["local_sports_team", lane.has("local_sports_team") ? "t.local_sports_team" : "null"],
        ["job_title", lane.has("title") ? "t.title" : "null"],
        ["company_size", lane.has("company_size") ? "t.company_size" : "null"],
        ["vertical", lane.has("vertical") ? "t.vertical" : "null"],
        ["first_name_n", lane.has("first_name_n") ? "t.first_name_n" : "null"],
        ["company_n", lane.has("company_n") ? "t.company_n" : "null"],
        ["vendor", `'${vendor}'`],
        ["imported", "false"],
        ["purge", "false"],
        ["source_dedupe_key", dedupeKeySql("t.routed_campaign_id", "t.email")],
        ["run_id", "$1::uuid"],
      ].filter(([col]) => staging.has(col)) as Array<[string, string]>;
      const campaignsJoin = (await db.query<{ ok: boolean }>(`select to_regclass('public.campaigns') is not null as ok`)).rows[0]?.ok ? `left join public.campaigns c on c.smartlead_campaign_id = t.routed_campaign_id` : `left join (select null::bigint as smartlead_campaign_id, null::text as name) c on false`;

      const result = await this.d.repo.withRun(run.run_id, async (tx) => {
        const ins = await tx.query(
          `insert into ${STAGING_TABLE} (${pairs.map(([c]) => c).join(", ")})
           select ${pairs.map(([, e]) => e).join(", ")}
           from ${table} t ${campaignsJoin}
           where t.run_id = $1 and t.lead_status in (${sendable}) and t.routed_campaign_id is not null and coalesce(t.email, '') <> ''
           on conflict (source_dedupe_key) do nothing`,
          [run.run_id],
        );
        const upd = await tx.query(
          `update ${table} t set lead_status = 'staged', status_changed_at = now()
           where t.run_id = $1 and t.lead_status in (${sendable})
             and exists (select 1 from ${STAGING_TABLE} s where s.run_id = $1 and s.source_dedupe_key = ${dedupeKeySql("t.routed_campaign_id", "t.email")})`,
          [run.run_id],
        );
        const left = await tx.query<{ n: string }>(`select count(*)::text as n from ${table} where run_id = $1 and lead_status in (${sendable})`, [run.run_id]);
        return { inserted: ins.rowCount ?? 0, staged: upd.rowCount ?? 0, left: Number(left.rows[0]?.n ?? 0) };
      });

      const { rows: perCampaign } = await db.query<{ campaign: string; n: string }>(`select campaign_id::text as campaign, count(*)::text as n from ${STAGING_TABLE} where run_id = $1 group by 1 order by 1`, [run.run_id]);
      const stagedTotal = perCampaign.reduce((a, r) => a + Number(r.n), 0);
      const counts: Record<string, number> = { staged: stagedTotal, staged_this_pass: result.staged, staging_conflicts: result.left, ...Object.fromEntries(perCampaign.map((r) => [`staged_${r.campaign}`, Number(r.n)])) };
      if (result.left > 0) {
        return gateUnmet("stage", `${result.left} routed rows have no staging row for this run: their (campaign, email) key is already in ${STAGING_TABLE} from an earlier load. Routed ${stagedTotal + result.left}, staged ${stagedTotal}.`, counts);
      }
      const line = `Stage done: ${stagedTotal} rows in ${STAGING_TABLE}${perCampaign.map((r) => ` · #${r.campaign} ${r.n}`).join("")} · imported=false, waiting for the import job.`;
      return finish(this.d, run, "stage", stagedTotal, counts, line);
    });
  }
}
