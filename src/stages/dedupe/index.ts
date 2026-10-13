import { loadHeldKeys, rowIsHeld, type HeldKeys } from "../../canon/heldKeys.js";
import { ingestedTable } from "../../db/pool.js";
import type { RunRow } from "../../domain/runs.js";
import type { JobSettings } from "../../jobs/settings.js";
import { attempt, columnsOf, finish, type StageDeps, type StageOutcome } from "../common.js";

/**
 * Dedupe (D98, D99): remove everyone the client already has before anything
 * is spent. The held set is every lead this client holds anywhere: the
 * Smartlead mirror and its sends, staging, provenance, the DNC list, the
 * lane table (other jobs), the client schema and the waterfall people
 * tables. Match by email first; by normalized name plus company when a row
 * has no address. Held rows stay in the table as lead_status 'held' with
 * the reason; nothing is deleted. Identifiers stay in process memory and
 * are never logged. Free.
 */
export const HELD_STATUS = "held";
const PAGE = 5000;

interface PoolRow {
  id: string;
  email: string | null;
  linkedin: string | null;
  first: string | null;
  last: string | null;
  company: string | null;
}

export class DedupeStage {
  constructor(private readonly d: StageDeps) {}

  async run(run: RunRow, settings: JobSettings): Promise<StageOutcome> {
    return attempt(this.d, run, "dedupe", "suppressing", async () => {
      const table = ingestedTable(run.client_tag);
      const db = this.d.repo.raw();
      const cols = await columnsOf(this.d.repo, table);
      const keys: HeldKeys = await loadHeldKeys(db, settings.smartlead_client_id, run.client_tag, { runId: run.run_id });
      const first = cols.has("first_name") ? "first_name" : "null::text";
      const last = cols.has("last_name") ? "last_name" : "null::text";
      const company = cols.has("company_name") ? "company_name" : "null::text";
      const linkedin = ["linkedin_url", "linkedin_profile"].find((c) => cols.has(c)) ?? "null::text";
      let raw = 0;
      let held = 0;
      let heldByEmail = 0;
      let heldByPerson = 0;
      let lastId: string | null = null;
      for (;;) {
        const rows: PoolRow[] = (
          await db.query<PoolRow>(
          `select id::text as id, email, ${linkedin} as linkedin, ${first} as first, ${last} as last, ${company} as company
             from ${table} where run_id = $1 and lead_status = 'ingested'${lastId ? " and id::text > $2" : ""}
            order by id::text limit ${PAGE}`,
            lastId ? [run.run_id, lastId] : [run.run_id],
          )
        ).rows;
        if (rows.length === 0) break;
        raw += rows.length;
        lastId = rows[rows.length - 1]!.id;
        const hit: string[] = [];
        for (const r of rows) {
          if (!rowIsHeld(r, keys)) continue;
          hit.push(r.id);
          const byEmail = r.email ? keys.emails.has(r.email.trim().toLowerCase()) : false;
          if (byEmail) heldByEmail += 1;
          else heldByPerson += 1;
        }
        if (hit.length) {
          await this.d.repo.withRun(run.run_id, (tx) =>
            tx.query(
              `update ${table} set lead_status = '${HELD_STATUS}', status_changed_at = now(),
                 qa_flags = coalesce(qa_flags, '{}'::jsonb) || '{"held_reason": "client_already_has"}'::jsonb
               where run_id = $1 and id::text = any($2::text[]) and lead_status = 'ingested'`,
              [run.run_id, hit],
            ),
          );
          held += hit.length;
        }
      }
      const counts: Record<string, number> = { raw, held, held_by_email: heldByEmail, held_by_person: heldByPerson, net_new_after_held: raw - held, held_set_emails: keys.emails.size, held_set_people: keys.nameCompanies.size };
      const line = `Dedupe done: ${raw} in the pool · ${held} already held by the client (${heldByEmail} by email, ${heldByPerson} by name and company) · ${raw - held} go on to unsubscribes.`;
      return finish(this.d, run, "dedupe", raw - held, counts, line);
    });
  }
}
