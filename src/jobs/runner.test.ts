import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunRow } from "../domain/runs.js";
import { PHASE_STEPS, QUOTE_CARD, TopupRunner } from "./runner.js";

/**
 * D99 — a top-up is one job per campaign: free quote first, then the paid
 * tail only after Josh or Cayden says yes by name, then the load. Nothing
 * runs without a recorded build. Ask Josh or Cayden.
 */
function fakeRepo(opts: { loadsPaused?: boolean; recorded?: boolean; needsVerify?: number } = {}) {
  const runs = new Map<string, RunRow>();
  const steps = new Map<string, { status: string; attempts: number; approved_cents: number; counts?: Record<string, unknown> }>();
  const cards: Array<{ card_id: string; run_id: string; kind: string; payload: Record<string, unknown>; status: string; audience: string }> = [];
  const recipes = new Map<string, unknown>();
  const events: string[] = [];
  let n = 0;
  const repo = {
    runs, steps, cards, recipes, events,
    upsertRecipe: async (r: { recipe_id: string; body: unknown }) => { recipes.set(r.recipe_id, r.body); },
    getRecipe: async (id: string) => (recipes.has(id) ? { recipe_id: id, body: recipes.get(id), owner_approved_at: null } : null),
    openRun: async (input: { recipe_id: string; client_tag: string; lane: string; campaign_id: number | null; trigger: string; opened_by: string | null }) => {
      if ([...runs.values()].some((r) => r.campaign_id === input.campaign_id && !["done", "aborted", "failed"].includes(r.status))) return { ok: false as const, reason: "already_open" as const };
      const run = { run_id: `run-${++n}`, status: "open", current_step: null, counts_by_status: {}, spend_cents_by_vendor: {}, opened_at: "2026-10-13", closed_at: null, last_error: null, slack_channel: null, slack_thread_ts: null, ...input } as unknown as RunRow;
      runs.set(run.run_id, run);
      return { ok: true as const, run };
    },
    getRun: async (id: string) => runs.get(id) ?? null,
    mergeRunCounts: async (id: string, counts: Record<string, number>) => { const r = runs.get(id)!; r.counts_by_status = { ...r.counts_by_status, ...counts }; },
    beginStep: async (id: string, step: string) => { const k = `${id}/${step}`; const s = steps.get(k) ?? { status: "pending", attempts: 0, approved_cents: 0 }; s.attempts += 1; s.status = "running"; steps.set(k, s); return { ok: true, attempts: s.attempts }; },
    finishStep: async (id: string, step: string) => { const k = `${id}/${step}`; const s = steps.get(k) ?? { status: "pending", attempts: 1, approved_cents: 0 }; s.status = "done"; steps.set(k, s); },
    getStep: async (id: string, step: string) => { const s = steps.get(`${id}/${step}`); return s ? { step, worst_case_cents: 0, useful_output: null, counts: s.counts ?? {}, ...s } : null; },
    openCardsForRun: async (id: string) => cards.filter((c) => c.run_id === id && c.status === "open"),
    approveStep: async (id: string, step: string, cents: number, approvedBy?: string) => {
      const k = `${id}/${step}`;
      const s = steps.get(k) ?? { status: "pending", attempts: 0, approved_cents: 0, counts: {} };
      s.approved_cents = Math.max(s.approved_cents ?? 0, cents);
      s.counts = { ...(s.counts ?? {}), approved_by: approvedBy };
      steps.set(k, s);
    },
    updateCardPayload: async (card_id: string, payload: Record<string, unknown>) => { const c = cards.find((x) => x.card_id === card_id)!; c.payload = payload; },
    resolveCard: async (card_id: string, by: string, resolution: string) => { const c = cards.find((x) => x.card_id === card_id)!; c.status = "resolved"; (c as Record<string, unknown>).resolved_by = by; (c as Record<string, unknown>).resolution = resolution; return c; },
    loadsPaused: async () => opts.loadsPaused ?? false,
    cancelRunningSteps: async () => 0,
    withRun: async (_id: string, fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }> }) => Promise<unknown>) => fn({ query: async () => ({ rowCount: 3, rows: [] }) }),
    raw: () => ({
      query: async (sql: string) => {
        if (sql.includes("list_build_records")) return { rows: [{ n: opts.recorded === false ? "0" : "1" }] };
        if (sql.includes("information_schema.columns")) return { rows: [{ column_name: "email" }, { column_name: "company_domain" }] };
        if (sql.includes("needs_verify")) return { rows: [{ n: String(opts.needsVerify ?? 1200), with_email: String(opts.needsVerify ?? 1200), domains: "300" }] };
        return { rows: [] };
      },
    }),
    failStep: async (id: string, step: string, error: string) => { const k = `${id}/${step}`; const s = steps.get(k) ?? { status: "pending", attempts: 1, approved_cents: 0 }; s.status = "failed"; steps.set(k, s); const r = runs.get(id); if (r) r.last_error = error; },
    setRunStatus: async (id: string, status: string, _step?: string, lastError?: string) => {
      const r = runs.get(id);
      if (!r) return;
      if (["done", "failed", "aborted", "declined"].includes(r.status)) return;
      r.status = status as RunRow["status"];
      if (lastError) r.last_error = lastError;
    },
  };
  return repo;
}

