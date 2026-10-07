import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Repo } from "../db/repo.js";
import { presentRun, type RunRow, type Step } from "../domain/runs.js";
import { Orchestrator, type Stages } from "../orchestrator.js";
import type { Recipe } from "../recipes/schema.js";
import { attempt, poll, type Clock } from "../stages/common.js";
import { haltBeforeStep, parkIngestReason, resolveStopAfter } from "./halt.js";

const recipe = {
  recipe_id: "parlay.it_dm.v3",
  client_tag: "parlay",
  lane: "it_dm",
  smartlead_client_id: 418274,
  supabase_project: "azpapwtnrbzywlnxxecz",
  owner_approved_at: null,
  source: { kind: "getleads", params: { job_titles: ["IT Director"], company_size: ["11 to 50"], countries: ["United States"] }, widening_candidates: [] },
  suppression: { response_based: true, same_offer_any_client: true },
  email_finding: { enabled: false, fullenrich: false },
  verify: { seg_split: true },
  normalize: {},
  segments: { band: ["11_50"] },
  routing: [{ when: { band: "11_50" }, campaign_id: 4049055, icp: { kind: "linkedin_native", persona: "it_dm" } }],
  runway: { floor_days: 7, target_days: 30, max_per_run: 1000 },
  working: { interested_per_2000_sends: 1, variant_min_sends: 1000 },
  spend: { auto_cap_usd: 5 },
} as Recipe;

function runRow(counts: Record<string, number>): RunRow {
  return {
    run_id: "11111111-1111-1111-1111-111111111111",
    recipe_id: recipe.recipe_id,
    client_tag: recipe.client_tag,
    lane: recipe.lane,
    campaign_id: 4049055,
    trigger: "manual",
    status: "open",
    current_step: null,
    counts_by_status: { ...counts },
    spend_cents_by_vendor: {},
    slack_channel: null,
    slack_thread_ts: null,
    opened_by: "test",
    opened_at: "2026-10-07T00:00:00.000Z",
    closed_at: null,
    last_error: null,
  };
}

function harness(opts: { counts: Record<string, number>; paused: boolean; sizedTerminal: boolean }) {
  const run = runRow(opts.counts);
  const steps = new Map<string, string>();
  const calls: string[] = [];
  const receipts: string[] = [];
  const ingestJobs: string[] = [];
  const asks: Array<{ kind: string; step?: string; reason?: string }> = [];
  const stage = (name: string) => ({
    run: async () => {
      calls.push(name);
      steps.set(name, "done");
      return { kind: "done" as const, counts: {} };
    },
  });
  const repo = {
    async getRecipe() {
      return { recipe_id: recipe.recipe_id, body: recipe, owner_approved_at: null };
    },
    async repairCampaignRegistry() {
      return 0;
    },
    async campaignRegistry() {
      return [];
    },
    async campaignBuilds() {
      return [];
    },
    raw() {
      return { query: async () => ({ rows: [] }) };
    },
    async getRun() {
      return run;
    },
    async getStep(_id: string, step: Step) {
      const status = steps.get(step);
      return status ? { status } : null;
    },
    async setRunStatus(_id: string, status: RunRow["status"]) {
      if (status === "aborted" || run.status !== "aborted") run.status = status;
    },
    async mergeRunCounts(_id: string, counts: Record<string, number>) {
      run.counts_by_status = { ...run.counts_by_status, ...counts };
    },
    async openCardsForRun() {
      return [];
    },
    async loadsPaused() {
      return opts.paused;
    },
    async sizedIsTerminal() {
      return opts.sizedTerminal;
    },
    async ensureCore08() {
      return undefined;
    },
    async insertPullReceipt() {
      receipts.push("receipt");
    },
    async cancelRunningSteps() {
      return 0;
    },
  };
  const console_ = {
    async receipt(row: RunRow) {
      calls.push(`receipt:${row.status}`);
    },
    async ask(input: { kind: string; payload: { step?: string; reason?: string } }) {
      asks.push({ kind: input.kind, step: input.payload.step, reason: input.payload.reason });
    },
    async postInThread() {
      return { channel: "C", ts: "1" };
    },
  };
  const orchestrator = new Orchestrator({
    repo: repo as unknown as Repo,
    console: console_ as never,
    retryDelayMs: 1,
    sleep: async () => undefined,
    stages: {
      trigger: stage("trigger"),
      size: stage("size"),
      pull: stage("pull"),
      ingest: stage("ingest"),
      suppress: stage("suppress"),
      puzzle: stage("puzzle"),
      findEmails: stage("find_emails"),
      verify: stage("verify"),
      normalize: stage("normalize"),
      qa: stage("qa"),
      route: stage("route"),
      stage: stage("stage"),
      import: stage("import"),
      postImport: stage("post_import"),
      flip: stage("flip"),
    } as unknown as Stages,
  });
  return { orchestrator, run, calls, receipts, ingestJobs, asks };
}

