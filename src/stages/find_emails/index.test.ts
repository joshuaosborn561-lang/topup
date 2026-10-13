import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { EmailFinder, FinderSource } from "../../clients/emailFinder.js";
import type { RunRow } from "../../domain/runs.js";
import { SpendRails } from "../../spend/rails.js";
import { FindEmailsStage, findWorstCaseCents } from "./index.js";

/**
 * D103 — find emails after the yes, against a real Postgres with the lane
 * lock from migration 0029. No vendor is called: the finder is a fake that
 * writes its result columns the way the real one does (outside the run).
 * Ask Josh.
 */
const RUN = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

async function lane(): Promise<PGlite> {
  const pg = new PGlite();
  await pg.exec(`
    create schema topup;
    create schema lp;
    create table topup.runs (run_id uuid primary key, client_tag text not null, campaign_id bigint, status text not null);
    create function topup.run_is_open(s text) returns boolean language sql immutable as $$ select s not in ('done', 'failed', 'aborted', 'declined') $$;
    create table lp.acme_ingested_leads (
      id uuid primary key default gen_random_uuid(),
      first_name text, last_name text, email text, title text, company_name text, company_domain text, city text, state text,
      source_label text not null default 'pool', lead_status text not null default 'ingested', run_id uuid, qa_flags jsonb,
      status_changed_at timestamptz
    );
    create unique index acme_email_uidx on lp.acme_ingested_leads (email);
  `);
  await pg.exec(await readFile(new URL("../../../supabase/migrations/0029_finder_writeback.sql", import.meta.url), "utf8"));
  await pg.exec(`create trigger topup_write_lock before update or delete on lp.acme_ingested_leads for each row execute function topup.lead_write_lock();`);
  await pg.query(`insert into topup.runs values ($1, 'acme', 42, 'open')`, [RUN]);
  return pg;
}