function paidStage(repo: ReturnType<typeof fakeRepo>, step: string, cents: number, counts: Record<string, number>) {
  return {
    run: async (run: RunRow) => {
      const s = repo.steps.get(`${run.run_id}/${step}`);
      if ((s?.approved_cents ?? 0) < cents) {
        if (!repo.cards.some((c) => c.run_id === run.run_id && c.status === "open" && c.payload.step === step)) repo.cards.push({ card_id: `card-${step}`, run_id: run.run_id, kind: "spend_approval", payload: { step, worst_case_cents: cents }, status: "open", audience: "owner" });
        return { kind: "waiting", on: "owner", why: `worst case $${(cents / 100).toFixed(2)} needs a name`, worstCaseCents: cents };
      }
      await repo.finishStep(run.run_id, step);
      return { kind: "done", counts };
    },
  };
}
function freeStage(repo: ReturnType<typeof fakeRepo>, step: string, counts: Record<string, number>) {
  return { run: async (run: RunRow) => { await repo.finishStep(run.run_id, step); return { kind: "done", counts }; } };
}

function runner(repo: ReturnType<typeof fakeRepo>, paid: { icp: number; verify: number } = { icp: 50, verify: 900 }) {
  const stages = {
    ingest: freeStage(repo, "ingest", { rows_claimed: 1500 }),
    dedupe: freeStage(repo, "dedupe", { held: 200 }),
    suppress: freeStage(repo, "suppress", { net_new: 1200 }),
    icp: paidStage(repo, "icp", paid.icp, { passed: 1100 }),
    verify: paidStage(repo, "verify", paid.verify, { verified: 1000 }),
    normalize: freeStage(repo, "normalize", { normalized: 1000 }),
    qa: freeStage(repo, "qa", { qa_passed: 1000 }),
    route: freeStage(repo, "route", { routed: 1000 }),
    stage: freeStage(repo, "stage", { staged: 1000 }),
    import: freeStage(repo, "import", { imported: 1000 }),
    postImport: freeStage(repo, "post_import", { campaigns_checked: 1 }),
  };
  const ledger = { event: async (e: { line: string }) => { repo.events.push(e.line); } };
  const console_ = {
    resolveAs: async (actor: string, _role: string | null, cardId: string, choice: string) => {
      const c = repo.cards.find((x) => x.card_id === cardId && x.status === "open");
      if (!c) return { ok: false, reason: "not_open" };
      c.status = "resolved";
      (c as Record<string, unknown>).resolved_by = actor;
      (c as Record<string, unknown>).resolution = choice;
      return { ok: true };
    },
    ask: async (input: { run: RunRow | null; kind: string; audience: string; payload: Record<string, unknown> }) => {
      const card = { card_id: `card-${input.kind}-${repo.cards.length + 1}`, run_id: input.run!.run_id, kind: input.kind, payload: input.payload, status: "open", audience: input.audience };
      repo.cards.push(card);
      return card;
    },
  };
  return new TopupRunner({ repo: repo as never, stages: stages as never, console: console_ as never, ledger: ledger as never, now: () => 1700000000000 });
}

const spec = { client_tag: "bcp", smartlead_client_id: 542838, campaign_id: 3921850, source: { kind: "file_url" as const, urls: ["https://example.invalid/pool.csv"] } };

