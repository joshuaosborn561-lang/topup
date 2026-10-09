import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunRow } from "../domain/runs.js";
import { JobRunner, VERB_STEPS } from "./runner.js";

/** D52 — a job runs one verb at a time; money waits for a name; import waits for the switch. Ask Josh. */

function fakeRepo(opts: { loadsPaused?: boolean } = {}) {
  const runs = new Map<string, RunRow>();
  const steps = new Map<string, { status: string; attempts: number; approved_cents: number }>();
  const cards: Array<{ card_id: string; run_id: string; kind: string; payload: Record<string, unknown>; status: string; audience: string }> = [];
  const recipes = new Map<string, unknown>();
  const events: string[] = [];
  let n = 0;
  const repo = {
    runs, steps, cards, recipes, events,
    upsertRecipe: async (r: { recipe_id: string; body: unknown }) => { recipes.set(r.recipe_id, r.body); },
    getRecipe: async (id: string) => (recipes.has(id) ? { recipe_id: id, body: recipes.get(id), owner_approved_at: null } : null),
    openRun: async (input: { recipe_id: string; client_tag: string; lane: string; campaign_id: number | null; trigger: string; opened_by: string | null }) => {
      if ([...runs.values()].some((r) => r.client_tag === input.client_tag && r.lane === input.lane && r.status !== "done" && r.status !== "aborted")) return { ok: false as const, reason: "already_open" as const };
      const run = { run_id: `run-${++n}`, status: "open", current_step: null, counts_by_status: {}, spend_cents_by_vendor: {}, opened_at: "2026-10-09", closed_at: null, last_error: null, slack_channel: null, slack_thread_ts: null, ...input } as unknown as RunRow;
      runs.set(run.run_id, run);
      return { ok: true as const, run };
    },
    openRunFor: async (client_tag: string, lane: string) => [...runs.values()].find((r) => r.client_tag === client_tag && r.lane === lane) ?? null,
    getRun: async (id: string) => runs.get(id) ?? null,
    mergeRunCounts: async (id: string, counts: Record<string, number>) => { const r = runs.get(id)!; r.counts_by_status = { ...r.counts_by_status, ...counts }; },
    beginStep: async (id: string, step: string) => { const k = `${id}/${step}`; const s = steps.get(k) ?? { status: "pending", attempts: 0, approved_cents: 0 }; s.attempts += 1; s.status = "running"; steps.set(k, s); return { ok: true, attempts: s.attempts }; },
    finishStep: async (id: string, step: string) => { const k = `${id}/${step}`; const s = steps.get(k) ?? { status: "pending", attempts: 1, approved_cents: 0 }; s.status = "done"; steps.set(k, s); },
    getStep: async (id: string, step: string) => { const s = steps.get(`${id}/${step}`); return s ? { step, ...s } : null; },
    openCardsForRun: async (id: string) => cards.filter((c) => c.run_id === id && c.status === "open"),
    approveStep: async (id: string, step: string, cents: number) => { const k = `${id}/${step}`; const s = steps.get(k) ?? { status: "pending", attempts: 0, approved_cents: 0 }; s.approved_cents += cents; steps.set(k, s); },
    resolveCard: async (card_id: string, by: string, resolution: string) => { const c = cards.find((x) => x.card_id === card_id)!; c.status = "resolved"; (c as Record<string, unknown>).resolved_by = by; (c as Record<string, unknown>).resolution = resolution; return c; },
    loadsPaused: async () => opts.loadsPaused ?? true,
  };
  return repo;
}

