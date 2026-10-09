import type { Repo } from "../db/repo.js";
import { presentRun, type RunRow, type Step } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import { targetCountPatch } from "../recipes/campaigns.js";
import { parseRecipe, type Recipe } from "../recipes/schema.js";
import { jobLane, jobRecipe, type JobSpec } from "./recipe.js";
import type { FindEmailsStage } from "../stages/find_emails/index.js";
import type { ImportStage } from "../stages/import/index.js";
import type { IngestStage } from "../stages/ingest/index.js";
import type { NormalizeStage } from "../stages/normalize/index.js";
import type { PostImportStage } from "../stages/post_import/index.js";
import type { PullStage } from "../stages/pull/index.js";
import type { PuzzleStage } from "../stages/puzzle/index.js";
import type { QaStage } from "../stages/qa/index.js";
import type { RouteStage } from "../stages/route/index.js";
import type { StageStage } from "../stages/stage/index.js";
import type { SuppressStage } from "../stages/suppress/index.js";
import type { VerifyStage } from "../stages/verify/verify.js";

const log = logger("jobs");

/**
 * The verbs (D52). A job is one run row for one campaign with its own job
 * recipe. Each verb runs one or two of the existing stages, once, and
 * reports counts. Nothing chains on its own: the next verb runs when Grok
 * calls it. A stage that needs money posts a spend card and the verb
 * returns the estimate; the same verb called again with approved_by
 * approves that card, records who, and runs. import refuses while loads
 * are paused. Rows never leave the server.
 */
/** The dumb pipeline: twelve stages, each run once by a verb. Nothing sizes, triggers or flips (D53). */
export interface Stages {
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
}

export type Verb = "pull" | "suppress" | "enrich" | "verify" | "normalize" | "qa" | "stage" | "import";

export const VERB_STEPS: Readonly<Record<Verb, readonly Step[]>> = {
  pull: ["pull", "ingest"],
  suppress: ["suppress"],
  enrich: ["puzzle", "find_emails"],
  verify: ["verify"],
  normalize: ["normalize"],
  qa: ["qa"],
  stage: ["route", "stage"],
  import: ["import", "post_import"],
};

export const VERB_ORDER: readonly Verb[] = ["pull", "suppress", "enrich", "verify", "normalize", "qa", "stage", "import"];

export interface VerbResult {
  job_id: string;
  verb: Verb;
  step: Step;
  status: "done" | "nothing" | "waiting_approval" | "parked" | "retry" | "gate" | "declined" | "stopped" | "refused";
  counts: Record<string, number>;
  worst_case_cents: number | null;
  card_id: string | null;
  approved_by: string | null;
  why: string | null;
  next: string;
}

export interface JobRunnerDeps {
  repo: Repo;
  stages: Stages;
  /** D18: only the console resolves a card. A named approval relayed by Grok is the tap. */
  console: { resolveAs(actor: string, role: "owner" | "operator" | null, cardId: string, choice: string): Promise<{ ok: boolean; message?: string; reason?: string }> };
  ledger?: LaneLedger;
  now?: () => number;
}

export class JobRunner {
  constructor(private readonly d: JobRunnerDeps) {}