describe("D99 — the top-up", () => {
  it("refuses a campaign with no recorded build, a cold-call campaign, and a second job on the campaign", async () => {
    const none = runner(fakeRepo({ recorded: false }));
    const r1 = await none.open(spec, "mcp:operator", "Healthcare IT");
    assert.ok(!r1.ok && /no recorded build/.test(r1.message));
    const repo = fakeRepo();
    const j = runner(repo);
    const cold = await j.open(spec, "mcp:operator", "SG Cayden Calls");
    assert.ok(!cold.ok && /cold call/.test(cold.message));
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    assert.ok(opened.ok);
    const again = await j.open(spec, "mcp:operator", "Healthcare IT");
    assert.ok(!again.ok && /already open/.test(again.message));
    assert.equal(repo.runs.get((opened as { job_id: string }).job_id)!.counts_by_status.grok_job, 1);
  });

  it("quote runs the free steps and posts one card with the count and the worst case; nothing paid runs", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    const q = await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    assert.equal(q.status, "quoted");
    assert.equal(q.counts.net_new, 1200);
    assert.ok(q.worst_case_cents! > 0);
    const card = repo.cards.find((c) => c.kind === QUOTE_CARD);
    assert.ok(card && card.status === "open" && card.audience === "owner");
    assert.equal(card.payload.net_new, 1200);
    assert.equal(repo.steps.get(`${opened.job_id}/icp`), undefined, "nothing paid ran");
    assert.equal(repo.runs.get(opened.job_id)!.status, "awaiting_owner");
    assert.match(q.next, /Josh or Cayden/);
  });

  it("only Josh or Cayden approves; the approved tail runs icp, verify, normalize, qa, route, stage, import, post_import and closes the job", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    const nobody = await j.begin(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Grokbot" });
    assert.equal(nobody.status, "refused");
    assert.match(nobody.why!, /not an approver/);
    const done = await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Cayden" });
    assert.equal(done.status, "done");
    assert.equal(done.approved_by, "Cayden");
    for (const step of PHASE_STEPS.approve) assert.equal(repo.steps.get(`${opened.job_id}/${step}`)?.status, "done", step);
    assert.equal(repo.cards.find((c) => c.kind === QUOTE_CARD)!.status, "resolved");
    assert.equal(repo.steps.get(`${opened.job_id}/icp`)!.counts!.approved_by, "Cayden");
    assert.equal(repo.runs.get(opened.job_id)!.status, "done");
    assert.ok(repo.events.some((l) => /Josh flips ACTIVE/.test(l)));
  });

  it("a step priced above the quote is approved by the same name once, so the pool moving under the quote does not stall the job", async () => {
    const repo = fakeRepo();
    // The quote prices icp from the fake counts; the stage asks for more than that.
    const j = runner(repo, { icp: 50_000, verify: 10 });
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    const done = await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(done.status, "done");
    assert.ok(repo.events.some((l) => /above the quote/.test(l)));
  });

  it("loads paused: the approved job stops at staged and load refuses; load runs once loads resume", async () => {
    const paused = fakeRepo({ loadsPaused: true });
    const j = runner(paused);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    const staged = await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(staged.status, "staged");
    assert.equal(paused.steps.get(`${opened.job_id}/import`), undefined);
    const refused = await j.begin(opened.job_id, "load", { by: "mcp:operator" });
    assert.equal(refused.status, "refused");
    assert.match(refused.why!, /loads are paused/);
    const resumed = fakeRepo({ loadsPaused: false });
    resumed.runs.set("run-x", paused.runs.get(opened.job_id)!);
    resumed.recipes.set(paused.runs.get(opened.job_id)!.recipe_id, paused.recipes.get(paused.runs.get(opened.job_id)!.recipe_id));
    for (const [k, v] of paused.steps) resumed.steps.set(k.replace(opened.job_id, "run-x"), v);
    paused.runs.get(opened.job_id)!.run_id = "run-x";
    const loaded = await runner(resumed).run("run-x", "load", { by: "mcp:operator" });
    assert.equal(loaded.status, "done");
    assert.equal(resumed.steps.get("run-x/import")?.status, "done");
  });

  it("abort closes the job and its cards; nothing is loaded", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    const a = await j.abort(opened.job_id, "mcp:operator");
    assert.ok(a.ok);
    assert.equal(repo.runs.get(opened.job_id)!.status, "aborted");
    assert.equal(repo.cards.find((c) => c.kind === QUOTE_CARD)!.status, "resolved");
    const after = await j.begin(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(after.status, "refused");
  });
});
