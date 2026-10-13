import { ingestedTable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";
import { presentRun, runIsOpen, type RunRow, type Step } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";
import { logger } from "../lib/log.js";
import { isColdCall, isNeverTopUp, isOwnerApprover, OWNER_APPROVER_NAMES } from "../policy/rules.js";
import { topupQuoteCard } from "../console/cards.js";
import { usd } from "../spend/prices.js";
import { domainSql, icpWorstCaseCents } from "../stages/icp/index.js";
import { verifyWorstCaseCents } from "../stages/verify/verify.js";
import { columnsOf } from "../stages/common.js";
import { jobLane, jobSettings, parseJobSettings, type JobSettings, type JobSpec } from "./settings.js";
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
  approve: ["icp", "verify", "normalize", "qa", "route", "stage", "import", "post_import"],
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
  net_new: number;
  with_email: number;
  domains: number;
  worst_case_cents: number;
  icp_cents: number;
  verify_cents: number;
}

export interface TopupRunnerDeps {
  repo: Repo;
  stages: Stages;
  console: { resolveAs(actor: string, role: "owner" | "operator" | null, cardId: string, choice: string): Promise<{ ok: boolean; message?: string; reason?: string }>; ask(input: { run: RunRow | null; kind: string; audience: "owner" | "operator"; payload: Record<string, unknown>; text: string; blocks: (cardId: string) => unknown[] }): Promise<{ card_id: string }> };
  ledger?: Pick<LaneLedger, "event">;
  now?: () => number;
  backgroundTimeoutMs?: number;
}

export const APPROVER_RULE = `Only ${OWNER_APPROVER_NAMES.map((n) => n[0]!.toUpperCase() + n.slice(1)).join(" or ")} approves a top-up (D92). Pass approved_by with their name after they said yes to the quoted count and cost.`;

export class TopupRunner {
  private readonly inFlight = new Set<string>();

  constructor(private readonly d: TopupRunnerDeps) {}

  /** A campaign with no recorded build has no method to replay: the top-up waits for Josh to record it (D99). */
  async hasRecordedBuild(clientTag: string, campaignId: number): Promise<boolean> {
    const { rows } = await this.d.repo
      .raw()
      .query<{ n: string }>(`select count(*)::text as n from topup.list_build_records where client_tag = $1 and $2::bigint = any(campaign_ids)`, [clientTag, campaignId])
      .catch(() => ({ rows: [] as Array<{ n: string }> }));
    return Number(rows[0]?.n ?? 0) > 0;
  }

