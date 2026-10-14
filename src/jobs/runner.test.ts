import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RunRow } from "../domain/runs.js";
import { parseApprovers, PHASE_STEPS, QUOTE_CARD, TopupRunner } from "./runner.js";
import { findWorstCaseCents } from "../stages/find_emails/index.js";

/**
 * D99 — a top-up is one job per campaign: free quote first, then the paid
 * tail only after Josh or Cayden says yes by name, then the load. Nothing
 * runs without a recorded build. Ask Josh or Cayden.
 */
function fakeRepo(opts: { loadsPaused?: boolean; recorded?: boolean; recordedError?: boolean; needsVerify?: number; toFind?: number; registry?: Record<string, unknown>[]; records?: Array<Record<string, unknown>>; statuses?: Array<{ id: number; status: string; name?: string }> } = {}) {
  const runs = new Map<string, RunRow>();
  const steps = new Map<string, { status: string; attempts: number; approved_cents: number; counts?: Record<string, unknown> }>();
  const cards: Array<{ card_id: string; run_id: string; kind: string; payload: Record<string, unknown>; status: string; audience: string }> = [];
  const settingsStore = new Map<string, unknown>();
  const events: string[] = [];
  const sql: string[] = [];
  let n = 0;
  const repo = {
    runs, steps, cards, settingsStore, events, sql,
    upsertJobSettings: async (r: { settings_id: string; body: unknown }) => { settingsStore.set(r.settings_id, r.body); },
    getJobSettings: async (id: string) => (settingsStore.has(id) ? { settings_id: id, body: settingsStore.get(id), owner_approved_at: null } : null),
    openRun: async (input: { settings_id: string; client_tag: string; lane: string; campaign_id: number | null; trigger: string; opened_by: string | null }) => {
      if ([...runs.values()].some((r) => !["done", "aborted", "failed"].includes(r.status) && (r.campaign_id === input.campaign_id || (input.lane && r.lane === input.lane && r.client_tag === input.client_tag)))) return { ok: false as const, reason: "already_open" as const };
      const run = { run_id: `run-${++n}`, status: "open", current_step: null, counts_by_status: {}, spend_cents_by_vendor: {}, opened_at: "2026-10-13", closed_at: null, last_error: null, slack_channel: null, slack_thread_ts: null, ...input } as unknown as RunRow;
      runs.set(run.run_id, run);
      return { ok: true as const, run };
    },
    getRun: async (id: string) => runs.get(id) ?? null,
    openRuns: async () => [...runs.values()].filter((r) => !["done", "aborted", "failed", "declined"].includes(r.status)),
    resetStep: async (id: string, step: string) => { const k = `${id}/${step}`; const s = steps.get(k); if (s) { s.status = "pending"; s.attempts = 0; } },
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
    campaignRegistry: async () => opts.registry ?? [],
    cancelRunningSteps: async () => 0,
    withRun: async (_id: string, fn: (tx: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }> }) => Promise<unknown>) =>
      fn({ query: async (q: string) => { sql.push(q); return { rowCount: 3, rows: [] }; } }),
    raw: () => ({
      query: async (sql: string) => {
        if (sql.includes("list_build_records")) {
          if (opts.recordedError) throw new Error("permission denied for table list_build_records");
          if (sql.includes("select campaign_ids, lanes")) return { rows: opts.records ?? [] };
          return { rows: [{ n: opts.recorded === false ? "0" : "1" }] };
        }
        if (sql.includes("from public.campaigns") && sql.includes("smartlead_campaign_id = any")) {
          return { rows: (opts.statuses ?? []).map((s) => ({ id: String(s.id), status: s.status, name: s.name ?? `c${s.id}` })) };
        }
        if (sql.includes("icp_variants")) return { rows: [{ n: "1" }] };
        if (sql.includes("information_schema.columns")) return { rows: ["email", "company_domain", "first_name", "last_name", "company_name"].map((column_name) => ({ column_name })) };
        if (sql.includes("as to_find")) return { rows: [{ to_find: String(opts.toFind ?? 0), domains: "300" }] };
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
  return { run: async (run: RunRow) => { await repo.finishStep(run.run_id, step); await repo.mergeRunCounts(run.run_id, counts); return { kind: "done", counts }; } };
}

// The fake paid stages price themselves under what the quote approves (icp from 300 domains, verify from the fake row count).
function runner(repo: ReturnType<typeof fakeRepo>, paid: { icp: number; verify: number; find?: number; finder?: boolean } = { icp: 1, verify: 1 }, approvers?: string[]) {
  const stages = {
    ingest: freeStage(repo, "ingest", { rows_claimed: 1500 }),
    dedupe: freeStage(repo, "dedupe", { held: 200 }),
    suppress: freeStage(repo, "suppress", { net_new: 1200 }),
    icp: paidStage(repo, "icp", paid.icp, { passed: 1100 }),
    findEmails: { ...paidStage(repo, "find_emails", paid.find ?? 0, { emails_found: 0 }), ready: () => paid.finder ?? false },
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
  return new TopupRunner({ repo: repo as never, stages: stages as never, console: console_ as never, ledger: ledger as never, now: () => 1700000000000, ...(approvers ? { approvers } : {}) });
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

  it("a step priced well above the quote waits for a fresh yes to the new number; a second named call then runs it", async () => {
    const repo = fakeRepo();
    // The quote prices icp from the fake counts; the stage asks for far more.
    const j = runner(repo, { icp: 50_000, verify: 10 });
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    const held = await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(held.status, "waiting_approval");
    assert.equal(held.worst_case_cents, 50_000);
    assert.ok(repo.events.some((l) => /above the .* said yes to/.test(l)));
    // Josh sees $500 and says yes again: the open spend card lets the named call through.
    const again = await j.begin(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(again.status, "started");
    await new Promise((res) => setTimeout(res, 30));
    const done = await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(done.status, "done", JSON.stringify({ why: done.why, step: done.step, cards: repo.cards.map((c) => [c.kind, c.status, c.payload.step]), icp: repo.steps.get(`${opened.job_id}/icp`) }));
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
    resumed.settingsStore.set(paused.runs.get(opened.job_id)!.settings_id, paused.settingsStore.get(paused.runs.get(opened.job_id)!.settings_id));
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
    assert.equal(a.ok && a.removed, 3, "a file pool's unloaded rows leave the lane table on abort");
    assert.equal(repo.runs.get(opened.job_id)!.status, "aborted");
    assert.equal(repo.cards.find((c) => c.kind === QUOTE_CARD)!.status, "resolved");
    const after = await j.begin(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(after.status, "refused");
  });

  it("the approver list comes from Railway: with TOPUP_APPROVERS=Josh, Cayden's yes is refused for now", async () => {
    assert.deepEqual(parseApprovers(""), ["josh", "cayden"]);
    assert.deepEqual(parseApprovers(" Josh "), ["josh"]);
    const repo = fakeRepo();
    const j = runner(repo, undefined, ["josh"]);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    const cayden = await j.begin(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Cayden" });
    assert.equal(cayden.status, "refused");
    assert.match(cayden.why!, /Only Josh approves/);
    const josh = await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "josh" });
    assert.equal(josh.status, "done");
  });

  it("a restart mid-quote is picked up on boot: the cut-off step is reset and the quote finishes", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    // The deploy killed the process while ingest was running.
    repo.steps.set(`${opened.job_id}/ingest`, { status: "running", attempts: 1, approved_cents: 0 });
    repo.runs.get(opened.job_id)!.status = "ingesting";
    const r = await j.resumable(opened.job_id);
    assert.deepEqual(r, { phase: "quote", approved_by: null, interrupted: "ingest", parked: null });
    const resumed = await j.resumeInterrupted("boot");
    assert.deepEqual(resumed, [opened.job_id]);
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(repo.steps.get(`${opened.job_id}/suppress`)?.status, "done");
    assert.ok(repo.cards.some((c) => c.kind === QUOTE_CARD && c.status === "open"));
    assert.ok(repo.events.some((l) => /resumed by boot at ingest/.test(l)));
    const standing = await j.standing(opened.job_id, "mcp:operator");
    assert.equal((standing as { status: string }).status, "quoted");
  });

  it("a restart after the yes resumes the approved tail under the recorded name, with no card needed", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    // Approve, but pretend the process died while verify was running.
    const approving = j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Cayden" });
    await approving;
    for (const st of ["verify", "normalize", "qa", "route", "stage", "import", "post_import"]) repo.steps.delete(`${opened.job_id}/${st}`);
    repo.steps.set(`${opened.job_id}/verify`, { status: "running", attempts: 1, approved_cents: 900, counts: { approved_by: "Cayden" } });
    repo.runs.get(opened.job_id)!.status = "verifying";
    const r = await j.resumable(opened.job_id);
    assert.equal(r?.phase, "approve");
    assert.equal(r?.approved_by, "Cayden");
    const out = await j.run(opened.job_id, "approve", { by: "boot", approved_by: r!.approved_by, resume: true });
    assert.equal(out.status, "done");
    assert.equal(out.approved_by, "Cayden");
  });

  it("a database error while reading the build record is reported as one, never as 'no recorded build' (D102)", async () => {
    const r = await runner(fakeRepo({ recordedError: true })).open(spec, "mcp:operator", "Healthcare IT");
    assert.ok(!r.ok);
    assert.match(r.message, /database error, not a missing build/);
    assert.doesNotMatch(r.message, /no recorded build/);
  });

  it("abort gives a table pool its label back so the same table and where find the rows again (D102)", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const tableSpec = { ...spec, source: { kind: "table" as const, table: "lp.bcp_ingested_leads", where: "source_label = 'grok_pool'" } };
    const opened = await j.open(tableSpec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    repo.sql.length = 0;
    const a = await j.abort(opened.job_id, "mcp:operator");
    assert.ok(a.ok);
    assert.equal(a.ok && a.released, 3, "a table pool's rows are released, not deleted");
    const release = repo.sql.find((q) => /run_id = null/.test(q));
    assert.ok(release, "abort releases the rows");
    assert.match(release!, /source_label = coalesce\(qa_flags->>'pool_label', source_label\)/, "D102: the bot's label comes back");
    assert.match(release!, /- 'pool_label'/);
  });

  it("a restart between the last free step and the quote card is picked up on boot: the card gets posted (D102)", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    for (const step of ["ingest", "dedupe", "suppress"]) repo.steps.set(`${opened.job_id}/${step}`, { status: "done", attempts: 1, approved_cents: 0 });
    repo.runs.get(opened.job_id)!.status = "suppressing";
    assert.deepEqual(await j.resumable(opened.job_id), { phase: "quote", approved_by: null, interrupted: null, parked: null });
    const resumed = await j.resumeInterrupted("boot");
    assert.deepEqual(resumed, [opened.job_id]);
    await new Promise((res) => setTimeout(res, 20));
    assert.ok(repo.cards.some((c) => c.kind === QUOTE_CARD && c.status === "open"), "the quote card is up");
    assert.equal(await j.resumable(opened.job_id), null, "with the card up the job is standing, not interrupted");
    assert.deepEqual(await j.resumeInterrupted("boot"), [], "a second boot leaves it alone");
  });

  it("the quote answer says loads are paused so the yes and the unpause are asked for together (D102)", async () => {
    const repo = fakeRepo({ loadsPaused: true });
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    const quoted = await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    assert.equal(quoted.status, "quoted");
    assert.match(quoted.next, /Loads are paused/);
    const standing = await j.standing(opened.job_id, "mcp:operator");
    assert.match((standing as { next: string }).next, /Loads are paused/);
  });

  it("people with no email are quoted separately and the look-up is priced and approved with the same yes (D103)", async () => {
    const repo = fakeRepo({ toFind: 500 });
    const j = runner(repo, { icp: 1, verify: 1, find: 1, finder: true });
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    const q = await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    assert.equal(q.status, "quoted");
    assert.equal(q.counts.to_find, 500);
    assert.equal(q.counts.find_cents, findWorstCaseCents(500));
    assert.match(q.next, /500 more new people with no email/);
    assert.doesNotMatch(q.next, /daily vendor cap/, "D104: there is no daily cap");
    const card = repo.cards.find((c) => c.kind === QUOTE_CARD)!;
    assert.equal(card.payload.find_cents, findWorstCaseCents(500));
    assert.equal(card.payload.worst_case_cents, Number(card.payload.icp_cents) + Number(card.payload.find_cents) + Number(card.payload.verify_cents));
    const done = await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(done.status, "done");
    assert.equal(repo.steps.get(`${opened.job_id}/find_emails`)?.approved_cents, findWorstCaseCents(500));
    assert.equal(repo.steps.get(`${opened.job_id}/find_emails`)?.status, "done");
  });

  it("without the email finder connected the people with no email are named as left out, not priced (D103)", async () => {
    const repo = fakeRepo({ toFind: 500 });
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    const q = await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    assert.equal(q.counts.find_cents, 0);
    assert.match(q.next, /email finder is not connected/);
  });

  it("a parked step waits for a person by name: a status check and a restart leave it alone; a named call tries it once more", async () => {
    const repo = fakeRepo();
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    await j.run(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    // icp failed three times and parked.
    repo.steps.set(`${opened.job_id}/icp`, { status: "parked", attempts: 3, approved_cents: 1, counts: { approved_by: "Josh" } });
    for (const s of ["find_emails", "verify", "normalize", "qa", "route", "stage", "import", "post_import"]) repo.steps.delete(`${opened.job_id}/${s}`);
    repo.runs.get(opened.job_id)!.status = "awaiting_operator";
    const standing = await j.standing(opened.job_id, "mcp:operator");
    assert.equal((standing as { status: string }).status, "parked");
    assert.equal(repo.steps.get(`${opened.job_id}/icp`)!.status, "parked", "a status check does not re-run it");
    assert.deepEqual(await j.resumeInterrupted("boot"), [], "a restart does not re-run it");
    const again = await j.begin(opened.job_id, "approve", { by: "mcp:operator", approved_by: "Josh" });
    assert.equal(again.status, "started");
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(repo.steps.get(`${opened.job_id}/icp`)!.status, "done", "the named call tried it once more");
    assert.ok(repo.events.some((l) => /icp was parked; Josh asked for one more try/.test(l)));
  });

  it("a pool with nothing new closes the job instead of quoting zero", async () => {
    const repo = fakeRepo({ needsVerify: 0 });
    const j = runner(repo);
    const opened = await j.open(spec, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    const q = await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    assert.equal(q.status, "nothing");
    assert.match(q.why!, /0 new leads/);
    assert.equal(repo.runs.get(opened.job_id)!.status, "done");
    assert.ok(!repo.cards.some((c) => c.kind === QUOTE_CARD));
  });

  it("a campaign_id top-up points at its lane and quotes the whole lane (D105)", async () => {
    const repo = fakeRepo({
      registry: [
        { campaign_id: "3921850", client_tag: "bcp", lane: "it_dm", band: "11_50" },
        { campaign_id: "3921851", client_tag: "bcp", lane: "it_dm", band: "51_200" },
      ],
      records: [{ campaign_ids: [3921850, 3921851], lanes: ["it_dm"] }],
      statuses: [
        { id: 3921850, status: "ACTIVE" },
        { id: 3921851, status: "PAUSED" },
      ],
    });
    const j = runner(repo);
    const split = { rule: "11 to 50 to the small campaign, 51 to 200 to the mid one.", routing: [{ when: { band: "11_50" }, campaign_id: 3921850 }, { when: { band: "51_200" }, campaign_id: 3921851 }], from: ["build step 12"] };
    const opened = await j.open({ ...spec, split }, "mcp:operator", "Healthcare IT");
    if (!opened.ok) assert.fail(opened.message);
    assert.equal(opened.scope, "lane");
    assert.equal(opened.lane, "it_dm");
    assert.deepEqual(opened.campaign_ids, [3921850, 3921851]);
    assert.equal(opened.pointed_from_campaign_id, 3921850);
    const q = await j.run(opened.job_id, "quote", { by: "mcp:operator" });
    assert.equal(q.status, "quoted");
    assert.match(q.next, /lane it_dm/);
    assert.match(q.next, /#3921850/);
    assert.match(q.next, /as Grokbot read them \(from build step 12\)/);
    const body = repo.settingsStore.get(repo.runs.get(opened.job_id)!.settings_id) as { routing: Array<{ campaign_id: number }>; scope: string; split_rule: string; split_from: string[] };
    assert.equal(body.scope, "lane");
    assert.deepEqual(body.routing.map((r) => r.campaign_id).sort(), [3921850, 3921851]);
    assert.match(body.split_rule, /small campaign/);
    assert.deepEqual(body.split_from, ["build step 12"]);
  });

  it("refuses a lane with more than one refillable campaign and no split passed instead of guessing (D105, D108)", async () => {
    const repo = fakeRepo({
      registry: [
        { campaign_id: "3921850", client_tag: "bcp", lane: "it_dm" },
        { campaign_id: "3921851", client_tag: "bcp", lane: "it_dm" },
      ],
      records: [{ campaign_ids: [3921850, 3921851], lanes: ["it_dm"] }],
      statuses: [
        { id: 3921850, status: "ACTIVE" },
        { id: 3921851, status: "ACTIVE" },
      ],
    });
    const r = await runner(repo).open({ ...spec, lane: "it_dm" }, "mcp:operator", "Healthcare IT");
    assert.ok(!r.ok);
    assert.match(r.message, /no split was passed/);
  });

  it("never opens a STOPPED campaign as a lane target; PAUSED stays (D105)", async () => {
    const repo = fakeRepo({
      registry: [
        { campaign_id: "3921850", client_tag: "bcp", lane: "it_dm" },
        { campaign_id: "3921851", client_tag: "bcp", lane: "it_dm" },
        { campaign_id: "3921852", client_tag: "bcp", lane: "it_dm" },
      ],
      records: [{ campaign_ids: [3921850, 3921851, 3921852], lanes: ["it_dm"] }],
      statuses: [
        { id: 3921850, status: "ACTIVE" },
        { id: 3921851, status: "PAUSED" },
        { id: 3921852, status: "STOPPED" },
      ],
    });
    const split = {
      rule: "SEG to the SEG twin, the rest to the main campaign, the no-team rows to the third.",
      routing: [
        { when: { mail_class: "SEG" }, campaign_id: 3921850 },
        { when: { mail_class: "OTHER" }, campaign_id: 3921851 },
        { when: { team_source: "none" }, campaign_id: 3921852 },
      ],
    };
    const opened = await runner(repo).open({ ...spec, lane: "it_dm", campaign_id: undefined, split }, "mcp:operator", null);
    if (!opened.ok) assert.fail(opened.message);
    assert.deepEqual(opened.campaign_ids, [3921850, 3921851]);
    assert.ok(!opened.campaign_ids.includes(3921852));
  });
});