/** A stage that asks for money until its step is approved, then finishes with counts. */
function paidStage(repo: ReturnType<typeof fakeRepo>, step: string, cents: number, counts: Record<string, number>) {
  return {
    run: async (run: RunRow) => {
      const s = repo.steps.get(`${run.run_id}/${step}`);
      if ((s?.approved_cents ?? 0) < cents) {
        if (!repo.cards.some((c) => c.run_id === run.run_id && c.status === "open" && c.payload.step === step)) repo.cards.push({ card_id: `card-${step}`, run_id: run.run_id, kind: "spend_approval", payload: { step, worst_case_cents: cents }, status: "open", audience: "owner" });
        return { kind: "waiting", on: "owner", why: `worst case $${(cents / 100).toFixed(2)} needs a tap`, worstCaseCents: cents };
      }
      await repo.finishStep(run.run_id, step);
      return { kind: "done", counts };
    },
  };
}
function freeStage(repo: ReturnType<typeof fakeRepo>, step: string, counts: Record<string, number>) {
  return { run: async (run: RunRow) => { await repo.finishStep(run.run_id, step); return { kind: "done", counts }; } };
}

function runner(repo: ReturnType<typeof fakeRepo>) {
  const stages = {
    pull: paidStage(repo, "pull", 180, { pulled: 1200 }),
    ingest: freeStage(repo, "ingest", { inserted: 1184, dupes: 16 }),
    suppress: freeStage(repo, "suppress", { raw: 1184, net_new: 900 }),
    puzzle: freeStage(repo, "puzzle", { domains_found: 0 }),
    findEmails: paidStage(repo, "find_emails", 300, { found: 200 }),
    verify: paidStage(repo, "verify", 250, { sendable: 850 }),
    normalize: freeStage(repo, "normalize", { normalized: 850 }),
    qa: freeStage(repo, "qa", { held: 12 }),
    route: freeStage(repo, "route", { routed: 838 }),
    stage: freeStage(repo, "stage", { staged: 838 }),
    import: freeStage(repo, "import", { imported: 838 }),
    postImport: freeStage(repo, "post_import", { matched: 838 }),
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
  };
  return new JobRunner({ repo: repo as never, stages: stages as never, console: console_ as never, ledger: ledger as never, now: () => 1700000000000 });
}

const spec = { client_tag: "bcp", smartlead_client_id: 542838, lane: "it_dm_airpods", campaign_id: 3921850, source: "getleads" as const, filters: { job_titles: ["CIO"], industries: ["Hospitals"] }, max_rows: 1200 };

