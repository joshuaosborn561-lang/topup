import { ingestedTable } from "./db/pool.js";
import type { Repo } from "./db/repo.js";
import { orderCounts, type Role, type RunRow, type Step } from "./domain/runs.js";
import type { LaneLedger } from "./ledger/lane.js";
import { logger } from "./lib/log.js";
import { resolveTargetCampaignIds, targetCountPatch } from "./recipes/campaigns.js";
import { recipeResolveDeps, resolveOrInfer } from "./recipes/infer.js";
import { skeletonRecipe } from "./reason/skeleton.js";
import { parseRecipe, type Recipe } from "./recipes/schema.js";
import { gateCard } from "./slack/cards.js";
import type { SlackConsole } from "./slack/console.js";
import type { GateUnmet } from "./spine/gate.js";
import { stepForStage, stepLabel } from "./spine/steps.js";
import type { TapListener } from "./slack/http.js";
import type { StageOutcome } from "./stages/common.js";
import type { FlipStage } from "./stages/flip/index.js";
import type { FindEmailsStage } from "./stages/find_emails/index.js";
import type { PuzzleStage } from "./stages/puzzle/index.js";
import type { TriggerStage } from "./stages/trigger/index.js";
import type { ImportStage } from "./stages/import/index.js";
import type { IngestStage } from "./stages/ingest/index.js";
import type { NormalizeOutcome, NormalizeStage } from "./stages/normalize/index.js";
import type { PostImportStage } from "./stages/post_import/index.js";
import type { PullStage } from "./stages/pull/index.js";
import type { QaStage } from "./stages/qa/index.js";
import type { RouteStage } from "./stages/route/index.js";
import type { SizeStage } from "./stages/size/index.js";
import type { StageStage } from "./stages/stage/index.js";
import type { SuppressStage } from "./stages/suppress/index.js";
import type { VerifyOutcome, VerifyStage } from "./stages/verify/verify.js";

const log = logger("orchestrator");

/**
 * The stages a run walks, in spine order: steps 1 through 13 of
 * skills/lead-list-build (D29). Puzzle + find_emails run after suppress so
 * we do not pay to enrich a suppressed person. Step 1 reuses the saved
 * recipe when a file exists; otherwise it infers ICP from the list already
 * in the campaign and the find-method from receipt tags (D38). Step 13
 * reminds Josh to flip ACTIVE and never does it.
 */
export const PIPELINE_STEPS: readonly Step[] = ["trigger", "size", "pull", "ingest", "suppress", "puzzle", "find_emails", "verify", "normalize", "qa", "route", "stage", "import", "post_import", "flip"];

/** Kept for the invariants guard; the Phase 1 build ran only these two. */
export const PHASE1_STEPS: readonly Step[] = ["verify", "normalize"];

export interface Stages {
  trigger: TriggerStage;
  size: SizeStage;
  pull: PullStage;
  ingest: IngestStage;
  suppress: SuppressStage;
  puzzle: PuzzleStage;
  findEmails: FindEmailsStage;
  verify: VerifyStage;
  normalize: NormalizeStage;
  qa: QaStage;
  route: RouteStage;
  stage: StageStage;
  import: ImportStage;
  postImport: PostImportStage;
  flip: FlipStage;
}

type AnyOutcome = StageOutcome | VerifyOutcome | NormalizeOutcome;