function fakeRepo(pg: PGlite, approvedCents: number) {
  const steps = new Map<string, { status: string; attempts: number; approved_cents: number; counts: Record<string, unknown>; vendor_job_id: string | null }>();
  steps.set("find_emails", { status: "pending", attempts: 0, approved_cents: approvedCents, counts: { approved_by: "Josh" }, vendor_job_id: null });
  const cards: Array<{ card_id: string; kind: string; payload: Record<string, unknown>; status: string }> = [];
  const booked: Array<Record<string, unknown>> = [];
  const wrap = (q: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }) => ({
    query: async (sql: string, params?: unknown[]) => {
      const r = await q.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  const repo = {
    steps, cards, booked,
    raw: () => wrap(pg),
    withRun: async <T>(runId: string, fn: (tx: unknown) => Promise<T>) =>
      pg.transaction(async (tx) => {
        await tx.query(`select set_config('app.run_id', $1, true)`, [runId]);
        return fn(wrap(tx));
      }),
    getRun: async () => ({ run_id: RUN, status: "open" }),
    beginStep: async (_r: string, step: string) => { const s = steps.get(step)!; s.attempts += 1; s.status = "running"; return { ok: true, attempts: s.attempts }; },
    setRunStatus: async () => undefined,
    getStep: async (_r: string, step: string) => { const s = steps.get(step); return s ? { step, ...s } : null; },
    finishStep: async (_r: string, step: string, o: { counts: Record<string, unknown> }) => { const s = steps.get(step)!; s.status = "done"; s.counts = { ...s.counts, ...o.counts }; },
    failStep: async (_r: string, step: string) => { steps.get(step)!.status = "failed"; },
    setStepWaiting: async (_r: string, step: string) => { steps.get(step)!.status = "waiting_approval"; },
    setStepVendorJob: async (_r: string, step: string, id: string | null) => { steps.get(step)!.vendor_job_id = id; },
    cancelRunningSteps: async () => 0,
    mergeRunCounts: async () => undefined,
    openCardsForRun: async () => cards.filter((c) => c.status === "open"),
    updateCardPayload: async () => undefined,
    setCardBlocks: async () => undefined,
    spentTodayCents: async () => 0,
    ledger: async (row: Record<string, unknown>) => { booked.push(row); },
  };
  return repo;
}

/** Writes wf_email onto the job's rows the way ew_patch_source does: plain UPDATE of its own columns, no app.run_id. */
function fakeFinder(pg: PGlite, found: Record<string, string>): EmailFinder & { started: number } {
  const f = {
    started: 0,
    configured: () => true,
    estimate: async () => ({ rows: 0, estimated_cost_usd: 0, refused: false }),
    start: async (_tag: string, src: FinderSource) => {
      f.started += 1;
      assert.match(src.where, /lead_status = 'needs_email'/);
      for (const [first, email] of Object.entries(found)) {
        await pg.query(`update lp.acme_ingested_leads set wf_status = 'found', wf_email = $2, wf_vendor = 'getleads', wf_updated_at = now() where run_id = $1 and first_name = $3`, [RUN, email, first]);
      }
      return { job_id: "ew-1" };
    },
    check: async () => ({ status: "done" as const, outcome: "completed", spend_usd: 0.37, emails_found: Object.keys(found).length, error: null }),
  };
  return f;
}

function stage(repo: ReturnType<typeof fakeRepo>, finder: EmailFinder, calls: string[]) {
  const console_ = { postInThread: async () => undefined, ask: async (i: { kind: string; payload: Record<string, unknown> }) => { const c = { card_id: `c${repo.cards.length + 1}`, kind: i.kind, payload: i.payload, status: "open" }; repo.cards.push(c); return c; } };
  const rails = new SpendRails(repo as never, { autoCapCents: 0, dailyCapCents: 100_000, driftTolerance: 0.1 });
  return new FindEmailsStage({
    repo: repo as never,
    console: console_ as never,
    rails,
    finder,
    dedupe: { holdByStatus: async (_r: unknown, _s: unknown, status: string) => { calls.push(`hold:${status}`); return { raw: 0, held: 0, held_by_email: 0, held_by_person: 0, held_set_emails: 0, held_set_people: 0 }; } } as never,
    suppress: { removeFound: async (_r: unknown, _s: unknown, status: string) => { calls.push(`suppress:${status}`); return {}; } } as never,
    cfg: { pollMs: 1, deadMs: 60_000 },
    clock: { now: () => 0, sleep: async () => undefined },
  });
}

const run = { run_id: RUN, client_tag: "acme", lane: "l", campaign_id: 42 } as unknown as RunRow;
const settings = {} as never;

async function seed(pg: PGlite): Promise<void> {
  await pg.query(`insert into lp.acme_ingested_leads (first_name, last_name, email, company_domain, lead_status, run_id) values ('Al', 'A', 'a@x.com', 'x.com', 'needs_verify', $1)`, [RUN]);
  await pg.query(`insert into lp.acme_ingested_leads (first_name, last_name, email, company_domain, lead_status, run_id) values ('Zed', 'Z', 'z@x.com', 'x.com', 'imported', $1)`, [OTHER]);
  for (const [first, last, domain, company] of [
    ["Bo", "B", "b.com", null],
    ["Cy", "C", "c.com", null],
    ["Di", "D", "d.com", null],
    ["Ed", null, "e.com", null],
    ["Fa", "F", null, "Foo Co"],
    ["Gi", "G", "g.com", null],
  ] as const) {
    await pg.query(`insert into lp.acme_ingested_leads (first_name, last_name, company_domain, company_name, lead_status, run_id) values ($1, $2, $3, $4, 'needs_email', $5)`, [first, last, domain, company, RUN]);
  }
}

async function statusOf(pg: PGlite, first: string): Promise<{ lead_status: string; email: string | null }> {
  const r = await pg.query<{ lead_status: string; email: string | null }>(`select lead_status, email from lp.acme_ingested_leads where first_name = $1`, [first]);
  return r.rows[0]!;
}

describe("D103 — find emails", () => {
  it("the lane lock lets the finder's own columns through without the run, and nothing else", async () => {
    const pg = await lane();
    await seed(pg);
    await pg.query(`update lp.acme_ingested_leads set wf_email = 'x@y.com', wf_status = 'found' where first_name = 'Bo'`);
    await assert.rejects(pg.query(`update lp.acme_ingested_leads set lead_status = 'needs_verify' where first_name = 'Bo'`), /topup write lock/);
    await assert.rejects(pg.query(`update lp.acme_ingested_leads set email = 'x@y.com', wf_email = 'x@y.com' where first_name = 'Bo'`), /topup write lock/);
  });

  it("found addresses go to verification after the held and unsubscribe checks; one already in the lane is held; a shared one is kept once; the rest stay as not found", async () => {
    const pg = await lane();
    await seed(pg);
    const repo = fakeRepo(pg, findWorstCaseCents(10));
    const calls: string[] = [];
    const finder = fakeFinder(pg, { Bo: "B@b.com", Cy: " Z@x.com", Fa: "f@foo.co", Gi: "f@foo.co" });
    const out = await stage(repo, finder, calls).run(run, settings);
    assert.equal(out.kind, "done");
    const c = (out as { counts: Record<string, number> }).counts;
    assert.equal(finder.started, 1);
    assert.equal(c.looked_up, 5, "Ed has no last name");
    assert.equal(c.unfindable, 1);
    assert.deepEqual(await statusOf(pg, "Bo"), { lead_status: "needs_verify", email: "b@b.com" });
    assert.equal((await statusOf(pg, "Cy")).lead_status, "held", "z@x.com is already in the lane");
    assert.equal((await statusOf(pg, "Cy")).email, null);
    const fg = [await statusOf(pg, "Fa"), await statusOf(pg, "Gi")].map((r) => r.lead_status).sort();
    assert.deepEqual(fg, ["deduped", "needs_verify"]);
    assert.equal((await statusOf(pg, "Di")).lead_status, "email_not_found");
    assert.equal((await statusOf(pg, "Ed")).lead_status, "email_not_found");
    assert.equal(c.found_ready_to_verify, 2);
    assert.equal(c.not_found, 2);
    assert.deepEqual(calls, ["hold:email_found", "suppress:email_found"]);
    assert.equal(repo.booked.length, 1);
    assert.equal(repo.booked[0]!.approved_by, "Josh");
    assert.equal(repo.booked[0]!.cents, 37, "the finder's own spend, booked");
  });

  it("without a yes that covers the look-up it asks with the number and calls nobody", async () => {
    const pg = await lane();
    await seed(pg);
    const repo = fakeRepo(pg, 0);
    const finder = fakeFinder(pg, {});
    const out = await stage(repo, finder, []).run(run, settings);
    assert.equal(out.kind, "waiting");
    assert.equal(finder.started, 0);
    assert.equal(repo.cards.length, 1);
    assert.equal(repo.cards[0]!.payload.worst_case_cents, findWorstCaseCents(5));
  });
});
