import { ingestedTable } from "./db/pool.js";
import type { Repo } from "./db/repo.js";
import type { Role, RunRow, Step } from "./domain/runs.js";
import { logger } from "./lib/log.js";
import { parseRecipe, type Recipe } from "./recipes/schema.js";
import type { SlackConsole } from "./slack/console.js";
import type { TapListener } from "./slack/http.js";
import type { NormalizeStage } from "./stages/normalize/index.js";
import type { VerifyStage } from "./stages/verify/verify.js";

const log = logger("orchestrator");

/**
 * Stages this build can run, in order. Phase 1 stops after normalize: nothing
 * is routed, staged or imported until those stages land in their own PRs.
 * The run closes as `done` with a receipt that says exactly that.
 */
export const PHASE1_STEPS: readonly Step[] = ["verify", "normalize"];

export interface StartInput {
  clientTag: string;
  lane: string;
  by: string;
  trigger: RunRow["trigger"];
}

export type StartResult = { ok: true; run: RunRow } | { ok: false; message: string };

export class Orchestrator {
  /** Runs this process is currently driving. One replica, so a Set is enough. */
  private readonly active = new Set<string>();
  private readonly retryDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly d: {
      repo: Repo;
      console: SlackConsole;
      verify: VerifyStage;
      normalize: NormalizeStage;
      /** Pause between a failed step attempt and the next (default 30s). */
      retryDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.retryDelayMs = d.retryDelayMs ?? 30_000;
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** `/topup <client> <lane>` or MCP start_topup. Opens the run and drives it in the background. */
  async startTopup(input: StartInput): Promise<StartResult> {
    const found = await this.d.repo.findRecipe(input.clientTag, input.lane);
    if (!found) {
      return {
        ok: false,
        message: `No recipe for ${input.clientTag}/${input.lane}. Recipes live in recipes/<client>/<lane>.json in the repo; the service never invents one.`,
      };
    }
    let recipe: Recipe;
    try {
      recipe = parseRecipe(found.body);
    } catch (err) {
      return { ok: false, message: `Recipe ${found.recipe_id} does not validate: ${(err as Error).message}` };
    }
    const opened = await this.d.repo.openRun({
      recipe_id: recipe.recipe_id,
      client_tag: recipe.client_tag,
      lane: recipe.lane,
      campaign_id: null,
      trigger: input.trigger,
      opened_by: input.by,
    });
    if (!opened.ok) {
      const existing = await this.d.repo.openRunFor(recipe.client_tag, recipe.lane);
      return {
        ok: false,
        message: existing
          ? `A run is already open for ${recipe.client_tag}/${recipe.lane}: \`${existing.run_id.slice(0, 8)}\` (${existing.status}). One open run per lane; finish or abort it first.`
          : `The database refused a second open run for ${recipe.client_tag}/${recipe.lane}.`,
      };
    }
    const run = await this.d.console.openRunThread(
      opened.run,
      `Top-up run \`${opened.run.run_id.slice(0, 8)}\` — ${recipe.client_tag} / ${recipe.lane} · started by <@${input.by}> (${input.trigger})`,
    );
    void this.drive(run.run_id);
    return { ok: true, run };
  }

  /** Re-enter every open run after a restart. Runs waiting on a card simply keep waiting. */
  async resumeOpenRuns(): Promise<number> {
    const open = await this.d.repo.openRuns();
    for (const run of open) void this.drive(run.run_id);
    return open.length;
  }

  /**
   * Drive a run forward until it finishes, parks, or waits on a card.
   * Idempotent: a second call while the run is active is a no-op, and a call
   * while a card is open logs and returns (the tap will call again).
   */
  async drive(runId: string): Promise<void> {
    if (this.active.has(runId)) return;
    this.active.add(runId);
    try {
      const run = await this.d.repo.getRun(runId);
      if (!run) return;
      const cards = await this.d.repo.openCardsForRun(runId);
      if (cards.length > 0) {
        log.info("run waits on a card", { run_id: runId, cards: cards.map((c) => c.kind) });
        return;
      }
      await this.pipeline(run);
    } catch (err) {
      log.error("drive failed", { run_id: runId, error: (err as Error).message });
      await this.d.repo.setRunStatus(runId, "awaiting_operator", undefined, (err as Error).message).catch(() => undefined);
    } finally {
      this.active.delete(runId);
    }
  }

  private async pipeline(initial: RunRow): Promise<void> {
    const rec = await this.d.repo.getRecipe(initial.recipe_id);
    if (!rec) throw new Error(`recipe ${initial.recipe_id} is not in topup.lane_recipes`);
    const recipe = parseRecipe(rec.body);

    for (const step of PHASE1_STEPS) {
      for (;;) {
        const run = (await this.d.repo.getRun(initial.run_id))!;
        const stepRow = await this.d.repo.getStep(run.run_id, step);
        if (stepRow?.status === "done") break;
        const outcome = step === "verify" ? await this.d.verify.run(run, recipe) : await this.d.normalize.run(run, recipe);
        if (outcome.kind === "retry") {
          log.warn("step retrying", { run_id: run.run_id, step, error: outcome.error, in_ms: this.retryDelayMs });
          await this.sleep(this.retryDelayMs);
          continue;
        }
        if (outcome.kind === "parked" || outcome.kind === "declined") return;
        break;
      }
    }

    const run = (await this.d.repo.getRun(initial.run_id))!;
    await this.d.repo.setRunStatus(run.run_id, "done", "normalize");
    const closed = (await this.d.repo.getRun(run.run_id))!;
    await this.d.console.receipt(closed, "Phase 1 build: the run stops after normalize. Nothing was routed, staged or imported.");
  }

  /** What a resolved card should set in motion. Shared by Slack taps and MCP resolve_hold. */
  readonly onTap: TapListener = async (card) => {
    const runId = card.run_id;
    switch (card.choice) {
      case "approve_spend":
      case "split":
      case "resume":
      case "topup_anyway":
        // The waiting stage either sees the resolution in-process or, after a
        // restart, is re-entered here.
        if (runId) void this.drive(runId);
        return;
      case "resume_run": {
        if (!runId) return;
        const run = await this.d.repo.getRun(runId);
        if (!run) return;
        const step = (card.kind === "parked" ? (await this.parkedStep(card.card_id)) : null) ?? run.current_step;
        if (step) await this.d.repo.resetStep(runId, step);
        await this.d.repo.setRunStatus(runId, "open", step ?? undefined);
        await this.d.console.postInThread(run, `Resumed by <@${card.by}>: step *${step ?? "?"}* gets one more go.`);
        void this.drive(runId);
        return;
      }
      case "abort": {
        if (!runId) return;
        const run = await this.d.repo.getRun(runId);
        if (!run) return;
        if (card.kind === "stall") return; // the verify stage handles abort of a batch itself
        const released = await this.releaseClaimedRows(run);
        await this.d.repo.setRunStatus(runId, "aborted", undefined, `aborted by ${card.by}`);
        const closed = (await this.d.repo.getRun(runId))!;
        await this.d.console.receipt(closed, `Aborted by <@${card.by}>. ${released} unverified rows returned to needs_verify. Nothing was sent.`);
        return;
      }
      case "leave_it": {
        if (!runId) return;
        await this.d.repo.setRunStatus(runId, "not_working", undefined, `left alone by ${card.by}`);
        return;
      }
      case "decline_spend":
        // The verify stage returns the rows to needs_verify and closes the run as declined.
        if (runId) void this.drive(runId);
        return;
      default:
        log.info("card resolved with no side effect in this build", { card_id: card.card_id, kind: card.kind, choice: card.choice });
    }
  };

  /**
   * Rows a run claimed but never got a verdict on go back to the queue
   * (verifying -> needs_verify is a legal edge). Verdicts already written stay.
   */
  private async releaseClaimedRows(run: RunRow): Promise<number> {
    const table = ingestedTable(run.client_tag);
    return this.d.repo.withRun(run.run_id, async (tx) => {
      const { rowCount } = await tx.query(
        `update ${table} set lead_status = 'needs_verify', run_id = null, verify_batch = null, status_changed_at = now()
         where run_id = $1 and lead_status = 'verifying'`,
        [run.run_id],
      );
      return rowCount ?? 0;
    });
  }

  private async parkedStep(cardId: string): Promise<Step | null> {
    const card = await this.d.repo.getCard(cardId);
    const step = card?.payload.step;
    return typeof step === "string" ? (step as Step) : null;
  }

  /** For /holds and list_holds: open cards with the run they belong to. */
  async holds(clientTag?: string): Promise<Array<{ card_id: string; kind: string; audience: Role; run_id: string | null; client_tag: string | null; age_minutes: number; summary: string }>> {
    const cards = await this.d.repo.openCards(undefined, clientTag);
    const out = [];
    for (const c of cards) {
      const run = c.run_id ? await this.d.repo.getRun(c.run_id) : null;
      out.push({
        card_id: c.card_id,
        kind: c.kind,
        audience: c.audience,
        run_id: c.run_id,
        client_tag: run?.client_tag ?? null,
        age_minutes: Math.round((Date.now() - Date.parse(c.created_at)) / 60000),
        summary: summarize(c.kind, c.payload),
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
    case "qa_hold":
      return `QA hold ${payload.rule_id}: ${payload.count} leads`;
    default:
      return kind;
  }
}