export interface StartInput {
  clientTag: string;
  lane: string;
  by: string;
  trigger: RunRow["trigger"];
  /** Default true. The watch sets false when it is about to post a not-working card. */
  drive?: boolean;
  /** The watch names why it opened a run without driving it. */
  hold?: "not_working";
  /** Campaigns this run sizes/pulls. Omitted = every campaign the recipe names. */
  campaignIds?: number[];
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
      stages: Stages;
      /** The lane ledger; every stage change and outcome is written to it as it happens. */
      ledger?: LaneLedger;
      /** D38: optional getleads count for band partition when the list has no sizes. */
      getleadsCount?: (filters: Record<string, unknown>) => Promise<{ total_matching: number }>;
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
    const resolved = await resolveOrInfer(recipeResolveDeps(this.d.repo, this.d.getleadsCount), {
      clientTag: input.clientTag,
      lane: input.lane,
      campaignIds: input.campaignIds,
    });
    let recipe = resolved.ok ? resolved.recipe : null;
    if (!recipe) {
      const receipts = await this.d.repo.listPullReceipts(input.clientTag, input.lane);
      const clientId = receipts.find((r) => r.smartlead_client_id)?.smartlead_client_id
        ?? (await this.d.repo.smartleadClientIdFor(receipts.flatMap((r) => r.campaign_ids)));
      if (!clientId) return { ok: false, message: resolved.ok ? "no recipe" : resolved.message };
      try {
        recipe = skeletonRecipe({ clientTag: input.clientTag, lane: input.lane, smartleadClientId: clientId, receipts });
        await this.d.repo.upsertRecipe({
          recipe_id: recipe.recipe_id,
          client_tag: recipe.client_tag,
          lane: recipe.lane,
          version: 0,
          body: recipe,
          owner_approved_at: null,
        });
      } catch (err) {
        return { ok: false, message: resolved.ok ? (err as Error).message : resolved.message };
      }
    }
    const targets = resolveTargetCampaignIds(recipe, input.campaignIds);
    if (!targets.ok) return { ok: false, message: targets.message };
    const opened = await this.d.repo.openRun({
      recipe_id: recipe.recipe_id,
      client_tag: recipe.client_tag,
      lane: recipe.lane,
      campaign_id: targets.ids.length === 1 ? targets.ids[0]! : null,
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
    if (targets.ids.length) await this.d.repo.mergeRunCounts(opened.run.run_id, targetCountPatch(targets.ids));
    const headline =
      input.hold === "not_working"
        ? `Top-up run \`${opened.run.run_id.slice(0, 8)}\` — ${recipe.client_tag} / ${recipe.lane} · the watch stopped: a campaign is low and not working. This needs Josh.`
        : input.trigger === "runway"
          ? `Top-up run \`${opened.run.run_id.slice(0, 8)}\` — ${recipe.client_tag} / ${recipe.lane} · the watch started it: a campaign is low and still working.`
          : `Top-up run \`${opened.run.run_id.slice(0, 8)}\` — ${recipe.client_tag} / ${recipe.lane} · started by <@${input.by}> (${input.trigger})`;
    const run = await this.d.console.openRunThread(opened.run, headline);
    await this.ledger((l) =>
      l.event({
        client_tag: run.client_tag,
        lane: run.lane,
        run_id: run.run_id,
        event: "run_opened",
        line:
          input.hold === "not_working"
            ? `Run ${run.run_id.slice(0, 8)} opened by the watch and waiting on Josh: not working.`
            : input.trigger === "runway"
              ? `Run ${run.run_id.slice(0, 8)} opened by the watch (runway low, still working).`
              : `Run ${run.run_id.slice(0, 8)} opened (${input.trigger}).`,
        next_intent: input.hold === "not_working" ? "Waiting for Top up anyway or Leave it." : `Run ${PIPELINE_STEPS.join(", ")}; then the receipt.`,
        actor: input.by,
      }),
    );
    if (input.drive !== false) void this.drive(run.run_id);
    return { ok: true, run };
  }

  /** Ledger writes never break a run: a failed write is logged and the run goes on. */
  private async ledger(fn: (l: LaneLedger) => Promise<unknown>): Promise<void> {
    if (!this.d.ledger) return;
    try {
      await fn(this.d.ledger);
    } catch (err) {
      log.error("ledger write failed", { error: (err as Error).message });
    }
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

    for (const [i, step] of PIPELINE_STEPS.entries()) {
      const after = PIPELINE_STEPS[i + 1];
      for (;;) {
        const run = (await this.d.repo.getRun(initial.run_id))!;
        const stepRow = await this.d.repo.getStep(run.run_id, step);
        if (stepRow?.status === "done") break;
        await this.ledger((l) => l.setStepForStage(run.client_tag, run.lane, step, { run_id: run.run_id, next_intent: after ? `Then ${stepLabel(stepForStage(after)?.n ?? null)} (${after}).` : "Then close with a receipt." }));
        const outcome = await this.runStage(step, run, recipe);
        if (outcome.kind === "gate") {
          await this.haltAtGate(run, step, outcome);
          return;
        }
        if (outcome.kind === "waiting") {
          await this.ledger((l) =>
            l.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "waiting", line: `${stepLabel(stepForStage(step)?.n ?? null)} (${step}) waits on ${outcome.on === "owner" ? "Josh" : "Cayden"}: ${outcome.why}`, next_intent: "Waiting for the card; the tap re-enters the step.", actor: "service" }),
          );
          return;
        }
        if (outcome.kind === "retry") {
          log.warn("step retrying", { run_id: run.run_id, step, error: outcome.error, in_ms: this.retryDelayMs });
          await this.ledger((l) =>
            l.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "retry", line: `${step} failed: ${outcome.error.slice(0, 160)}`, next_intent: `Retry ${step} in ${Math.round(this.retryDelayMs / 1000)}s.`, actor: "service" }),
          );
          await this.sleep(this.retryDelayMs);
          continue;
        }
        if (outcome.kind === "parked" || outcome.kind === "declined") {
          const fresh = (await this.d.repo.getRun(run.run_id))!;
          const at = stepLabel(stepForStage(step)?.n ?? null);
          if (outcome.kind === "parked") {
            await this.ledger((l) =>
              l.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "parked", line: `Parked at ${at} (${step}): ${(fresh.last_error ?? "").slice(0, 160)}`, next_intent: "Waiting for Resume or Abort on the parked card.", actor: "service" }),
            );
          } else {
            await this.ledger((l) => l.setStep(run.client_tag, run.lane, null, { run_id: null, line: `Run ${run.run_id.slice(0, 8)} closed ${fresh.status} at ${at} (${step}).`, next_intent: "Nothing queued." }));
          }
          return;
        }
        break;
      }
    }

    const run = (await this.d.repo.getRun(initial.run_id))!;
    await this.d.repo.setRunStatus(run.run_id, "done", "flip");
    const closed = (await this.d.repo.getRun(run.run_id))!;
    await this.closeWithReceipt(closed, await this.receiptNote(closed), "Step 13 is in Josh's hands: flip ACTIVE and watch day one. The watch will start the next fill when a campaign is low and still working.");
  }

  private async runStage(step: Step, run: RunRow, recipe: Recipe): Promise<AnyOutcome> {
    const s = this.d.stages;
    switch (step) {
      case "trigger":
        return s.trigger.run(run, recipe);
      case "size":
        return s.size.run(run, recipe);
      case "pull":
        return s.pull.run(run, recipe);
      case "ingest":
        return s.ingest.run(run, recipe);
      case "suppress":
        return s.suppress.run(run, recipe);
      case "puzzle":
        return s.puzzle.run(run, recipe);
      case "find_emails":
        return s.findEmails.run(run, recipe);
      case "verify":
        return s.verify.run(run, recipe);
      case "normalize":
        return s.normalize.run(run, recipe);
      case "qa":
        return s.qa.run(run, recipe);
      case "route":
        return s.route.run(run, recipe);
      case "stage":
        return s.stage.run(run, recipe);
      case "import":
        return s.import.run(run, recipe);
      case "post_import":
        return s.postImport.run(run, recipe);
      case "flip":
        return s.flip.run(run, recipe);
      default:
        throw new Error(`no stage for step ${step as string}`);
    }
  }

  /**
   * The step 12 gate's receipt line: campaign, imported, runway before and
   * after, "ready for ACTIVE" — from the import and post_import step counts.
   * Spend by vendor and holds are on the receipt card itself.
   */
  private async receiptNote(run: RunRow): Promise<string> {
    const [imp, post] = await Promise.all([this.d.repo.getStep(run.run_id, "import"), this.d.repo.getStep(run.run_id, "post_import")]);
    const ids = new Set<string>();
    for (const k of Object.keys(imp?.counts ?? {})) {
      const m = /^imported_(\d+)$/.exec(k);
      if (m) ids.add(m[1]);
    }
    if (ids.size === 0) return "No campaign received leads on this run.";
    const days = (v: number | undefined) => (v === undefined ? "n/a" : `${(Number(v) / 10).toFixed(1)}d`);
    const lines = [...ids].sort().map((id) => {
      const ready = post?.counts[`ready_${id}`] === 1;
      return `#${id}: imported ${imp?.counts[`imported_${id}`] ?? 0} · runway ${days(imp?.counts[`runway_before_${id}_x10`])} → ${days(post?.counts[`runway_after_${id}_x10`])} · ${ready ? "ready for ACTIVE" : "not ready (see step 12)"}`;
    });
    return `${lines.join("\n")}\nJosh flips ACTIVE by hand; the service never does.`;
  }

  /**
   * A spine gate failed (D24). The run halts at the step, the ledger records
   * why, and exactly one card posts: a second halt at the same step with a
   * card already open posts nothing more.
   */
  private async haltAtGate(run: RunRow, stage: Step, g: GateUnmet): Promise<void> {
    await this.d.repo.setRunStatus(run.run_id, "awaiting_josh", stage, `${g.gate}: ${g.why}`);
    await this.ledger((l) => l.gateUnmet(run.client_tag, run.lane, g.step, g.why, { run_id: run.run_id, waiting_on: "owner", next_intent: "Waiting for Resume or Abort on the gate card." }));
    const open = (await this.d.repo.openCardsForRun(run.run_id)).some((c) => c.kind === "gate" && c.payload.step === stage);
    if (open) return;
    await this.d.console.ask({
      run,
      kind: "gate",
      audience: "owner",
      payload: { step: stage, spine_step: g.step, gate: g.gate, reason: g.why, counts: g.counts },
      text: `${stepLabel(g.step)} gate unmet — ${g.gate}: ${g.why}`,
      blocks: (cardId) => gateCard({ cardId, runId: run.run_id, clientTag: run.client_tag, lane: run.lane, stepLabel: stepLabel(g.step), gate: g.gate, why: g.why, counts: g.counts }),
    });
  }

  /** The receipt is the last gate: nothing is done until it posts, and it is the last event on the lane. */
  private async closeWithReceipt(closed: RunRow, note: string, nextIntent: string): Promise<void> {
    await this.d.console.receipt(closed, note);
    const counts = orderCounts(closed.counts_by_status).map(([k, v]) => `${k} ${v}`).join(", ") || "no counts";
    await this.ledger((l) => l.setStep(closed.client_tag, closed.lane, null, { run_id: null, line: `Run ${closed.run_id.slice(0, 8)} closed ${closed.status}.`, next_intent: nextIntent }));
    await this.ledger((l) => l.event({ client_tag: closed.client_tag, lane: closed.lane, run_id: closed.run_id, event: "receipt", line: `Receipt: ${closed.status} · ${counts} · ${note}`, next_intent: nextIntent, actor: "service" }));
  }

  /** What a resolved card should set in motion. Shared by Slack taps and MCP resolve_hold. */
  readonly onTap: TapListener = async (card) => {
    const runId = card.run_id;
    if (runId) {
      const run = await this.d.repo.getRun(runId);
      if (run) {
        await this.ledger((l) =>
          l.event({ client_tag: run.client_tag, lane: run.lane, run_id: runId, event: "card_resolved", line: `${card.kind} card: ${card.choice} by ${card.by}.`, actor: card.by, detail: { card_id: card.card_id } }),
        );
      }
    }
    switch (card.choice) {
      case "approve_spend":
      case "split":
      case "resume":
      case "topup_anyway": {
        if (!runId) return;
        const run = await this.d.repo.getRun(runId);
        if (run) {
          await this.d.repo.setRunStatus(runId, "open", "trigger");
          await this.ledger((l) => l.unblock(run.client_tag, run.lane, `Josh chose to top up anyway.`, runId));
          await this.d.console.postInThread(run, `Top up anyway by <@${card.by}>: the watch will run the lane even though the reply rate is under the bar.`);
        }
        void this.drive(runId);
        return;
      }
      // step 5: the list was added (or Josh said go without); step 9: Josh said continue without the pending cells
      case "list_added":
      case "no_list": {
        if (card.choice === "no_list" && runId) {
          const run = await this.d.repo.getRun(runId);
          if (run) await this.d.repo.confirmClientDomainListEmpty(run.client_tag, card.by);
        }
      }
      // fall through: list added (or Josh confirmed none) and step 9 continue
      case "continue_without":
        // The waiting stage either sees the resolution in-process or, after a
        // restart, is re-entered here.
        if (runId) void this.drive(runId);
        return;
      case "accept":
      case "purge":
      case "reroute": {
        // step 8: every row still held under the card's rule takes the choice, then the run goes on
        if (!runId) return;
        const run = await this.d.repo.getRun(runId);
        const full = await this.d.repo.getCard(card.card_id);
        if (!run || !full || full.kind !== "qa_hold") return;
        const n = await this.d.stages.qa.applyTap(run, full.payload, card.choice, card.by);
        await this.d.console.postInThread(run, `QA ${card.choice} on \`${String(full.payload.rule_id)}\` by <@${card.by}>: ${n} leads.`);
        void this.drive(runId);
        return;
      }
      case "resume_run": {
        if (!runId) return;
        const run = await this.d.repo.getRun(runId);
        if (!run) return;
        const step = (card.kind === "parked" || card.kind === "gate" ? (await this.parkedStep(card.card_id)) : null) ?? run.current_step;
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
        await this.closeWithReceipt(closed, `Aborted by <@${card.by}>. ${released} unverified rows returned to needs_verify. Nothing was sent.`, "Nothing queued.");
        return;
      }
      case "leave_it": {
        if (!runId) return;
        await this.d.repo.setRunStatus(runId, "not_working", undefined, `left alone by ${card.by}`);
        const run = await this.d.repo.getRun(runId);
        if (run) {
          await this.ledger((l) => l.unblock(run.client_tag, run.lane, `Josh left it: not working, no top-up.`, runId));
          await this.closeWithReceipt(run, `Left alone by <@${card.by}>: the campaign is not working and nothing was topped up.`, "The watch will stay quiet on this lane until the rate recovers or /working is flipped on.");
        }
        return;
      }
      case "decline_spend":
        // The verify stage returns the rows to needs_verify and closes the run as declined.
        if (runId) void this.drive(runId);
        return;
      case "approve_segment":
      case "widen_0":
      case "widen_1":
      case "widen_2":
      case "widen_3":
        if (runId) void this.drive(runId);
        return;
      case "decline_segment":
        if (runId) void this.drive(runId);
        return;
      case "confirm_receipt": {
        const full = await this.d.repo.getCard(card.card_id);
        const receiptId = typeof full?.payload.receipt_id === "string" ? full.payload.receipt_id : null;
        if (receiptId) await this.d.repo.confirmReceipt(receiptId);
        return;
      }
      case "edit_receipt":
        if (runId) {
          const run = await this.d.repo.getRun(runId);
          if (run) await this.d.console.postInThread(run, `Edit the receipt in this thread. The service will write a \`josh_correction\` row. <@${card.by}>`);
        }
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
    case "gate":
      return `${stepLabel(Number(payload.spine_step))} gate unmet — ${payload.gate}: ${String(payload.reason ?? "").slice(0, 120)}`;
    case "qa_hold":
      return `QA hold ${payload.rule_id}: ${payload.count} leads`;
    case "client_domain_list":
      return `step 5 needs ${payload.client_tag}'s customer domain list (MCP add_client_domains)`;
    case "pending_campaign":
      return `step 9: ${payload.pending} leads match no campaign in the recipe`;
    default:
      return kind;
  }
}