  /** Open a job: a run row, its job recipe, the target campaign. Nothing runs yet. */
  async open(spec: JobSpec, by: string): Promise<{ ok: true; job_id: string; recipe_id: string; lane: string } | { ok: false; message: string }> {
    let recipe: Recipe;
    const stamp = (this.d.now ?? Date.now)();
    try {
      recipe = jobRecipe(spec, stamp);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    // Filed under its own lane name (D52): findRecipe(client, lane) must never hand a job recipe to a lane start.
    await this.d.repo.upsertRecipe({ recipe_id: recipe.recipe_id, client_tag: recipe.client_tag, lane: jobLane(spec, stamp), version: 1, body: recipe, owner_approved_at: recipe.owner_approved_at ?? null });
    const opened = await this.d.repo.openRun({ recipe_id: recipe.recipe_id, client_tag: spec.client_tag, lane: spec.lane, campaign_id: spec.campaign_id, trigger: "manual", opened_by: by });
    if (!opened.ok) {
      const existing = await this.d.repo.openRunFor(spec.client_tag, spec.lane);
      return { ok: false, message: existing ? `A job is already open for ${spec.client_tag}/${spec.lane}: ${existing.run_id}. Finish it with the next verb, or abort it.` : `The database refused a second open job for ${spec.client_tag}/${spec.lane} or campaign #${spec.campaign_id}.` };
    }
    const runId = opened.run.run_id;
    await this.d.repo.mergeRunCounts(runId, { ...targetCountPatch([spec.campaign_id]), grok_job: 1, requested_leads: spec.max_rows });
    const trig = await this.d.repo.beginStep(runId, "trigger");
    if (trig.ok) await this.d.repo.finishStep(runId, "trigger", { useful_output: 1, counts: { job: 1, campaign_id: spec.campaign_id, max_rows: spec.max_rows } });
    await this.d.ledger
      ?.event({ client_tag: spec.client_tag, lane: spec.lane, run_id: runId, event: "run_opened", line: `Job ${runId.slice(0, 8)} opened by ${by} for #${spec.campaign_id}: ${spec.source} with ${Object.keys(spec.filters).length} filter keys, up to ${spec.max_rows} rows.`, next_intent: "pull(job_id) when a person has approved the spend.", actor: by })
      .catch(() => undefined);
    return { ok: true, job_id: runId, recipe_id: recipe.recipe_id, lane: spec.lane };
  }

  /** Run one verb on a job. */
  async run(jobId: string, verb: Verb, opts: { by: string; approved_by?: string | null }): Promise<VerbResult> {
    const run = await this.d.repo.getRun(jobId);
    const steps = VERB_STEPS[verb];
    const first = steps[0]!;
    if (!run) return this.result(jobId, verb, first, "refused", {}, null, null, null, "no such job", "jobs() lists them");
    if (Number(run.counts_by_status?.grok_job) !== 1) return this.result(jobId, verb, first, "refused", {}, null, null, null, "not a job opened by pull(); runs the service opened are read with job() and aborted with abort()", "open a job with pull(...)");
    const shown = presentRun(run);
    if (["done", "sized", "aborted", "declined", "failed"].includes(shown.status)) return this.result(jobId, verb, first, "refused", {}, null, null, null, `job is ${shown.status}`, "open a new job with pull(...)");
    if (verb === "import" && (await this.d.repo.loadsPaused())) {
      return this.result(jobId, verb, first, "refused", {}, null, null, null, "loads are paused; nothing reaches Smartlead until loads_paused is off", "loads_paused(paused=false) when Josh says so, then import(job_id) again");
    }
    const rec = await this.d.repo.getRecipe(run.recipe_id);
    if (!rec) return this.result(jobId, verb, first, "refused", {}, null, null, null, `job recipe ${run.recipe_id} is missing`, "open a new job");
    const recipe = parseRecipe(rec.body);

    let approver: string | null = null;
    for (const step of steps) {
      const already = await this.d.repo.getStep(jobId, step);
      if (already?.status === "done") continue;
      if (opts.approved_by) approver = (await this.approve(run, step, opts.approved_by, opts.by)) ?? approver;
      let outcome = await this.runStage(step, run, recipe);
      // A name given before the estimate existed: the stage has now posted its card; approve it and run once more.
      if (String((outcome as { kind: string }).kind) === "waiting" && opts.approved_by) {
        const named = await this.approve(run, step, opts.approved_by, opts.by);
        if (named) {
          approver = named;
          outcome = await this.runStage(step, run, recipe);
        }
      }
      const o = outcome as unknown as Record<string, unknown>;
      const kind = String(o.kind);
      const str = (k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
      if (kind === "done") {
        const counts = (o.counts && typeof o.counts === "object" ? (o.counts as Record<string, number>) : {});
        await this.d.ledger?.event({ client_tag: run.client_tag, lane: run.lane, run_id: jobId, event: "step", line: `${verb}: ${step} done by ${opts.by}${approver ? `, spend approved by ${approver}` : ""}.`, actor: opts.by }).catch(() => undefined);
        if (step === steps[steps.length - 1]) return this.result(jobId, verb, step, "done", counts, null, null, approver, null, this.nextLine(verb));
        continue;
      }
      if (kind === "nothing") return this.result(jobId, verb, step, "nothing", {}, null, null, approver, "no rows to work on", this.nextLine(verb));
      if (kind === "waiting") {
        const card = (await this.d.repo.openCardsForRun(jobId)).find((c) => c.kind === "spend_approval" && c.payload?.step === step) ?? null;
        const worst = typeof o.worstCaseCents === "number" ? o.worstCaseCents : Number(card?.payload?.worst_case_cents ?? 0);
        return this.result(jobId, verb, step, "waiting_approval", {}, worst, card?.card_id ?? null, null, str("why"), `ask a person; then ${verb}(job_id, approved_by="their name") runs it`);
      }
      if (kind === "parked") return this.result(jobId, verb, step, "parked", {}, null, null, approver, str("reason"), "read job(job_id); fix the cause or abort(job_id)");
      if (kind === "retry") return this.result(jobId, verb, step, "retry", {}, null, null, approver, str("error"), `${verb}(job_id) again; the third failure parks`);
      if (kind === "gate") return this.result(jobId, verb, step, "gate", {}, null, null, approver, str("why") ?? str("reason") ?? "the step's gate did not pass", "read job(job_id)");
      if (kind === "declined") return this.result(jobId, verb, step, "declined", {}, null, null, approver, "the spend was declined", "open a new job if the decision changes");
      if (kind === "stopped") return this.result(jobId, verb, step, "stopped", {}, null, null, approver, "the job was aborted", "jobs()");
      return this.result(jobId, verb, step, "refused", {}, null, null, approver, `unexpected outcome ${kind}`, "read job(job_id)");
    }
    return this.result(jobId, verb, steps[steps.length - 1]!, "done", {}, null, null, null, "every step of this verb was already done", this.nextLine(verb));
  }

  /** Approve the open spend card for a step, by name, and give the step its approval. */
  private async approve(run: RunRow, step: Step, approvedBy: string, by: string): Promise<string | null> {
    const cards = (await this.d.repo.openCardsForRun(run.run_id)).filter((c) => c.kind === "spend_approval" && c.payload?.step === step);
    if (cards.length === 0) return null;
    let cents = 0;
    for (const card of cards) {
      const worst = Number(card.payload?.worst_case_cents ?? 0);
      const tapped = await this.d.console.resolveAs(`${approvedBy} via ${by}`, "owner", card.card_id, "approve_spend");
      if (!tapped.ok) {
        log.warn("approval tap refused", { run_id: run.run_id, step, card_id: card.card_id, reason: tapped.reason, message: tapped.message });
        continue;
      }
      cents += Number.isFinite(worst) ? worst : 0;
    }
    if (cents > 0) await this.d.repo.approveStep(run.run_id, step, cents);
    await this.d.ledger?.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event: "approved", line: `${step}: spend of $${(cents / 100).toFixed(2)} approved by ${approvedBy}.`, actor: by }).catch(() => undefined);
    log.info("spend approved", { run_id: run.run_id, step, cents, approved_by: approvedBy, by });
    return approvedBy;
  }

  private async runStage(step: Step, run: RunRow, recipe: Recipe): Promise<{ kind: string }> {
    const s = this.d.stages;
    switch (step) {
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
      default:
        throw new Error(`no verb runs step ${step}`);
    }
  }

  private nextLine(verb: Verb): string {
    const i = VERB_ORDER.indexOf(verb);
    const next = VERB_ORDER[i + 1];
    if (!next) return "write_receipt(job_id, ...) so the next top-up can read how this one was pulled";
    if (next === "import") return "stage is done; import(job_id) when loads_paused is off and a person has said yes";
    return `${next}(job_id)`;
  }

  private result(job_id: string, verb: Verb, step: Step, status: VerbResult["status"], counts: Record<string, number>, worst: number | null, card: string | null, approved_by: string | null, why: string | null, next: string): VerbResult {
    const numbers: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) if (typeof v === "number" && Number.isFinite(v)) numbers[k] = v;
    return { job_id, verb, step, status, counts: numbers, worst_case_cents: worst, card_id: card, approved_by, why, next };
  }
}
