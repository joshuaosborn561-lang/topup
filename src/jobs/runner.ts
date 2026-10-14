import { ingestedTable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import { presentRun, runIsOpen, type RunRow, type Step } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import { isColdCall, isNeverTopUp, MIN_NET_NEW, OWNER_APPROVER_NAMES } from "../policy/rules.js";
import { topupQuoteCard } from "../console/cards.js";
import { usd } from "../spend/prices.js";
import { domainSql, icpWorstCaseCents } from "../stages/icp/index.js";
import { verifyWorstCaseCents } from "../stages/verify/verify.js";
import { columnsOf } from "../stages/common.js";
import { jobLane, jobSettings, parseJobSettings, type JobSettings, type JobSpec } from "./settings.js";
import { planLaneJob } from "./lanePlan.js";
import { plainError } from "./preflight.js";
import { isSelfStart, isWatchActor } from "./selfStart.js";
import type { DedupeStage } from "../stages/dedupe/index.js";
import type { IcpStage } from "../stages/icp/index.js";
import type { ImportStage } from "../stages/import/index.js";
import type { IngestStage } from "../stages/ingest/index.js";
import type { NormalizeStage } from "../stages/normalize/index.js";
import type { PostImportStage } from "../stages/post_import/index.js";
import type { QaStage } from "../stages/qa/index.js";
import type { RouteStage } from "../stages/route/index.js";
import type { StageStage } from "../stages/stage/index.js";
import type { SuppressStage } from "../stages/suppress/index.js";
import type { VerifyStage } from "../stages/verify/verify.js";
import { findableSql, findWorstCaseCents, type FindEmailsStage } from "../stages/find_emails/index.js";

const log = logger("topup");

/**
 * The top-up (D99). One job per campaign. Grokbot has already replayed the
 * campaign's recorded build with its own connectors and handed the pool
 * over as a file URL or a table. The service is the referee and the loader:
 *
 *   quote    ingest → dedupe against everything the client holds →
 *            unsubscribes and the DNC list → one card with the net-new
 *            count and the worst-case cost. Free. Nothing paid runs.
 *   approve  Josh or Cayden says yes by name → ICP website check → verify →
 *            normalize → qa → route → stage → import (when loads are not
 *            paused) → post-import check → the record is written.
 *   load     import a staged job later, once loads resume.
 *
 * Each phase runs in the background and `job(job_id)` reads it. Nothing
 * starts on its own. Nothing here sets a campaign ACTIVE. No row leaves
 * Postgres except to LeadPipe, the verifier and Smartlead.
 */
export interface Stages {
  ingest: IngestStage;
  dedupe: DedupeStage;
  suppress: SuppressStage;
  icp: IcpStage;
  /** D103: optional so a service without the email finder still quotes and loads the people who came with an email. */
  findEmails?: FindEmailsStage;
  verify: VerifyStage;
  normalize: NormalizeStage;
  qa: QaStage;
  route: RouteStage;
  stage: StageStage;
  import: ImportStage;
  postImport: PostImportStage;
}

export type Phase = "quote" | "approve" | "load";

export const PHASE_STEPS: Readonly<Record<Phase, readonly Step[]>> = {
  quote: ["ingest", "dedupe", "suppress"],
  approve: ["icp", "find_emails", "verify", "normalize", "qa", "route", "stage", "import", "post_import"],
  load: ["import", "post_import"],
};

export const QUOTE_CARD = "topup_quote";

/** How long a background phase may run before the job is marked failed. Verification of 2,000 rows can take an hour. */
export const PHASE_BACKGROUND_TIMEOUT_MS = 4 * 60 * 60_000;

export type TopupStatus = "started" | "done" | "quoted" | "waiting_approval" | "staged" | "parked" | "retry" | "gate" | "declined" | "stopped" | "refused" | "nothing";

export interface TopupResult {
  job_id: string;
  phase: Phase;
  step: Step;
  status: TopupStatus;
  counts: Record<string, number>;
  worst_case_cents: number | null;
  card_id: string | null;
  approved_by: string | null;
  why: string | null;
  next: string;
}

export interface Quote {
  /** New people who came with an email, ready to verify. */
  net_new: number;
  with_email: number;
  domains: number;
  worst_case_cents: number;
  icp_cents: number;
  verify_cents: number;
  /** D103: new people with no email that the finder will look up (name plus company). */
  to_find: number;
  find_cents: number;
  finder_ready: boolean;
}

export interface TopupRunnerDeps {
  repo: Repo;
  stages: Stages;
  console: { resolveAs(actor: string, role: "owner" | "operator" | null, cardId: string, choice: string): Promise<{ ok: boolean; message?: string; reason?: string }>; ask(input: { run: RunRow | null; kind: string; audience: "owner" | "operator"; payload: Record<string, unknown>; text: string; blocks: (cardId: string) => unknown[] }): Promise<{ card_id: string }> };
  ledger?: Pick<LaneLedger, "event">;
  now?: () => number;
  backgroundTimeoutMs?: number;
  /** Who may approve a top-up, by first name (TOPUP_APPROVERS in Railway). Default: Josh and Cayden (D92). */
  approvers?: readonly string[];
}

const cap = (n: string) => n[0]!.toUpperCase() + n.slice(1);

export function approverRule(names: readonly string[]): string {
  return `Only ${names.map(cap).join(" or ")} approves a top-up. Pass approved_by with their name after they said yes to the quoted count and cost.`;
}

/** Comma-separated first names, lower-cased; empty falls back to the D92 default. */
export function parseApprovers(raw: string | null | undefined): string[] {
  const names = (raw ?? "").split(",").map((n) => n.trim().toLowerCase()).filter(Boolean);
  return names.length ? names : [...OWNER_APPROVER_NAMES];
}

export class TopupRunner {
  private readonly inFlight = new Set<string>();
  readonly approvers: readonly string[];

  constructor(private readonly d: TopupRunnerDeps) {
    this.approvers = d.approvers && d.approvers.length ? d.approvers.map((n) => n.toLowerCase()) : [...OWNER_APPROVER_NAMES];
  }

  isApprover(name: string | null | undefined): boolean {
    return this.approvers.includes((name ?? "").trim().toLowerCase());
  }

  get rule(): string {
    return approverRule(this.approvers);
  }

  /**
   * Where an open job stands and what would move it: the quote phase until
   * its three free steps are done; the approve phase once a named yes was
   * recorded (the quote card resolved, icp or verify holding approved
   * cents); the load phase when it stopped at staged and loads resumed.
   * A deploy kills background phases (13 Oct 2026); boot calls this for
   * every open job with a step left 'running' and picks each one back up.
   */
  async resumable(jobId: string): Promise<{ phase: Phase; approved_by: string | null; interrupted: Step | null; parked?: Step | null } | null> {
    const run = await this.d.repo.getRun(jobId);
    if (!run || !runIsOpen(presentRun(run).status) || Number(run.counts_by_status?.grok_job) !== 1) return null;
    const stepRows = new Map<Step, Awaited<ReturnType<Repo["getStep"]>>>();
    for (const step of [...PHASE_STEPS.quote, ...PHASE_STEPS.approve]) stepRows.set(step, await this.d.repo.getStep(jobId, step));
    const interrupted = [...stepRows.entries()].find(([, r]) => r?.status === "running")?.[0] ?? null;
    // A parked step failed three times or was refused; it waits for a person, never for a restart.
    const parked = [...stepRows.entries()].find(([, r]) => r?.status === "parked")?.[0] ?? null;
    const done = (step: Step) => stepRows.get(step)?.status === "done";
    if (!PHASE_STEPS.quote.every(done)) return { phase: "quote", approved_by: null, interrupted, parked };
    const icp = stepRows.get("icp");
    const find = stepRows.get("find_emails");
    const verify = stepRows.get("verify");
    const recorded = [icp, find, verify].map((r) => (typeof r?.counts?.approved_by === "string" ? String(r.counts.approved_by) : null)).find(Boolean) ?? null;
    const approved = (icp?.approved_cents ?? 0) > 0 || (find?.approved_cents ?? 0) > 0 || (verify?.approved_cents ?? 0) > 0 || !!recorded;
    if (!approved) {
      // The three free steps are done. With the quote card up the job is
      // standing, waiting for a name; without one the process died between
      // the last step and the card, and the quote phase re-runs to post it.
      return (await this.openQuote(jobId)) ? null : { phase: "quote", approved_by: null, interrupted, parked };
    }
    if (!PHASE_STEPS.approve.every(done)) {
      const loadOnly = PHASE_STEPS.approve.filter((st) => st !== "import" && st !== "post_import").every(done);
      return { phase: loadOnly ? "load" : "approve", approved_by: recorded, interrupted, parked };
    }
    return null;
  }

  /** Pick an interrupted job back up: reset the step the restart cut off (its attempts are not its fault) and run the phase it was in. */
  async resume(jobId: string, by: string): Promise<TopupResult | null> {
    const r = await this.resumable(jobId);
    if (!r) return null;
    if (r.parked) {
      // Parked waits for a person by name; a status check or a restart never re-runs it.
      const step = await this.d.repo.getStep(jobId, r.parked);
      return this.result(jobId, r.phase, r.parked, "parked", {}, null, null, null, String(step?.last_error ?? `${r.parked} is parked`), `tell ${this.approvers.map(cap).join(" or ")} why; topup(job_id, approved_by="their name") tries ${r.parked} once more, or abort(job_id)`);
    }
    if (r.interrupted) await this.d.repo.resetStep(jobId, r.interrupted);
    const run = await this.d.repo.getRun(jobId);
    if (run) await this.event(run, "step", `${r.phase}: resumed by ${by}${r.interrupted ? ` at ${r.interrupted}` : ""}.`, by);
    return this.begin(jobId, r.phase, { by, approved_by: r.approved_by, resume: true });
  }

  /** On boot: every open job a restart cut off mid-phase. Nothing new starts; what a person already started finishes. */
  async resumeInterrupted(by: string): Promise<string[]> {
    const resumed: string[] = [];
    for (const run of await this.d.repo.openRuns()) {
      if (Number(run.counts_by_status?.grok_job) !== 1) continue;
      const r = await this.resumable(run.run_id);
      // A step left running, or a free quote with no card yet: both are a
      // cut-off. An approved tail waiting on a card or on paused loads is not.
      if (!r || r.parked || !(r.interrupted || r.phase === "quote")) continue;
      const out = await this.resume(run.run_id, by);
      if (out && out.status === "started") resumed.push(run.run_id);
    }
    return resumed;
  }

  /**
   * A campaign with no recorded build has no method to replay: the top-up
   * waits for Josh to record it (D99). A database error is not a missing
   * build; it propagates so open() can say what actually failed.
   */
  async hasRecordedBuild(clientTag: string, campaignId: number): Promise<boolean> {
    const { rows } = await this.d.repo
      .raw()
      .query<{ n: string }>(`select count(*)::text as n from topup.list_build_records where client_tag = $1 and $2::bigint = any(campaign_ids)`, [clientTag, campaignId]);
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /** Open a job for a lane (or one campaign, which points at its lane) with the pool Grokbot handed over. */
  async open(spec: JobSpec, by: string, campaignName: string | null): Promise<{ ok: true; job_id: string; lane: string; scope: "lane" | "campaign"; campaign_ids: number[]; pointed_from_campaign_id: number | null } | { ok: false; message: string }> {
    if (isWatchActor(by) || isSelfStart(by, "manual")) return { ok: false, message: "Nothing starts on its own (D51). Grokbot calls topup when a campaign runs low." };
    if (spec.campaign_id != null && isColdCall(campaignName)) return { ok: false, message: `#${spec.campaign_id} ${campaignName} is marked as cold call; the service ignores it (D54).` };
    if (spec.campaign_id != null && isNeverTopUp(spec.campaign_id, campaignName)) return { ok: false, message: `#${spec.campaign_id} is never topped up (D46).` };
    if (spec.campaign_id == null && !spec.lane) return { ok: false, message: "topup needs client_tag and a lane, or client_tag and campaign_id, plus source." };

    let split: Parameters<typeof jobSettings>[2] = null;
    let stoppedIds: number[] = [];
    const registry = await this.d.repo.campaignRegistry(spec.client_tag).catch(() => [] as Record<string, unknown>[]);
    const planned = await planLaneJob(this.d.repo.raw(), {
      client_tag: spec.client_tag,
      lane: spec.lane,
      campaign_id: spec.campaign_id,
      registry,
      names: campaignName && spec.campaign_id != null ? new Map([[spec.campaign_id, campaignName]]) : undefined,
    });
    if (planned.ok) {
      split = planned.split;
      stoppedIds = planned.stopped_ids;
    } else if (!planned.no_lane) {
      return { ok: false, message: planned.message };
    } else if (spec.campaign_id == null) {
      return { ok: false, message: `lane ${spec.lane ?? "(none)"} is not in campaign_registry. Adding it is a row in that table. Ask Josh.` };
    } else {
      let recorded: boolean;
      try {
        recorded = await this.hasRecordedBuild(spec.client_tag, spec.campaign_id);
      } catch (err) {
        return { ok: false, message: `Could not read topup.list_build_records (${plainError(err)}). That is a database error, not a missing build: try again, and ask Josh if it keeps failing.` };
      }
      if (!recorded) {
        return { ok: false, message: `#${spec.campaign_id} has no recorded build in topup.list_build_records. There is no method to replay; wait for Josh to record how this campaign was built (D99).` };
      }
    }

    const stamp = (this.d.now ?? Date.now)();
    let settings: JobSettings;
    try {
      settings = jobSettings(spec, stamp, split);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    const recipeLane = jobLane({ campaign_id: settings.campaign_id }, stamp);
    await this.d.repo.upsertRecipe({ recipe_id: settings.id, client_tag: settings.client_tag, lane: recipeLane, version: 1, body: settings, owner_approved_at: null });
    const opened = await this.d.repo.openRun({ recipe_id: settings.id, client_tag: spec.client_tag, lane: settings.lane, campaign_id: settings.campaign_id, trigger: "manual", opened_by: by });
    if (!opened.ok) {
      if (opened.reason === "self_start") return { ok: false, message: "Nothing starts on its own (D51)." };
      const who = settings.scope === "lane" ? `lane ${settings.lane}` : `#${settings.campaign_id}`;
      return { ok: false, message: `A job is already open for ${who}. Read jobs(), then job(job_id); finish it or abort it first.` };
    }
    const runId = opened.run.run_id;
    const targets = settings.campaign_ids.length ? settings.campaign_ids : [settings.campaign_id];
    await this.d.repo.mergeRunCounts(runId, { [`target_${settings.campaign_id}`]: 1, grok_job: 1, targets: targets.length, stopped_excluded: stoppedIds.length, lane_job: settings.scope === "lane" ? 1 : 0 });
    const trig = await this.d.repo.beginStep(runId, "trigger");
    if (trig.ok) await this.d.repo.finishStep(runId, "trigger", { useful_output: 1, counts: { job: 1, campaign_id: settings.campaign_id, targets: targets.length } });
    const targetNote = settings.scope === "lane" ? `lane ${settings.lane} (${targets.map((id) => `#${id}`).join(", ")}${stoppedIds.length ? `; ${stoppedIds.length} STOPPED excluded` : ""})` : `#${settings.campaign_id}`;
    const pointed = settings.pointed_from_campaign_id && settings.scope === "lane" ? ` (opened from #${settings.pointed_from_campaign_id}; top-ups size the lane)` : "";
    await this.event(opened.run, "run_opened", `Top-up ${runId.slice(0, 8)} opened by ${by} for ${targetNote}${pointed}: pool from ${spec.source.kind === "file_url" ? `${spec.source.urls.length} file(s)` : `table ${spec.source.table}`}.`, by, "quote runs now; job(job_id) for the count and the cost.");
    return { ok: true, job_id: runId, lane: settings.lane, scope: settings.scope, campaign_ids: targets, pointed_from_campaign_id: settings.pointed_from_campaign_id };
  }

  /** Start a phase in the background and answer at once. */
  async begin(jobId: string, phase: Phase, opts: { by: string; approved_by?: string | null; resume?: boolean }): Promise<TopupResult> {
    const first = PHASE_STEPS[phase][0]!;
    const run = await this.d.repo.getRun(jobId);
    if (!run) return this.result(jobId, phase, first, "refused", {}, null, null, null, "no such job", "jobs() lists them");
    if (Number(run.counts_by_status?.grok_job) !== 1) return this.result(jobId, phase, first, "refused", {}, null, null, null, "not a top-up job", "topup(...) opens one");
    const shown = presentRun(run);
    if (!runIsOpen(shown.status)) return this.result(jobId, phase, first, "refused", {}, null, null, null, `job is ${shown.status}`, "open a new job with topup(...)");
    if (phase === "approve" && !opts.resume) {
      const who = opts.approved_by?.trim() ?? "";
      if (!this.isApprover(who)) return this.result(jobId, phase, first, "refused", {}, null, null, null, `approved_by "${who || "(empty)"}" is not an approver. ${this.rule}`, `show the quote to ${this.approvers.map(cap).join(" or ")}; then topup(job_id, approved_by=their name)`);
      const quote = await this.openQuote(jobId);
      const spendCard = (await this.d.repo.openCardsForRun(jobId)).some((c) => c.kind === "spend_approval");
      if (!quote && !spendCard) {
        // A yes was already recorded and a step failed or was cut off: the same name picks the approved tail back up.
        const r = await this.resumable(jobId);
        if (r?.parked) {
          // A person, by name, asks for one more try of a parked step.
          await this.d.repo.resetStep(jobId, r.parked);
          await this.event(run, "step", `${r.phase}: ${r.parked} was parked; ${who} asked for one more try.`, opts.by);
          return this.begin(jobId, r.phase, { by: opts.by, approved_by: who, resume: true });
        }
        if (r && r.phase !== "quote") return this.begin(jobId, r.phase, { by: opts.by, approved_by: who, resume: true });
        return this.result(jobId, phase, first, "refused", {}, null, null, null, "no open quote or spend card on this job", "job(job_id); when the quote step is done the card is there, else the quote is still running");
      }
      if (quote && quote.payload.icp_ready === false) {
        return this.result(jobId, phase, first, "refused", {}, null, null, null, String(quote.payload.icp_note ?? "the ICP website check is not set up for this client"), "ask Josh to write the client's ICP label set (topup.icp_variants), then topup(job_id, approved_by=name)");
      }
    }
    if ((phase === "load" || phase === "approve") && (await this.d.repo.loadsPaused())) {
      if (phase === "load") return this.result(jobId, phase, first, "refused", {}, null, null, null, "loads are paused; nothing reaches Smartlead until loads_paused is off", "loads_paused(paused=false, by=Josh) when Josh says so, then load(job_id)");
    }
    const key = `${jobId}:${phase}`;
    if (!this.inFlight.has(key)) {
      this.inFlight.add(key);
      void this.runInBackground(jobId, phase, opts).finally(() => this.inFlight.delete(key));
    }
    return this.result(jobId, phase, first, "started", {}, null, null, null, null, `job(job_id) until the ${phase} phase is done`);
  }

  private async runInBackground(jobId: string, phase: Phase, opts: { by: string; approved_by?: string | null; resume?: boolean }): Promise<void> {
    const timeoutMs = Math.max(1, Math.floor(this.d.backgroundTimeoutMs ?? PHASE_BACKGROUND_TIMEOUT_MS));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${phase} still running after ${Math.round(timeoutMs / 60_000)} min; the background phase timed out. Ask Josh.`)), timeoutMs);
    });
    try {
      await Promise.race([this.run(jobId, phase, opts), deadline]);
    } catch (err) {
      await this.recordBackgroundFailure(jobId, phase, err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async recordBackgroundFailure(jobId: string, phase: Phase, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    log.error("phase failed in the background", { job_id: jobId, phase, error: message });
    try {
      const run = await this.d.repo.getRun(jobId);
      if (!run || !runIsOpen(run.status)) return;
      let step: Step = PHASE_STEPS[phase][0]!;
      for (const s of PHASE_STEPS[phase]) {
        const row = await this.d.repo.getStep(jobId, s);
        if (row?.status !== "done") {
          step = s;
          break;
        }
      }
      await this.d.repo.failStep(jobId, step, message, false);
      await this.d.repo.setRunStatus(jobId, "failed", step, message);
      await this.event(run, "step", `${phase}: ${step} failed: ${message.slice(0, 200)}`, "service");
    } catch (writeErr) {
      log.error("could not record background failure", { job_id: jobId, phase, error: (writeErr as Error).message });
    }
  }

  /** Run one phase to its end, or to the first thing a person must see. */
  async run(jobId: string, phase: Phase, opts: { by: string; approved_by?: string | null; resume?: boolean }): Promise<TopupResult> {
    const run = await this.d.repo.getRun(jobId);
    const steps = PHASE_STEPS[phase];
    const first = steps[0]!;
    if (!run) return this.result(jobId, phase, first, "refused", {}, null, null, null, "no such job", "jobs()");
    const rec = await this.d.repo.getRecipe(run.recipe_id);
    if (!rec) return this.result(jobId, phase, first, "refused", {}, null, null, null, `job settings ${run.recipe_id} are missing`, "open a new job");
    const settings = parseJobSettings(rec.body);
    let approver: string | null = null;
    // First yes: the quote card is open and its figures are the ceiling. A later named call (the person saw a higher number) or a resume carries no ceiling.
    const quoteWasOpen = phase === "approve" && !!(await this.openQuote(jobId));
    if (phase === "approve" && opts.approved_by) approver = (await this.approveQuote(run, opts.approved_by, opts.by)) ?? (opts.resume || this.isApprover(opts.approved_by) ? opts.approved_by : null);

    for (const step of steps) {
      const already = await this.d.repo.getStep(jobId, step);
      if (already?.status === "done") continue;
      if ((step === "import" || step === "post_import") && (await this.d.repo.loadsPaused())) {
        const counts = await this.funnel(run);
        await this.event(run, "step", `${phase}: staged and waiting; loads are paused. load(job_id) when Josh resumes loads.`, opts.by, "load(job_id) when loads_paused is off.");
        return this.result(jobId, phase, "stage", "staged", counts, null, null, approver, "loads are paused; the rows are staged and nothing reached Smartlead", "loads_paused(paused=false, by=Josh) when Josh says so, then load(job_id)");
      }
      let outcome = await this.runStage(step, run, settings);
      if (String(outcome.kind) === "waiting" && approver) {
        // A paid step priced itself above what the quote approved (the pool moved under it). Within a tenth of the quoted figure the
        // same name covers it; above that the person sees the new number first (a named yes is to an amount, D51).
        const named = await this.approveStepCards(run, step, approver, opts.by, quoteWasOpen ? await this.quotedFor(run.run_id, step) : null);
        if (named) outcome = await this.runStage(step, run, settings);
      }
      const o = outcome as unknown as Record<string, unknown>;
      const kind = String(o.kind);
      const str = (k: string): string | null => (typeof o[k] === "string" ? (o[k] as string) : null);
      if (kind === "done" || kind === "nothing") {
        await this.event(run, "step", `${phase}: ${step} ${kind === "done" ? "done" : "had nothing to do"}${approver ? ` (approved by ${approver})` : ""}.`, opts.by);
        continue;
      }
      if (kind === "waiting") {
        const card = (await this.d.repo.openCardsForRun(jobId)).find((c) => c.kind === "spend_approval" && c.payload?.step === step) ?? null;
        const worst = typeof o.worstCaseCents === "number" ? o.worstCaseCents : Number(card?.payload?.worst_case_cents ?? 0);
        return this.result(jobId, phase, step, "waiting_approval", {}, worst, card?.card_id ?? null, null, str("why"), `show ${this.approvers.map(cap).join(" or ")} the new cost; topup(job_id, approved_by=their name) runs it`);
      }
      if (kind === "parked") return this.result(jobId, phase, step, "parked", {}, null, null, approver, str("reason"), "read job(job_id); fix the cause or abort(job_id)");
      if (kind === "retry") return this.result(jobId, phase, step, "retry", {}, null, null, approver, str("error"), `call the same phase again; the third failure parks`);
      if (kind === "gate") {
        const why = str("why") ?? str("reason") ?? "the step's gate did not pass";
        if (phase === "quote" && step === "ingest") {
          // Nothing landed: the job is over. Close it so no abort is needed and the campaign is free for the next try.
          await this.d.repo.setRunStatus(jobId, "failed", step, why);
          await this.event(run, "receipt", `Closed: ${why.slice(0, 300)}`, opts.by, "Fix the pool and call topup again.");
          return this.result(jobId, phase, step, "gate", {}, null, null, approver, why, "the job closed itself; fix the pool and call topup again");
        }
        return this.result(jobId, phase, step, "gate", {}, null, null, approver, why, "read job(job_id)");
      }
      if (kind === "declined") return this.result(jobId, phase, step, "declined", {}, null, null, approver, "the spend was declined", "open a new job if the decision changes");
      if (kind === "stopped") return this.result(jobId, phase, step, "stopped", {}, null, null, approver, "the job was aborted", "jobs()");
      return this.result(jobId, phase, step, "refused", {}, null, null, approver, `unexpected outcome ${kind}`, "read job(job_id)");
    }

    if (phase === "quote") return this.postQuote(run, settings, opts.by);
    const counts = await this.funnel(run);
    if (!(counts.imported > 0)) {
      const why = `nothing was imported (staged ${counts.staged ?? 0}, imported ${counts.imported ?? 0}). Read job(job_id): the stage or import step says why.`;
      await this.d.repo.setRunStatus(jobId, "failed", "import", why);
      await this.event(run, "receipt", `Closed without a load: ${why}`, opts.by, "Nothing. Fix the cause and open a new job.");
      return this.result(jobId, phase, "import", "nothing", counts, null, null, approver, why, "nothing loaded; the job closed. Read its steps.");
    }
    const closed = await this.d.repo.getRun(jobId);
    if (closed && runIsOpen(closed.status)) await this.d.repo.setRunStatus(jobId, "done", "post_import");
    await this.event(run, "receipt", `Top-up done: ${counts.imported ?? 0} loaded into ${quoteTarget(settings)}. Josh flips ACTIVE by hand (D5).`, opts.by, "Nothing. Josh flips ACTIVE.");
    return this.result(jobId, phase, "post_import", "done", counts, null, null, approver, null, "nothing: the leads are in the campaign(s). Josh sets ACTIVE by hand.");
  }

  /** The count and the cost, as one card to Josh or Cayden. Nothing paid has run. */
  private async postQuote(run: RunRow, settings: JobSettings, by: string): Promise<TopupResult> {
    const quote = await this.quote(run);
    if (quote.net_new === 0 && (quote.to_find === 0 || !quote.finder_ready)) {
      const counts = await this.funnel(run);
      const why = `0 new leads for ${quoteTarget(settings)}: every row in the pool is already held by the client, unsubscribed, or without an address (ingested ${counts.rows_claimed ?? 0}, held ${counts.held ?? 0}, suppressed ${counts.suppressed ?? 0}).`;
      await this.d.repo.setRunStatus(run.run_id, "done", "suppress");
      await this.event(run, "receipt", why, by, "Nothing to approve. A bigger or different pool, or the TAM is exhausted.");
      return this.result(run.run_id, "quote", "suppress", "nothing", counts, 0, null, null, why, "nothing to approve; the job closed. Say the TAM for this campaign is exhausted unless the record shows a source you did not replay.");
    }
    const existing = await this.openQuote(run.run_id);
    // The floor (D46) is on everyone new: those with an email plus those the finder will look up (D103).
    const belowFloor = quote.net_new + (quote.finder_ready ? quote.to_find : 0) < MIN_NET_NEW;
    const icp = await this.icpReady(run.client_tag);
    const payload = { step: "quote", ...quote, campaign_id: settings.campaign_id, campaign_ids: settings.campaign_ids, lane: settings.scope === "lane" ? settings.lane : null, scope: settings.scope, pointed_from_campaign_id: settings.pointed_from_campaign_id, below_floor: belowFloor, floor: MIN_NET_NEW, icp_ready: icp.ready, icp_note: icp.note };
    let cardId = existing?.card_id ?? null;
    if (existing) {
      await this.d.repo.updateCardPayload(existing.card_id, payload);
    } else {
      const card = await this.d.console.ask({
        run,
        kind: QUOTE_CARD,
        audience: "owner",
        payload,
        text: `Top-up ${quoteTarget(settings)}: ${quote.net_new} new leads with an email${quote.to_find ? ` plus ${quote.to_find} to look up` : ""} for ${usd(quote.worst_case_cents)} worst case.`,
        blocks: (id) => topupQuoteCard({ cardId: id, runId: run.run_id, clientTag: run.client_tag, campaignId: settings.campaign_id, lane: settings.scope === "lane" ? settings.lane : null, campaignIds: settings.campaign_ids, quote }),
      });
      cardId = card.card_id;
    }
    await this.d.repo.setRunStatus(run.run_id, "awaiting_owner", "suppress");
    await this.event(run, "card_opened", `Quote for ${quoteTarget(settings)}: ${quote.net_new} net new with an address, ${quote.to_find} more to look up, ${quote.domains} domains, worst case ${usd(quote.worst_case_cents)}. Waiting for ${this.approvers.map(cap).join(" or ")}.`, by, "Show the quote; topup(job_id, approved_by=name) when they say yes.");
    const counts = { ...(await this.funnel(run)), net_new: quote.net_new, with_email: quote.with_email, domains: quote.domains, icp_cents: quote.icp_cents, verify_cents: quote.verify_cents, to_find: quote.to_find, find_cents: quote.find_cents, below_floor: belowFloor ? 1 : 0 };
    const floorNote = (belowFloor ? ` That is under the ${MIN_NET_NEW} floor (D46): say the TAM for this ${settings.scope === "lane" ? "lane" : "campaign"} looks exhausted unless the record shows a source not replayed; they decide (D102).` : "") + (icp.ready ? "" : ` ${icp.note}`);
    const splitNote =
      settings.scope === "lane"
        ? ` After the yes the new leads split into ${settings.campaign_ids.map((id) => `#${id}`).join(", ")}${settings.split_rule ? ` the way the recorded build split them (read from the lane's transcript, D107): ${settings.split_rule}` : " the way the record already segmented them"}. The count per campaign is decided after verification (the SEG split needs the verifier) and job(job_id) shows it at the route step.`
        : "";
    const findNote = quote.to_find
      ? quote.finder_ready
        ? ` Plus ${quote.to_find} more new people with no email that the email finder will look up after the yes (up to ${usd(quote.find_cents)} of the total; only the ones it finds are verified and loaded).`
        : ` ${quote.to_find} more new people have no email and the email finder is not connected on the service, so they are left out. Ask Josh.`
      : "";
    return this.result(run.run_id, "quote", "suppress", "quoted", counts, quote.worst_case_cents, cardId, null, null, `tell ${this.approvers.map(cap).join(" or ")}: ${quote.net_new} new leads with an email for ${quoteTarget(settings)}, up to ${usd(quote.worst_case_cents)} in all (ICP check ${usd(quote.icp_cents)}, email finder ${usd(quote.find_cents)}, verification ${usd(quote.verify_cents)}).${findNote}${splitNote}${floorNote} When they say yes: topup(job_id, approved_by="their name").${await this.pauseNote()}`);
  }

  /** Loads start paused (D102); the quote answer says so, so the yes and the unpause are asked for together. */
  private async pauseNote(): Promise<string> {
    const paused = await this.d.repo.loadsPaused().catch(() => false);
    return paused ? ` Loads are paused: after the yes the job stops at staged; an approver's loads_paused(paused=false, by="their name") and then load(job_id) sends it to Smartlead.` : "";
  }

  /** Net new after held and unsubscribes, and the worst case of everything paid that follows (ICP check + verification). */
  async quote(run: RunRow): Promise<Quote> {
    const table = ingestedTable(run.client_tag);
    const cols = await columnsOf(this.d.repo, table);
    const dsql = domainSql(cols);
    const { rows } = await this.d.repo
      .raw()
      .query<{ n: string; with_email: string; domains: string }>(
        `select count(*)::text as n, count(*) filter (where coalesce(email, '') <> '')::text as with_email, count(distinct ${dsql})::text as domains
           from ${table} where run_id = $1 and lead_status = 'needs_verify'`,
        [run.run_id],
      );
    const netNew = Number(rows[0]?.n ?? 0);
    const withEmail = Number(rows[0]?.with_email ?? 0);
    // D103: the people with no email the finder can look up, and the companies the ICP check grades across both.
    const finderReady = this.d.stages.findEmails?.ready() ?? false;
    const canFind = cols.has("first_name") && cols.has("last_name") && cols.has("company_domain") && cols.has("company_name");
    const { rows: more } = canFind
      ? await this.d.repo
          .raw()
          .query<{ to_find: string; domains: string }>(
            `select count(*) filter (where lead_status = 'needs_email' and ${findableSql()})::text as to_find,
                    count(distinct ${dsql})::text as domains
               from ${table} where run_id = $1 and lead_status in ('needs_verify', 'needs_email')`,
            [run.run_id],
          )
      : { rows: [] as Array<{ to_find: string; domains: string }> };
    const toFind = Number(more[0]?.to_find ?? 0);
    const domains = Math.max(Number(rows[0]?.domains ?? 0), Number(more[0]?.domains ?? 0));
    const icp = icpWorstCaseCents(domains);
    const find = finderReady ? findWorstCaseCents(toFind) : 0;
    // Every address the finder might return is verified too, so verification is priced on both.
    const verify = verifyWorstCaseCents(withEmail + (finderReady ? toFind : 0));
    return { net_new: netNew, with_email: withEmail, domains, worst_case_cents: icp + find + verify, icp_cents: icp, verify_cents: verify, to_find: toFind, find_cents: find, finder_ready: finderReady };
  }

  /** What an open job is waiting for, for `topup(job_id)` with no name: the quote if one is posted, else the phase to resume. */
  async standing(jobId: string, by: string): Promise<TopupResult | { job_id: string; status: "quoted"; quote: Record<string, unknown>; next: string } | null> {
    const run = await this.d.repo.getRun(jobId);
    if (!run) return null;
    const card = await this.openQuote(jobId);
    if (card) {
      const q = card.payload;
      return { job_id: jobId, status: "quoted", quote: { net_new: q.net_new, with_email: q.with_email, to_find: q.to_find ?? 0, domains: q.domains, worst_case_cents: q.worst_case_cents, icp_cents: q.icp_cents, find_cents: q.find_cents ?? 0, verify_cents: q.verify_cents, card_id: card.card_id }, next: `tell ${this.approvers.map(cap).join(" or ")} the count and the cost; when they say yes: topup(job_id, approved_by="their name").${await this.pauseNote()}` };
    }
    return this.resume(jobId, by);
  }

  /** The ICP website check needs the client's label set before anything paid runs (D60); the quote says so up front instead of the approved tail parking. */
  private async icpReady(clientTag: string): Promise<{ ready: boolean; note: string }> {
    try {
      const { rows } = await this.d.repo.raw().query<{ n: string }>(`select count(*)::text as n from topup.icp_variants where client_tag = $1`, [clientTag]);
      if (Number(rows[0]?.n ?? 0) > 0) return { ready: true, note: "" };
      return { ready: false, note: `No ICP label set for ${clientTag} in topup.icp_variants: the website check cannot run, so a yes would park. Ask Josh to write it first.` };
    } catch {
      return { ready: true, note: "" };
    }
  }

  private async openQuote(jobId: string): Promise<{ card_id: string; payload: Record<string, unknown> } | null> {
    return (await this.d.repo.openCardsForRun(jobId)).find((c) => c.kind === QUOTE_CARD) ?? null;
  }

  /** Josh or Cayden said yes to the quote: resolve the card by name and give the paid steps their ceiling. */
  private async approveQuote(run: RunRow, approvedBy: string, by: string): Promise<string | null> {
    const card = await this.openQuote(run.run_id);
    if (!card) return null;
    const tapped = await this.d.console.resolveAs(`${approvedBy} via ${by}`, "owner", card.card_id, "approve_spend");
    if (!tapped.ok) {
      log.warn("quote approval refused", { run_id: run.run_id, card_id: card.card_id, reason: tapped.reason });
      return null;
    }
    const icp = Number(card.payload.icp_cents ?? 0);
    const find = Number(card.payload.find_cents ?? 0);
    const verify = Number(card.payload.verify_cents ?? 0);
    if (icp > 0) await this.d.repo.approveStep(run.run_id, "icp", icp, approvedBy);
    if (find > 0) await this.d.repo.approveStep(run.run_id, "find_emails", find, approvedBy);
    if (verify > 0) await this.d.repo.approveStep(run.run_id, "verify", verify, approvedBy);
    await this.d.repo.setRunStatus(run.run_id, "open", "icp");
    await this.event(run, "approved", `Quote approved by ${approvedBy}: ${card.payload.net_new} net new with an email${find > 0 ? ` plus ${card.payload.to_find} to look up` : ""}, worst case ${usd(icp + find + verify)}.`, by, "ICP check, find emails, verify, normalize, qa, stage, load.");
    return approvedBy;
  }

  /** What the quote said this step would cost, from the quote card that was resolved (null when unknown). */
  private async quotedFor(jobId: string, step: Step): Promise<number | null> {
    const row = await this.d.repo.getStep(jobId, step);
    const c = row?.approved_cents;
    return c == null ? null : Number(c);
  }

  /**
   * A step's own spend card, approved by the same name. `quoted` is the
   * ceiling the person already said yes to; a card more than a tenth above it
   * is left open for a fresh yes to the new number.
   */
  private async approveStepCards(run: RunRow, step: Step, approvedBy: string, by: string, quoted: number | null = null): Promise<string | null> {
    const cards = (await this.d.repo.openCardsForRun(run.run_id)).filter((c) => c.kind === "spend_approval" && c.payload?.step === step);
    if (quoted != null) {
      const asked = cards.reduce((a, c) => a + Number(c.payload?.worst_case_cents ?? 0), 0);
      if (asked > Math.ceil(quoted * 1.1)) {
        await this.event(run, "card_opened", `${step}: priced at ${usd(asked)}, above the ${usd(quoted)} ${approvedBy} said yes to. Waiting for a yes to the new number.`, by, `topup(job_id, approved_by=name) after they see ${usd(asked)}.`);
        return null;
      }
    }
    let cents = 0;
    for (const card of cards) {
      const tapped = await this.d.console.resolveAs(`${approvedBy} via ${by}`, "owner", card.card_id, "approve_spend");
      if (tapped.ok) cents += Number(card.payload?.worst_case_cents ?? 0);
    }
    if (cents <= 0) return null;
    await this.d.repo.approveStep(run.run_id, step, cents, approvedBy);
    await this.event(run, "approved", `${step}: ${usd(cents)} approved by ${approvedBy} (above the quote).`, by);
    return approvedBy;
  }

  /** Abort any open job: running steps stop, claimed rows go back, open cards close. Nothing is loaded by an aborted job. */
  /**
   * Abort an open job. Running steps stop and open cards close. The rows the
   * job brought in and never loaded are taken back out of the lane table
   * (a file pool: deleted, so the next pull of the same people is not
   * counted as "already in the lane"; a table pool: released to run_id null
   * under the job's label). Rows that reached staging or Smartlead stay.
   * Nothing is sent by an aborted job.
   */
  async abort(jobId: string, by: string): Promise<{ ok: true; released: number; removed: number } | { ok: false; message: string }> {
    const run = await this.d.repo.getRun(jobId);
    if (!run) return { ok: false, message: "no such job" };
    if (!runIsOpen(presentRun(run).status)) return { ok: false, message: `job ${jobId.slice(0, 8)} is already ${presentRun(run).status}` };
    await this.d.repo.cancelRunningSteps(jobId, `aborted by ${by}`);
    const rec = await this.d.repo.getRecipe(run.recipe_id).catch(() => null);
    let fromFile = false;
    try {
      fromFile = rec ? parseJobSettings(rec.body).source.kind === "file_url" : false;
    } catch {
      fromFile = false;
    }
    let released = 0;
    let removed = 0;
    try {
      const out = await this.d.repo.withRun(jobId, async (tx) => {
        const table = ingestedTable(run.client_tag);
        const keep = `('staged', 'imported', 'import_mismatch')`;
        if (fromFile) {
          const del = await tx.query(`delete from ${table} where run_id = $1 and lead_status not in ${keep}`, [jobId]);
          return { released: 0, removed: del.rowCount ?? 0 };
        }
        // A table pool pointed at the lane table was relabelled for this job
        // (ingest keeps the bot's label under qa_flags.pool_label); give the
        // label back so the same table + where finds the rows again.
        const rel = await tx.query(
          `update ${table} set lead_status = 'ingested', run_id = null, verify_batch = null, status_changed_at = now(),
             source_label = coalesce(qa_flags->>'pool_label', source_label),
             qa_flags = coalesce(qa_flags, '{}'::jsonb) - 'pool_label'
           where run_id = $1 and lead_status not in ${keep}`,
          [jobId],
        );
        return { released: rel.rowCount ?? 0, removed: 0 };
      });
      released = out.released;
      removed = out.removed;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (!(e.code === "42P01" || /does not exist/i.test(e.message ?? ""))) throw err;
    }
    for (const card of await this.d.repo.openCardsForRun(jobId)) {
      if (card.kind === "stall") continue;
      await this.d.console.resolveAs(by, "operator", card.card_id, "abort").catch(() => undefined);
    }
    await this.d.repo.setRunStatus(jobId, "aborted", undefined, `aborted by ${by}`);
    await this.event(run, "receipt", `Aborted by ${by}. ${removed} rows the job brought in were taken back out of the lane table; ${released} released. Nothing was sent.`, by, "Nothing queued.");
    return { ok: true, released, removed };
  }

  private async funnel(run: RunRow): Promise<Record<string, number>> {
    const fresh = await this.d.repo.getRun(run.run_id);
    return numbers(fresh?.counts_by_status ?? {});
  }

  private async event(run: RunRow, event: string, line: string, actor: string, nextIntent?: string): Promise<void> {
    await this.d.ledger?.event({ client_tag: run.client_tag, lane: run.lane, run_id: run.run_id, event, line, actor, next_intent: nextIntent ?? null }).catch(() => undefined);
  }

  private async runStage(step: Step, run: RunRow, settings: JobSettings): Promise<{ kind: string }> {
    const s = this.d.stages;
    switch (step) {
      case "ingest":
        return s.ingest.run(run, settings);
      case "dedupe":
        return s.dedupe.run(run, settings);
      case "suppress":
        return s.suppress.run(run, settings);
      case "icp":
        return s.icp.run(run, settings);
      case "find_emails":
        if (s.findEmails) return s.findEmails.run(run, settings);
        await this.d.repo.finishStep(run.run_id, "find_emails", { useful_output: 0, counts: { finder_not_wired: 1 } });
        return { kind: "nothing" };
      case "verify":
        return s.verify.run(run, settings);
      case "normalize":
        return s.normalize.run(run, settings);
      case "qa":
        return s.qa.run(run, settings);
      case "route":
        return s.route.run(run, settings);
      case "stage":
        return s.stage.run(run, settings);
      case "import":
        return s.import.run(run, settings);
      case "post_import":
        return s.postImport.run(run, settings);
      default:
        throw new Error(`no phase runs step ${step}`);
    }
  }

  private result(job_id: string, phase: Phase, step: Step, status: TopupStatus, counts: Record<string, number>, worst: number | null, card: string | null, approved_by: string | null, why: string | null, next: string): TopupResult {
    return { job_id, phase, step, status, counts: numbers(counts), worst_case_cents: worst, card_id: card, approved_by, why, next };
  }
}

function quoteTarget(settings: JobSettings): string {
  if (settings.scope === "lane") {
    const ids = (settings.campaign_ids.length ? settings.campaign_ids : [settings.campaign_id]).map((id) => `#${id}`).join(", ");
    return `lane ${settings.lane} (${ids})`;
  }
  return `#${settings.campaign_id}`;
}

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
}