describe("D52 — job runner", () => {
  it("opens a job as a run with its recipe and target, marks it a job, and refuses a second on the lane", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator");
    assert.ok(opened.ok);
    if (!opened.ok) return;
    const run = repo.runs.get(opened.job_id)!;
    assert.equal(run.counts_by_status.grok_job, 1);
    assert.equal(run.counts_by_status.target_3921850, 1);
    assert.equal(run.counts_by_status.requested_leads, 1200);
    assert.ok(repo.recipes.has(opened.recipe_id));
    assert.equal(repo.steps.get(`${opened.job_id}/trigger`)?.status, "done");
    const again = await j.open(spec, "mcp:operator");
    assert.ok(!again.ok && /already open/.test(again.message));
  });

  it("pull returns the estimate first, runs with approved_by, records who, and names the next verb; the orchestrator never chains it", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator");
    if (!opened.ok) assert.fail(opened.message);
    const first = await j.run(opened.job_id, "pull", { by: "mcp:operator" });
    assert.equal(first.status, "waiting_approval");
    assert.equal(first.worst_case_cents, 180);
    assert.equal(first.card_id, "card-pull");
    assert.match(first.next, /approved_by/);
    const second = await j.run(opened.job_id, "pull", { by: "mcp:operator", approved_by: "Cayden" });
    assert.equal(second.status, "done");
    assert.equal(second.step, "ingest");
    assert.deepEqual(second.counts, { inserted: 1184, dupes: 16 });
    assert.equal(second.approved_by, "Cayden");
    assert.equal(second.next, "suppress(job_id)");
    assert.equal(repo.steps.get(`${opened.job_id}/pull`)?.approved_cents, 180);
    assert.equal(repo.cards[0]?.status, "resolved");
    assert.equal((repo.cards[0] as Record<string, unknown>).resolved_by, "Cayden via mcp:operator");
    assert.ok(repo.events.some((l) => /approved by Cayden/.test(l)));
    const third = await j.run(opened.job_id, "pull", { by: "mcp:operator" });
    assert.equal(third.status, "done");
    assert.match(third.why ?? "", /already done/);
  });

  it("walks the verbs in order, pays only with a name, and import waits for the loads switch", async () => {
    const repo = fakeRepo({ loadsPaused: true });
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "pull", { by: "x", approved_by: "Cayden" });
    assert.equal((await j.run(opened.job_id, "suppress", { by: "x" })).status, "done");
    const enrich = await j.run(opened.job_id, "enrich", { by: "x" });
    assert.equal(enrich.status, "waiting_approval");
    assert.equal(enrich.step, "find_emails");
    assert.equal((await j.run(opened.job_id, "enrich", { by: "x", approved_by: "Josh" })).status, "done");
    assert.equal((await j.run(opened.job_id, "verify", { by: "x", approved_by: "Josh" })).status, "done");
    for (const v of ["normalize", "qa", "stage"] as const) assert.equal((await j.run(opened.job_id, v, { by: "x" })).status, "done", v);
    const imp = await j.run(opened.job_id, "import", { by: "x" });
    assert.equal(imp.status, "refused");
    assert.match(imp.why ?? "", /loads are paused/);
    assert.equal(VERB_STEPS.import.join(","), "import,post_import");
  });

  it("refuses a run the service opened and a job that does not exist", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    await repo.openRun({ recipe_id: "bcp.it_dm.v0", client_tag: "bcp", lane: "x", campaign_id: null, trigger: "runway", opened_by: "watch" });
    const r = await j.run("run-1", "suppress", { by: "x" });
    assert.equal(r.status, "refused");
    assert.match(r.why ?? "", /not a job/);
    assert.equal((await j.run("nope", "suppress", { by: "x" })).why, "no such job");
  });

  it("refuses to open a job as the watch (D61)", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const watch = await j.open(spec, "the watch");
    assert.ok(!watch.ok);
    if (watch.ok) return;
    assert.match(watch.message, /Nothing starts on its own/);
    const also = await j.open(spec, "watch");
    assert.ok(!also.ok);
  });

  it("begin returns started with the job id before the verb finishes (D61)", async () => {
    const repo = fakeRepo();
    let release!: (v: { kind: string; counts: Record<string, number> }) => void;
    const held = new Promise<{ kind: string; counts: Record<string, number> }>((r) => {
      release = r;
    });
    const stages = {
      pull: { run: async () => held },
      ingest: freeStage(repo, "ingest", { inserted: 1 }),
      suppress: freeStage(repo, "suppress", {}),
      puzzle: freeStage(repo, "puzzle", {}),
      findEmails: freeStage(repo, "find_emails", {}),
      verify: freeStage(repo, "verify", {}),
      normalize: freeStage(repo, "normalize", {}),
      qa: freeStage(repo, "qa", {}),
      route: freeStage(repo, "route", {}),
      stage: freeStage(repo, "stage", {}),
      import: freeStage(repo, "import", {}),
      postImport: freeStage(repo, "post_import", {}),
    };
    const j = new JobRunner({
      repo: repo as never,
      stages: stages as never,
      console: { resolveAs: async () => ({ ok: true }) } as never,
      ledger: { event: async () => undefined } as never,
      now: () => 1700000000000,
    });
    const opened = await j.open(spec, "mcp:operator");
    assert.ok(opened.ok);
    if (!opened.ok) return;
    const started = await j.begin(opened.job_id, "pull", { by: "mcp:operator" });
    assert.equal(started.status, "started");
    assert.equal(started.job_id, opened.job_id);
    assert.match(started.next, /job\(job_id\)/);
    assert.notEqual(repo.steps.get(`${opened.job_id}/pull`)?.status, "done");
    release({ kind: "done", counts: { pulled: 2 } });
    await held;
    await new Promise((r) => setTimeout(r, 10));
  });
});