describe("size-only dry run", () => {
  it("resolves dry_run and stop_after", () => {
    assert.equal(resolveStopAfter({ dryRun: true }), "size");
    assert.equal(resolveStopAfter({ stopAfter: "pull", dryRun: true }), "pull");
    assert.equal(resolveStopAfter({ stopAfter: "pilot" }), "pilot");
    assert.equal(resolveStopAfter({}), null);
    assert.equal(haltBeforeStep("pull", { stop_after_size: 1 }, false), "sized");
    assert.equal(haltBeforeStep("pull", { stop_after_pilot: 1 }, false), "sized");
    assert.equal(haltBeforeStep("size", { stop_after_size: 1 }, false), null);
    assert.equal(haltBeforeStep("ingest", { stop_after_pull: 1 }, false), "park_ingest");
    assert.equal(haltBeforeStep("ingest", {}, true), "park_ingest");
    assert.equal(haltBeforeStep("suppress", {}, true), null);
    assert.match(parkIngestReason({}, true), /loads are paused/);
  });

  it("a dry run sizes and closes, and never creates a pull receipt or an ingest job", async () => {
    const h = harness({ counts: { stop_after_size: 1 }, paused: false, sizedTerminal: true });
    await h.orchestrator.drive(h.run.run_id);
    assert.deepEqual(h.calls, ["trigger", "size", "receipt:sized"]);
    assert.equal(h.run.status, "sized");
    assert.equal(h.receipts.length, 0);
    assert.equal(h.ingestJobs.length, 0);
    assert.equal(h.asks.length, 0);
  });

  it("shows sized when the database still closes the row as done", async () => {
    const h = harness({ counts: { stop_after_size: 1 }, paused: false, sizedTerminal: false });
    await h.orchestrator.drive(h.run.run_id);
    assert.equal(h.run.status, "done");
    assert.equal(h.run.counts_by_status.sized, 1);
    assert.equal(presentRun(h.run).status, "sized");
    assert.deepEqual(h.calls, ["trigger", "size", "receipt:sized"]);
    assert.equal(h.receipts.length, 0);
    assert.equal(h.ingestJobs.length, 0);
  });

  it("parks at ingest while loads are paused and does not start ingest", async () => {
    const h = harness({ counts: {}, paused: true, sizedTerminal: true });
    await h.orchestrator.drive(h.run.run_id);
    assert.deepEqual(h.calls, ["trigger", "size", "pull"]);
    assert.equal(h.run.status, "awaiting_operator");
    assert.equal(h.asks.length, 1);
    assert.equal(h.asks[0]?.kind, "parked");
    assert.equal(h.asks[0]?.step, "ingest");
    assert.match(h.asks[0]?.reason ?? "", /loads are paused/);
    assert.equal(h.ingestJobs.length, 0);
    assert.equal(h.receipts.length, 0);
  });

  it("parks a counted pull before ingest, once", async () => {
    const h = harness({ counts: { stop_after_pull: 1 }, paused: false, sizedTerminal: true });
    await h.orchestrator.drive(h.run.run_id);
    assert.deepEqual(h.calls, ["trigger", "size", "pull"]);
    assert.equal(h.run.counts_by_status.stop_after_pull, 0);
    assert.equal(h.asks[0]?.step, "ingest");
    assert.match(h.asks[0]?.reason ?? "", /reviewed before ingest/);
  });
});

describe("abort cancels an in-flight ingest", () => {
  it("does not leave the step running or schedule another attempt", async () => {
    const run = runRow({});
    const step = { status: "pending", attempts: 0 };
    let failed = false;
    let began = 0;
    const repo = {
      async getRun() {
        return run;
      },
      async beginStep() {
        began += 1;
        step.attempts += 1;
        step.status = "running";
        return { ok: step.attempts <= 3, attempts: step.attempts };
      },
      async setRunStatus(_id: string, status: RunRow["status"]) {
        if (run.status !== "aborted") run.status = status;
      },
      async cancelRunningSteps() {
        step.status = "cancelled";
        return 1;
      },
      async failStep() {
        failed = true;
        step.status = "failed";
      },
    };
    const out = await attempt({ repo: repo as unknown as Repo, console: {} as never }, run, "ingest", "ingesting", async () => {
      run.status = "aborted";
      throw new Error("aborted");
    });
    assert.equal(out.kind, "stopped");
    assert.equal(step.status, "cancelled");
    assert.equal(step.attempts, 1);
    assert.equal(began, 1);
    assert.equal(failed, false);
    assert.equal(run.status, "aborted");
  });

  it("a poll stops when the run is aborted", async () => {
    let ticks = 0;
    const clock: Clock = { now: () => 0, sleep: async () => { ticks += 1; } };
    await assert.rejects(
      poll(async () => ({ state: "running" as const }), {
        pollMs: 1,
        deadMs: 60_000,
        clock,
        what: "LeadPipe ingest job",
        stop: () => ticks >= 1,
      }),
      /aborted/,
    );
    assert.equal(ticks, 1);
  });
});
