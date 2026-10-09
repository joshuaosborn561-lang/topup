import type { Console } from "./console/console.js";
import { ingestedTable } from "./db/pool.js";
import type { Repo } from "./db/repo.js";
import { orderCounts, presentRun, runIsOpen, type Role, type RunRow, type Step } from "./domain/runs.js";
import type { Stages } from "./jobs/runner.js";
import type { LaneLedger } from "./ledger/lane.js";
import { logger } from "./lib/log.js";
import { campaignReportFromCounts, type CampaignReportEntry } from "./stages/report.js";
import { stepLabel } from "./spine/steps.js";

const log = logger("orchestrator");

export interface ResolvedCard {
  card_id: string;
  kind: string;
  run_id: string | null;
  choice: string;
  by: string;
}

export interface Hold {
  card_id: string;
  kind: string;
  audience: Role;
  run_id: string | null;
  client_tag: string | null;
  age_minutes: number;
  summary: string;
  campaign_report: CampaignReportEntry[];
}

/**
 * What is left of the orchestrator (D53): the effect of a resolved card on
 * its run, abort, resume, and the open holds. It never drives a run. A job
 * moves when Grok calls the next verb, and nothing opens on its own (D51).
 */
export class Orchestrator {
  constructor(
    private readonly d: {
      repo: Repo;
      console: Console;
      stages: Stages;
      ledger?: LaneLedger;
    },
  ) {}

  private async ledger(fn: (l: LaneLedger) => Promise<unknown>): Promise<void> {
    if (!this.d.ledger) return;
    try {
      await fn(this.d.ledger);
    } catch (err) {
      log.error("ledger write failed", { error: (err as Error).message });
    }
  }

