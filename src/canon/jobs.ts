import type { Queryable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import { presentRun, type RunRow } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";

/** The job log (D52): runs as the service keeps them, read plainly. Counts and ids only. */
export interface JobLine {
  job_id: string;
  client_tag: string;
  lane: string;
  campaign_id: number | null;
  status: string;
  step: string | null;
  opened_by: string | null;
  opened_at: string;
  closed_at: string | null;
  is_grok_job: boolean;
  spend_cents: number;
}

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
}

export function jobLine(run: RunRow): JobLine {
  const shown = presentRun(run);
  return {
    job_id: run.run_id,
    client_tag: run.client_tag,
    lane: run.lane,
    campaign_id: run.campaign_id,
    status: shown.status,
    step: run.current_step,
    opened_by: run.opened_by,
    opened_at: run.opened_at,
    closed_at: run.closed_at,
    is_grok_job: Number(run.counts_by_status?.grok_job) === 1,
    spend_cents: Object.values(run.spend_cents_by_vendor ?? {}).reduce((a, b) => a + (Number(b) || 0), 0),
  };
}

export async function listJobs(repo: Pick<Repo, "listRuns">, clientTag?: string | null, limit = 20): Promise<JobLine[]> {
  return (await repo.listRuns(limit, clientTag ?? undefined)).map(jobLine);
}

export async function jobStatus(
  d: { repo: Pick<Repo, "getRun" | "openCardsForRun" | "raw">; ledger?: Pick<LaneLedger, "events"> },
  jobId: string,
): Promise<
  | { error: string }
  | {
      job: JobLine;
      counts: Record<string, number>;
      steps: Array<{ step: string; status: string; attempts: number; worst_case_cents: number | null; approved_cents: number | null; actual_cents: number | null; useful_output: number | null; counts: Record<string, number>; last_error: string | null }>;
      campaign_report: unknown;
      vendor_calls: unknown[];
      open_cards: Array<{ card_id: string; kind: string; step: string | null; worst_case_cents: number | null; audience: string }>;
      recent: string[];
    }
> {
  const run = await d.repo.getRun(jobId);
  if (!run) return { error: "no such job" };
  const db: Queryable = d.repo.raw();
  const { rows: steps } = await db.query<{ step: string; status: string; attempts: number; worst_case_cents: number | null; approved_cents: number | null; actual_cents: number | null; useful_output: number | null; counts: Record<string, unknown>; last_error: string | null }>(
    `select step, status, attempts, worst_case_cents, approved_cents, actual_cents, useful_output, counts, last_error from topup.run_steps where run_id = $1 order by started_at nulls last`,
    [jobId],
  );
  const cards = await d.repo.openCardsForRun(jobId);
  const size = steps.find((s) => s.step === "size");
  const pull = steps.find((s) => s.step === "pull");
  const report = (pull?.counts ?? size?.counts ?? {}) as Record<string, unknown>;
  const events = d.ledger ? await d.ledger.events(run.client_tag, run.lane, 10).catch(() => []) : [];
  return {
    job: jobLine(run),
    counts: numbers(run.counts_by_status),
    steps: steps.map((s) => ({ ...s, counts: numbers(s.counts), last_error: s.last_error ? s.last_error.slice(0, 200) : null })),
    campaign_report: Array.isArray(report.campaign_report) ? report.campaign_report : [],
    vendor_calls: Array.isArray((size?.counts as Record<string, unknown> | undefined)?.vendor_log) ? ((size!.counts as Record<string, unknown>).vendor_log as unknown[]) : [],
    open_cards: cards.map((c) => ({ card_id: c.card_id, kind: c.kind, step: typeof c.payload?.step === "string" ? (c.payload.step as string) : null, worst_case_cents: c.payload?.worst_case_cents == null ? null : Number(c.payload.worst_case_cents), audience: c.audience })),
    recent: (events as Array<{ at?: string; line?: string }>).map((e) => `${String(e.at ?? "").slice(0, 16)} ${e.line ?? ""}`.trim()),
  };
}

export async function spendRead(repo: Pick<Repo, "spentTodayCents" | "spendByVendor" | "spendMonthToDate" | "openCards">): Promise<{ today_cents: number; by_vendor_30d: Record<string, number>; month_to_date: unknown; waiting_for_approval: Array<{ card_id: string; run_id: string | null; step: string | null; worst_case_cents: number | null }>; rule: string }> {
  const [today, byVendor, mtd, cards] = await Promise.all([repo.spentTodayCents(), repo.spendByVendor(30), repo.spendMonthToDate(), repo.openCards("spend_approval")]);
  return {
    today_cents: today,
    by_vendor_30d: byVendor,
    month_to_date: mtd,
    waiting_for_approval: cards.map((c) => ({ card_id: c.card_id, run_id: c.run_id, step: typeof c.payload?.step === "string" ? (c.payload.step as string) : null, worst_case_cents: c.payload?.worst_case_cents == null ? null : Number(c.payload.worst_case_cents) })),
    rule: "Every paid call waits for a named approval. Pass approved_by on the verb with the name of the person who said yes; the ledger records it.",
  };
}
