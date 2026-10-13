import type { Repo } from "../../db/repo.js";
import type { RunRow } from "../../domain/runs.js";
import type { JobSettings } from "../../jobs/settings.js";

/**
 * After a load, the service writes itself down (D99): one row in
 * topup.list_build_records on the campaign, counts only, so the next
 * top-up reads what happened as part of the record. No transcript (the
 * job's event log is in topup.lane_events). A failed insert never fails
 * the import: the leads are already in Smartlead.
 */
export async function writeTopupRecord(
  repo: Pick<Repo, "raw">,
  run: RunRow,
  settings: JobSettings,
  counts: Record<string, number>,
  by: string,
): Promise<number | null> {
  const spend = Object.values(run.spend_cents_by_vendor ?? {}).reduce((a, n) => a + (Number(n) || 0), 0);
  const c = run.counts_by_status ?? {};
  const narrative =
    `Top-up by the leadtopup service on ${new Date().toISOString().slice(0, 10)} (job ${run.run_id.slice(0, 8)}, approved by ${by}). ` +
    `Pool handed over by Grokbot as ${settings.source.kind === "file_url" ? `${settings.source.urls.length} file(s)` : `table ${settings.source.table}`}, replaying this campaign's recorded build. ` +
    `Ingested ${Number(c.rows_claimed ?? 0)}; already held by the client ${Number(c.held ?? 0)}; unsubscribed or on the DNC list ${Number(c.suppressed ?? 0)}; duplicates ${Number(c.deduped ?? 0)}; ` +
    `ICP website check passed ${Number(c.icp_passed ?? 0)}, flagged ${Number(c.icp_flagged ?? 0)}; verified sendable ${Number(c.verified ?? 0)}; staged ${Number(c.staged ?? 0)}; imported ${Number(counts.imported ?? 0)}. ` +
    `Spend ${(spend / 100).toFixed(2)} USD. Same method as the record above; nothing widened.`;
  const { rows } = await repo.raw().query<{ id: number }>(
    `insert into topup.list_build_records (client_tag, campaign_ids, lanes, narrative, transcript_path, transcript_format, spend_cents, yield_by_step, session_date, written_by, provenance_confidence)
     values ($1, $2::bigint[], $3::text[], $4, null, null, $5, $6::jsonb, current_date, 'leadtopup', 'service_topup')
     returning id`,
    [run.client_tag, settings.campaign_ids.length ? settings.campaign_ids : [settings.campaign_id], [run.lane], narrative, spend, JSON.stringify({ ...c, imported: counts.imported ?? 0 })],
  );
  return rows[0]?.id ?? null;
}