  /** Open a job for one campaign with the pool Grokbot handed over, then start the free quote in the background. */
  async open(spec: JobSpec, by: string, campaignName: string | null): Promise<{ ok: true; job_id: string; lane: string } | { ok: false; message: string }> {
    if (isWatchActor(by) || isSelfStart(by, "manual")) return { ok: false, message: "Nothing starts on its own (D51). Grokbot calls topup when a campaign runs low." };
    if (isColdCall(campaignName)) return { ok: false, message: `#${spec.campaign_id} ${campaignName} is marked as cold call; the service ignores it (D54).` };
    if (isNeverTopUp(spec.campaign_id, campaignName)) return { ok: false, message: `#${spec.campaign_id} is never topped up (D46).` };
    if (!(await this.hasRecordedBuild(spec.client_tag, spec.campaign_id))) {
      return { ok: false, message: `#${spec.campaign_id} has no recorded build in topup.list_build_records. There is no method to replay; wait for Josh to record how this campaign was built (D99).` };
    }
    const stamp = (this.d.now ?? Date.now)();
    let settings: JobSettings;
    try {
      settings = jobSettings(spec, stamp);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    await this.d.repo.upsertRecipe({ recipe_id: settings.id, client_tag: settings.client_tag, lane: jobLane(spec, stamp), version: 1, body: settings, owner_approved_at: null });
    const opened = await this.d.repo.openRun({ recipe_id: settings.id, client_tag: spec.client_tag, lane: settings.lane, campaign_id: spec.campaign_id, trigger: "manual", opened_by: by });
    if (!opened.ok) {
      if (opened.reason === "self_start") return { ok: false, message: "Nothing starts on its own (D51)." };
      return { ok: false, message: `A job is already open for #${spec.campaign_id}. Read jobs(), then job(job_id); finish it or abort it first.` };
    }
    const runId = opened.run.run_id;
    await this.d.repo.mergeRunCounts(runId, { [`target_${spec.campaign_id}`]: 1, grok_job: 1 });
    const trig = await this.d.repo.beginStep(runId, "trigger");
    if (trig.ok) await this.d.repo.finishStep(runId, "trigger", { useful_output: 1, counts: { job: 1, campaign_id: spec.campaign_id } });
    await this.event(opened.run, "run_opened", `Top-up ${runId.slice(0, 8)} opened by ${by} for #${spec.campaign_id}: pool from ${spec.source.kind === "file_url" ? `${spec.source.urls.length} file(s)` : `table ${spec.source.table}`}.`, by, "quote runs now; job(job_id) for the count and the cost.");
    return { ok: true, job_id: runId, lane: settings.lane };
  }

  /** Start a phase in the background and answer at once. */
  async begin(jobId: string, phase: Phase, opts: { by: string; approved_by?: string | null }): Promise<TopupResult> {
    const first = PHASE_STEPS[phase][0]!;
    const run = await this.d.repo.getRun(jobId);
    if (!run) return this.result(jobId, phase, first, "refused", {}, null, null, null, "no such job", "jobs() lists them");
    if (Number(run.counts_by_status?.grok_job) !== 1) return this.result(jobId, phase, first, "refused", {}, null, null, null, "not a top-up job", "topup(...) opens one");
    const shown = presentRun(run);
    if (!runIsOpen(shown.status)) return this.result(jobId, phase, first, "refused", {}, null, null, null, `job is ${shown.status}`, "open a new job with topup(...)");
    if (phase === "approve") {
      const who = opts.approved_by?.trim() ?? "";
      if (!isOwnerApprover(who)) return this.result(jobId, phase, first, "refused", {}, null, null, null, `approved_by "${who || "(empty)"}" is not an approver. ${APPROVER_RULE}`, "show the quote to Josh or Cayden; then topup(job_id, approved_by=their name)");
      const quote = await this.openQuote(jobId);
      if (!quote) return this.result(jobId, phase, first, "refused", {}, null, null, null, "no open quote on this job", "job(job_id); when the quote step is done the card is there, else the quote is still running");
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

  private async runInBackground(jobId: string, phase: Phase, opts: { by: string; approved_by?: string | null }): Promise<void> {
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
  async run(jobId: string, phase: Phase, opts: { by: string; approved_by?: string | null }): Promise<TopupResult> {
    const run = await this.d.repo.getRun(jobId);
    const steps = PHASE_STEPS[phase];
    const first = steps[0]!;
    if (!run) return this.result(jobId, phase, first, "refused", {}, null, null, null, "no such job", "jobs()");
    const rec = await this.d.repo.getRecipe(run.recipe_id);
    if (!rec) return this.result(jobId, phase, first, "refused", {}, null, null, null, `job settings ${run.recipe_id} are missing`, "open a new job");
    const settings = parseJobSettings(rec.body);
    let approver: string | null = null;
    if (phase === "approve" && opts.approved_by) approver = await this.approveQuote(run, opts.approved_by, opts.by);

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
        // A paid step priced itself above what the quote approved (the pool changed under it). Approve by the same name and run once more.
        const named = await this.approveStepCards(run, step, approver, opts.by);
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
        return this.result(jobId, phase, step, "waiting_approval", {}, worst, card?.card_id ?? null, null, str("why"), `show Josh or Cayden the new cost; topup(job_id, approved_by=their name) runs it`);
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
    const closed = await this.d.repo.getRun(jobId);
    if (closed && runIsOpen(closed.status)) await this.d.repo.setRunStatus(jobId, "done", "post_import");
    await this.event(run, "receipt", `Top-up done: ${counts.imported ?? 0} loaded into #${settings.campaign_id}. Josh flips ACTIVE by hand (D5).`, opts.by, "Nothing. Josh flips ACTIVE.");
    return this.result(jobId, phase, "post_import", "done", counts, null, null, approver, null, "nothing: the leads are in the campaign. Josh sets it ACTIVE by hand.");
  }

  /** The count and the cost, as one card to Josh or Cayden. Nothing paid has run. */
  private async postQuote(run: RunRow, settings: JobSettings, by: string): Promise<TopupResult> {
    const quote = await this.quote(run);
    const existing = await this.openQuote(run.run_id);
    const payload = { step: "quote", ...quote, campaign_id: settings.campaign_id };
    let cardId = existing?.card_id ?? null;
    if (existing) {
      await this.d.repo.updateCardPayload(existing.card_id, payload);
    } else {
      const card = await this.d.console.ask({
        run,
        kind: QUOTE_CARD,
        audience: "owner",
        payload,
        text: `Top-up #${settings.campaign_id}: ${quote.net_new} new leads for ${usd(quote.worst_case_cents)} worst case.`,
        blocks: (id) => topupQuoteCard({ cardId: id, runId: run.run_id, clientTag: run.client_tag, campaignId: settings.campaign_id, quote }),
      });
      cardId = card.card_id;
    }
    await this.d.repo.setRunStatus(run.run_id, "awaiting_owner", "suppress");
    await this.event(run, "card_opened", `Quote for #${settings.campaign_id}: ${quote.net_new} net new (${quote.with_email} with an address, ${quote.domains} domains), worst case ${usd(quote.worst_case_cents)}. Waiting for Josh or Cayden.`, by, "Show the quote; topup(job_id, approved_by=name) when they say yes.");
    const counts = { ...(await this.funnel(run)), net_new: quote.net_new, with_email: quote.with_email, domains: quote.domains, icp_cents: quote.icp_cents, verify_cents: quote.verify_cents };
    return this.result(run.run_id, "quote", "suppress", "quoted", counts, quote.worst_case_cents, cardId, null, null, `tell Josh or Cayden: ${quote.net_new} new leads for #${settings.campaign_id}, up to ${usd(quote.worst_case_cents)}. When one of them says yes: topup(job_id, approved_by="their name").`);
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
    const domains = Number(rows[0]?.domains ?? 0);
    const icp = icpWorstCaseCents(domains);
    const verify = verifyWorstCaseCents(withEmail);
    return { net_new: netNew, with_email: withEmail, domains, worst_case_cents: icp + verify, icp_cents: icp, verify_cents: verify };
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
    const verify = Number(card.payload.verify_cents ?? 0);
    if (icp > 0) await this.d.repo.approveStep(run.run_id, "icp", icp, approvedBy);
    if (verify > 0) await this.d.repo.approveStep(run.run_id, "verify", verify, approvedBy);
    await this.d.repo.setRunStatus(run.run_id, "open", "icp");
    await this.event(run, "approved", `Quote approved by ${approvedBy}: ${card.payload.net_new} net new, worst case ${usd(icp + verify)}.`, by, "ICP check, verify, normalize, qa, stage, load.");
    return approvedBy;
  }

  /** A step's own spend card, approved by the same name (the pool moved under the quote). */
  private async approveStepCards(run: RunRow, step: Step, approvedBy: string, by: string): Promise<string | null> {
    const cards = (await this.d.repo.openCardsForRun(run.run_id)).filter((c) => c.kind === "spend_approval" && c.payload?.step === step);
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
  async abort(jobId: string, by: string): Promise<{ ok: true; released: number } | { ok: false; message: string }> {
    const run = await this.d.repo.getRun(jobId);
    if (!run) return { ok: false, message: "no such job" };
    if (!runIsOpen(presentRun(run).status)) return { ok: false, message: `job ${jobId.slice(0, 8)} is already ${presentRun(run).status}` };
    await this.d.repo.cancelRunningSteps(jobId, `aborted by ${by}`);
    let released = 0;
    try {
      released = await this.d.repo.withRun(jobId, async (tx) => {
        const { rowCount } = await tx.query(
          `update ${ingestedTable(run.client_tag)} set lead_status = 'needs_verify', run_id = null, verify_batch = null, status_changed_at = now()
           where run_id = $1 and lead_status in ('verifying', 'claimed', 'reserved', 'pulling')`,
          [jobId],
        );
        return rowCount ?? 0;
      });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (!(e.code === "42P01" || /does not exist/i.test(e.message ?? ""))) throw err;
    }
    for (const card of await this.d.repo.openCardsForRun(jobId)) {
      if (card.kind === "stall") continue;
      await this.d.console.resolveAs(by, "operator", card.card_id, "abort").catch(() => undefined);
    }
    await this.d.repo.setRunStatus(jobId, "aborted", undefined, `aborted by ${by}`);
    await this.event(run, "receipt", `Aborted by ${by}. ${released} rows released. Nothing was sent.`, by, "Nothing queued.");
    return { ok: true, released };
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

function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
}