  /** A card was resolved through the console (D18). Apply what the choice means to the run, then stop: the next verb moves it. */
  async applyResolution(card: ResolvedCard): Promise<{ effect: string }> {
    const run = card.run_id ? await this.d.repo.getRun(card.run_id) : null;
    if (run) {
      await this.ledger((l) =>
        l.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "card_resolved", line: `${card.kind} card: ${card.choice} by ${card.by}.`, actor: card.by, detail: { card_id: card.card_id } }),
      );
    }
    if (!run) return { effect: "no run on this card" };
    switch (card.choice) {
      case "approve_spend": {
        const full = await this.d.repo.getCard(card.card_id);
        const step = (typeof full?.payload.step === "string" ? (full.payload.step as Step) : null) ?? run.current_step ?? null;
        const cents = Number(full?.payload.worst_case_cents ?? 0);
        if (!step) return { effect: "no step on the card" };
        await this.d.repo.approveStep(run.run_id, step, cents);
        await this.d.repo.setRunStatus(run.run_id, "open", step);
        return { effect: `${step} approved for $${(cents / 100).toFixed(2)} by ${card.by}; the same verb runs it` };
      }
      case "decline_spend":
        return { effect: "declined; the verb closes the job as declined when it runs" };
      case "accept":
      case "purge":
      case "reroute": {
        const full = await this.d.repo.getCard(card.card_id);
        if (!full || full.kind !== "qa_hold") return { effect: "not a QA hold" };
        const n = await this.d.stages.qa.applyTap(run, full.payload, card.choice, card.by);
        await this.d.console.postInThread(run, `QA ${card.choice} on ${String(full.payload.rule_id)} by ${card.by}: ${n} leads.`);
        return { effect: `${n} held leads: ${card.choice}; qa(job_id) again` };
      }
      case "resume":
      case "resume_run": {
        const r = await this.resumeRun(run.run_id, card.by);
        return { effect: r.ok ? `${r.step ?? "the current step"} has its attempts back; run its verb again` : r.message };
      }
      case "abort": {
        if (card.kind === "stall") return { effect: "the verify stage handles abort of a batch itself" };
        const r = await this.abortRun(run.run_id, card.by);
        return { effect: r.ok ? `aborted; ${r.released} rows released` : r.message };
      }
      default:
        return { effect: `${card.choice} recorded; nothing else changes` };
    }
  }

  /**
   * Abort any open run or job. Running steps are cancelled, claimed rows go
   * back to the queue, open cards on the run are resolved as aborted through
   * the console, and the receipt is written to the ledger.
   */
  async abortRun(runId: string, by: string): Promise<{ ok: true; run: RunRow; released: number } | { ok: false; message: string }> {
    const run = await this.d.repo.getRun(runId);
    if (!run) return { ok: false, message: "no such run" };
    if (!runIsOpen(presentRun(run).status)) return { ok: false, message: `run ${runId.slice(0, 8)} is already ${presentRun(run).status}` };
    await this.d.repo.cancelRunningSteps(runId, `aborted by ${by}`);
    const released = await this.releaseClaimedRows(run);
    for (const card of await this.d.repo.openCardsForRun(runId)) {
      if (card.kind === "stall") continue;
      await this.d.console.resolveAs(by, "operator", card.card_id, "abort").catch(() => undefined);
    }
    await this.d.repo.setRunStatus(runId, "aborted", undefined, `aborted by ${by}`);
    const closed = (await this.d.repo.getRun(runId))!;
    await this.closeWithReceipt(closed, `Aborted by ${by}. ${released} unverified rows returned to needs_verify. Nothing was sent.`, "Nothing queued.");
    return { ok: true, run: closed, released };
  }

  /** Give a parked or waiting step its attempts back and mark the run open. Nothing runs until the next verb. */
  async resumeRun(runId: string, by: string): Promise<{ ok: true; run: RunRow; step: Step | null } | { ok: false; message: string }> {
    const run = await this.d.repo.getRun(runId);
    if (!run) return { ok: false, message: "no such run" };
    const shown = presentRun(run);
    if (!runIsOpen(shown.status)) return { ok: false, message: `run ${runId.slice(0, 8)} is ${shown.status}; a closed run is not resumed. Open a new job.` };
    const step = run.current_step;
    if (step) await this.d.repo.resetStep(runId, step);
    await this.d.repo.setRunStatus(runId, "open", step ?? undefined);
    await this.ledger((l) => l.event({ client_tag: run.client_tag, lane: run.lane, run_id: runId, event: "card_resolved", line: `Resumed at ${step ?? "the current step"} by ${by}.`, actor: by }));
    return { ok: true, run: (await this.d.repo.getRun(runId))!, step };
  }

  /** The receipt is the last event on the lane. */
  private async closeWithReceipt(closed: RunRow, note: string, nextIntent: string): Promise<void> {
    const shown = presentRun(closed);
    const counts = orderCounts(closed.counts_by_status).map(([k, v]) => `${k} ${v}`).join(", ") || "no counts";
    await this.ledger((l) => l.setStep(shown.client_tag, shown.lane, null, { run_id: null, line: `Run ${shown.run_id.slice(0, 8)} closed ${shown.status}.`, next_intent: nextIntent }));
    await this.ledger((l) => l.event({ client_tag: shown.client_tag, lane: shown.lane, run_id: shown.run_id, event: "receipt", line: `Receipt: ${shown.status} · ${counts} · ${note}`, next_intent: nextIntent, actor: "service" }));
  }

  /**
   * Rows a run claimed but never got a verdict on go back to the queue
   * (verifying -> needs_verify is a legal edge). Verdicts already written stay.
   */
  private async releaseClaimedRows(run: RunRow): Promise<number> {
    const table = ingestedTable(run.client_tag);
    try {
      return await this.d.repo.withRun(run.run_id, async (tx) => {
        const { rowCount } = await tx.query(
          `update ${table} set lead_status = 'needs_verify', run_id = null, verify_batch = null, status_changed_at = now()
           where run_id = $1 and lead_status in ('verifying', 'claimed', 'reserved', 'pulling')`,
          [run.run_id],
        );
        return rowCount ?? 0;
      });
    } catch (err) {
      // A client with no ingest table has nothing claimed to release.
      const e = err as { code?: string; message?: string };
      if (e.code === "42P01" || /does not exist/i.test(e.message ?? "")) return 0;
      throw err;
    }
  }

  /** Open cards with the run they belong to. */
  async holds(clientTag?: string): Promise<Hold[]> {
    const cards = await this.d.repo.openCards(undefined, clientTag);
    const out: Hold[] = [];
    for (const c of cards) {
      const run = c.run_id ? await this.d.repo.getRun(c.run_id) : null;
      const campaign_report = Array.isArray(c.payload.campaign_report)
        ? campaignReportFromCounts({ campaign_report: c.payload.campaign_report })
        : run
          ? campaignReportFromCounts((await this.d.repo.getStep(run.run_id, "pull"))?.counts as unknown as Record<string, unknown>)
          : [];
      out.push({
        card_id: c.card_id,
        kind: c.kind,
        audience: c.audience,
        run_id: c.run_id,
        client_tag: run?.client_tag ?? null,
        age_minutes: Math.round((Date.now() - Date.parse(c.created_at)) / 60000),
        summary: summarize(c.kind, c.payload),
        campaign_report,
      });
    }
    return out;
  }
}

function summarize(kind: string, payload: Record<string, unknown>): string {
  switch (kind) {
    case "spend_approval":
      return `spend ask: ${payload.rows} rows, worst case $${((Number(payload.worst_case_cents) || 0) / 100).toFixed(2)} (${payload.vendor})`;
    case "stall":
      return `verifier stalled on batch ${payload.batch}: ${payload.remaining} rows unverified`;
    case "parked":
      return `parked at ${payload.step}: ${String(payload.reason ?? "").slice(0, 120)}`;
    case "gate":
      return `${stepLabel(Number(payload.spine_step))} gate unmet — ${payload.gate}: ${String(payload.reason ?? "").slice(0, 120)}`;
    case "qa_hold":
      return `QA hold ${payload.rule_id}: ${payload.count} leads`;
    case "pending_campaign":
      return `${payload.pending} leads match no campaign on the job`;
    default:
      return kind;
  }
}
