import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CardRow } from "../db/repo.js";
import { icpWorstCaseCents } from "../stages/icp/index.js";
import { worstCaseCents } from "../spend/prices.js";
import { DEFAULT_LOOKING_FOR, questionKey, siteCheck, storeDomainSql, type SiteCheckDeps } from "./siteCheck.js";

/** D71, D72 — the website checker is a verb. Fake database, fake edge functions, fake console; the assertions are on the SQL shape, the ledger and the counts. No vendor is reached. Ask Josh. */

interface World {
  icpRows: Array<{ gate: string | null; label: string | null; unreadable: boolean | null; n: string }>;
  peopleRows: Array<{ k: string; n: string }>;
  variant: { jev_variant: string; disco_icp: string | null } | null;
  run: Record<string, unknown> | null;
}

function build(w: World) {
  const seen: Array<{ text: string; params: unknown[] }> = [];
  const cards: CardRow[] = [];
  const ledger: Array<Record<string, unknown>> = [];
  const gateCalls: string[] = [];
  const db = {
    query: async (text: string, params: unknown[] = []) => {
      seen.push({ text, params });
      if (text.includes("from information_schema.tables")) return { rows: [{ table_schema: "client_emcor", table_name: "contacts", estimate: "10" }, { table_schema: "public", table_name: "emcor_wf_contacts", estimate: "4286" }] };
      if (text.includes("from information_schema.columns") && params.length === 1) {
        return { rows: ["first_name", "last_name", "title", "domain", "wf_email"].map((c) => ({ table_schema: "public", table_name: "emcor_wf_contacts", column_name: c })).concat(["name", "website"].map((c) => ({ table_schema: "client_emcor", table_name: "contacts", column_name: c }))) };
      }
      if (text.includes("from information_schema.columns")) return { rows: ["email", "first_name", "last_name", "title", "company_domain", "run_id", "lead_status"].map((column_name) => ({ column_name })) };
      if (text.includes("from topup.icp_variants")) return { rows: w.variant ? [w.variant] : [] };
      if (text.startsWith("select v.fit as gate")) return { rows: w.icpRows };
      if (text.startsWith("select case when a.domain is not null")) return { rows: w.peopleRows };
      if (text.startsWith("select lower(coalesce(nullif(btrim(p.title)")) return { rows: [{ title: "owner", n: "3" }, { title: "president", n: "1" }] };
      if (text.startsWith("select d.d, p.title")) return { rows: [{ d: "acme.test", title: "Owner" }] };
      if (text.startsWith("select d.d, v.label")) return { rows: params[params.length - 2] === "no" ? [{ d: "acme.test", label: "general_contractor" }] : [] };
      if (text.includes("sum(cost)")) return { rows: [{ usd: "0.0123" }] };
      return { rows: [], rowCount: 2 };
    },
  };
  let cardN = 0;
  const card = (payload: Record<string, unknown>, run_id: string | null): CardRow => ({ card_id: `card-${++cardN}`, run_id, kind: "spend_approval", audience: "owner", status: "open", payload, slack_channel: null, slack_ts: null, resolved_by: null, resolution: null, created_at: "", resolved_at: null, expires_at: null });
  const deps: SiteCheckDeps = {
    db: db as never,
    repo: {
      getRun: async (id: string) => (w.run && id === w.run.run_id ? (w.run as never) : null),
      openCardsForRun: async (runId: string) => cards.filter((c) => c.status === "open" && c.run_id === runId),
      openCards: async () => cards.filter((c) => c.status === "open"),
      spentTodayCents: async () => 0,
      updateCardPayload: async (id: string, payload: Record<string, unknown>) => {
        const c = cards.find((x) => x.card_id === id);
        if (c) c.payload = payload;
      },
      setCardBlocks: async () => undefined,
    } as never,
    console: {
      ask: async (input: { run: { run_id: string } | null; payload: Record<string, unknown> }) => {
        const c = card(input.payload, input.run?.run_id ?? null);
        cards.push(c);
        return c;
      },
      resolveAs: async (actor: string, _role: unknown, cardId: string, choice: string) => {
        const c = cards.find((x) => x.card_id === cardId && x.status === "open");
        if (!c) return { ok: false as const, reason: "unknown_card" as const, message: "gone" };
        c.status = "resolved";
        c.resolved_by = actor;
        c.resolution = choice;
        return { ok: true as const, card: c, choice };
      },
    } as never,
    rails: {
      cfg: { autoCapCents: 0, dailyCapCents: 2500, driftTolerance: 0.1 },
      decide: (req: { rows: number; approvedCents?: number; worstCaseCents?: number }) => {
        const worst = req.worstCaseCents ?? 0;
        if (worst === 0) return { kind: "proceed", worstCaseCents: 0, reason: "free" };
        return (req.approvedCents ?? 0) >= worst ? { kind: "proceed", worstCaseCents: worst, reason: "approved" } : { kind: "ask", worstCaseCents: worst, reason: "needs a name" };
      },
      record: async (row: Record<string, unknown>) => {
        ledger.push(row);
        return 0;
      },
    } as never,
    ledger: { event: async () => undefined } as never,
    gate: {
      fetchSites: async (batch: string) => {
        gateCalls.push(`fetch:${batch}`);
        return { processed: 2, ok: 2, released: 0, remaining: 0 };
      },
      grade: async (batch: string, model: string) => {
        gateCalls.push(`grade:${batch}:${model}`);
        return { processed: 2, errors: 0, last_error: null, remaining: 0 };
      },
      discoSubmit: async (batch: string) => {
        gateCalls.push(`disco:${batch}`);
        return { task_id: null, domains: 0 };
      },
      discoCollect: async () => ({ status: "completed" }),
    },
    people: {
      fetchSites: async (batch: string) => {
        gateCalls.push(`pfetch:${batch}`);
        return { processed: 3, ok: 3, released: 0, remaining: 0 };
      },
      extract: async (batch: string, model: string) => {
        gateCalls.push(`extract:${batch}:${model}`);
        return { processed: 3, errors: 0, last_error: null, remaining: 0, people: 7 };
      },
      ask: async (batch: string, lookingFor: string, model: string) => {
        gateCalls.push(`ask:${batch}:${lookingFor}:${model}`);
        return { processed: 3, errors: 0, last_error: null, remaining: 0, found: 2, nobody_listed: 1 };
      },
    },
    jevModel: "typesafe/jev-1.13",
    geminiModel: "gemini-3.1-flash-lite",
    pollMs: 1,
    deadMs: 100,
    by: "grok",
    clock: { now: () => 0, sleep: async () => undefined },
  };
  return { deps, seen, cards, ledger, gateCalls };
}

const run = { run_id: "11111111-2222-3333-4444-555555555555", client_tag: "emcor", lane: "lane_e", status: "running" };

describe("D71 — site_check", () => {
  it("builds a bare host from domain, website and email columns", () => {
    const d = storeDomainSql(new Set(["website", "wf_email"]))!;
    assert.match(d, /regexp_replace\(lower\(btrim\(website\)\)/);
    assert.match(d, /split_part\(wf_email, '@', 2\)/);
    assert.match(d, /\\\.\[a-z\]\{2,\}\$/);
    assert.equal(storeDomainSql(new Set(["foo"])), null);
  });

  it("refuses without a scope, with both, with a store leftovers does not list, and without the gate", async () => {
    const { deps } = build({ icpRows: [], peopleRows: [], variant: null, run: null });
    assert.equal((await siteCheck(deps, { question: "icp" })).status, "refused");
    assert.equal((await siteCheck(deps, { question: "icp", job_id: "x", table: "a.b", client_tag: "emcor" })).status, "refused");
    const r = await siteCheck(deps, { question: "icp", client_tag: "emcor", table: "public.other_people" });
    assert.equal(r.status, "refused");
    assert.match(r.reason!, /not a store leftovers lists/);
    const bad = await siteCheck(deps, { question: "icp", client_tag: "emcor", table: "public.emcor_wf_contacts; drop table x" });
    assert.equal(bad.status, "refused");
    const off = build({ icpRows: [], peopleRows: [], variant: null, run: null });
    off.deps.gate = null;
    assert.match((await siteCheck(off.deps, { question: "icp", client_tag: "emcor", table: "public.emcor_wf_contacts" })).reason!, /not configured/);
  });

  it("icp on a store: the estimate opens a card and waits; the name runs fetch, Jev and the fallback, records the ledger, and never touches the rows", async () => {
    const w = build({ icpRows: [{ gate: "yes", label: "buyer_with_own_facility", unreadable: false, n: "5" }, { gate: null, label: null, unreadable: false, n: "40" }, { gate: null, label: null, unreadable: true, n: "2" }], peopleRows: [], variant: { jev_variant: "emcor2", disco_icp: "emcor" }, run: null });
    const first = await siteCheck(w.deps, { question: "icp", client_tag: "emcor", table: "public.emcor_wf_contacts" });
    assert.equal(first.status, "waiting_approval");
    assert.equal(first.to_check, 42, "D71: unchecked plus unreadable when DiscoLike is configured");
    assert.equal(first.worst_case_cents, icpWorstCaseCents(42));
    assert.equal(w.cards.length, 1);
    assert.equal(w.cards[0]!.payload.step, "site_check");
    assert.equal(w.cards[0]!.payload.scope, "table:public.emcor_wf_contacts");
    assert.equal(w.gateCalls.length, 0, "D51: nothing paid before a name");
    assert.deepEqual(first.counts, { domains: 47, checked_yes: 5, checked_no: 0, unreadable: 2, unchecked: 40 });
    const second = await siteCheck(w.deps, { question: "icp", client_tag: "emcor", table: "public.emcor_wf_contacts", approved_by: "Josh" });
    assert.equal(second.status, "done");
    assert.equal(w.cards[0]!.status, "resolved");
    assert.equal(w.cards[0]!.resolved_by, "Josh via grok");
    assert.equal(second.model, "jev:typesafe/jev-1.13|emcor2");
    assert.ok(w.gateCalls.some((c) => c.startsWith("fetch:check_icp_")));
    assert.ok(w.gateCalls.some((c) => c.startsWith("grade:check_icp_") && c.endsWith("|emcor2")));
    assert.ok(w.gateCalls.some((c) => c.startsWith("disco:check_icp_")));
    const ins = w.seen.find((q) => q.text.includes("insert into client_salesglider.icp_site_text"));
    assert.ok(ins, "D71: the scope's domains join the batch");
    assert.match(ins!.text, /not exists \(select 1 from client_salesglider\.icp_llm_results/, "D71: a domain with a verdict for this model is not re-pointed or re-paid");
    assert.match(ins!.text, /from "public"\."emcor_wf_contacts"/);
    assert.ok(!w.seen.some((q) => /^\s*(update|delete)\s/i.test(q.text) && q.text.includes("emcor_wf_contacts")), "D71: nothing on the store's rows changes");
    assert.equal(w.ledger.length, 1);
    assert.equal(w.ledger[0]!.approvedBy, "Josh");
    assert.equal(w.ledger[0]!.vendor, "jev");
    assert.equal(w.ledger[0]!.step, "site_check");
    assert.deepEqual(second.samples, { flagged: ["acme.test (general_contractor)"], passed: [] });
    assert.equal(second.cost_cents, 2);
  });

  it("icp with no label set for the client refuses and names the fix", async () => {
    const w = build({ icpRows: [], peopleRows: [], variant: null, run: null });
    const r = await siteCheck(w.deps, { question: "icp", client_tag: "emcor", table: "public.emcor_wf_contacts" });
    assert.equal(r.status, "refused");
    assert.match(r.reason!, /topup\.icp_variants/);
  });

  it("people on a job: the sites are queued by domain, Gemini lists, Jev picks, counts come back by title; never a name", async () => {
    const w = build({ icpRows: [], peopleRows: [{ k: "found", n: "4" }, { k: "nobody_listed", n: "1" }, { k: "unchecked", n: "3" }, { k: "unreadable", n: "1" }], variant: null, run });
    const first = await siteCheck(w.deps, { question: "people", job_id: run.run_id });
    assert.equal(first.status, "waiting_approval");
    assert.equal(first.client_tag, "emcor");
    assert.equal(first.scope, "job:11111111");
    assert.equal(first.looking_for, DEFAULT_LOOKING_FOR, "D72: no looking_for means the owner");
    assert.equal(first.question_key, questionKey(DEFAULT_LOOKING_FOR));
    assert.equal(first.to_check, 3, "D72: the sites with no answer for this question and not known to be unreadable");
    assert.equal(first.worst_case_cents, worstCaseCents("gemini", "extract", 3) + worstCaseCents("jev", "grade", 3));
    assert.equal(w.cards[0]!.run_id, run.run_id, "the card hangs off the job so job() shows it");
    assert.deepEqual(first.counts, { domains: 9, found: 4, nobody_listed: 1, unreadable: 1, unchecked: 3 });
    const done = await siteCheck(w.deps, { question: "people", job_id: run.run_id, looking_for: "  the service   manager ", approved_by: "Cayden" });
    assert.equal(done.status, "done");
    assert.equal(done.looking_for, "the service manager");
    assert.equal(done.model, "gemini:gemini-3.1-flash-lite then jev:typesafe/jev-1.13");
    const queue = w.seen.find((q) => q.text.includes("insert into topup.site_people_text"));
    assert.ok(queue, "D72: the scope's domains join the batch");
    assert.match(queue!.text, /select d\.d, \$2 from/, "D72: domains only");
    assert.match(queue!.text, /not exists \(select 1 from topup\.site_answers a where a\.domain = d\.d and a\.question_key = md5\(lower\(\$3\)\)/, "D72: a site answered for this question is not re-pointed or re-paid");
    assert.equal(queue!.params[2], "the service manager");
    assert.doesNotMatch(queue!.text, /returning/i);
    assert.ok(w.gateCalls.some((c) => c.startsWith("pfetch:check_people_11111111")));
    assert.ok(w.gateCalls.some((c) => c.startsWith("extract:check_people_11111111:gemini:gemini-3.1-flash-lite")));
    assert.ok(w.gateCalls.some((c) => c === "ask:check_people_11111111:the service manager:jev:typesafe/jev-1.13"));
    assert.ok(!w.gateCalls.some((c) => c.startsWith("disco:") || c.startsWith("grade:")), "D72: the people question never calls the ICP grader or DiscoLike");
    assert.equal(w.ledger.length, 2);
    assert.deepEqual(w.ledger.map((l) => [l.vendor, l.action, l.approvedBy]), [["gemini", "extract", "Cayden"], ["jev", "grade", "Cayden"]]);
    assert.equal(done.counts!.people_listed, 7);
    assert.deepEqual(done.by_title, { owner: 3, president: 1 });
    assert.deepEqual(done.samples, { flagged: [], passed: ["acme.test (Owner)"] });
    assert.match(done.next!, /topup\.site_people_found/);
    assert.match(done.next!, new RegExp(`question_key = '${questionKey("the service manager")}'`));
    assert.ok(!Object.keys(done).some((k) => /name/.test(k)) && !JSON.stringify(done.counts).match(/name/) && !JSON.stringify(done.by_title).match(/name/), "D2: the answer carries no name field");
  });

  it("people: nothing to pay for when every site has an answer; refused when the function is not configured", async () => {
    const w = build({ icpRows: [], peopleRows: [{ k: "found", n: "6" }, { k: "nobody_listed", n: "2" }], variant: null, run });
    const r = await siteCheck(w.deps, { question: "people", job_id: run.run_id });
    assert.equal(r.status, "nothing");
    assert.equal(w.cards.length, 0);
    assert.equal(r.counts!.found, 6);
    assert.match(r.next!, /pull\(client_tag, campaign_id, source="table"/);
    const off = build({ icpRows: [], peopleRows: [], variant: null, run });
    off.deps.people = null;
    const no = await siteCheck(off.deps, { question: "people", job_id: run.run_id });
    assert.equal(no.status, "refused");
    assert.match(no.reason!, /SITE_PEOPLE_KEY/);
  });

  it("a name given with no open card opens one and taps it; a quote that grew past the approval asks again", async () => {
    const w = build({ icpRows: [], peopleRows: [{ k: "unchecked", n: "10" }], variant: null, run });
    const r = await siteCheck(w.deps, { question: "people", job_id: run.run_id, approved_by: "Josh" });
    assert.equal(r.status, "done");
    assert.equal(w.cards.length, 1);
    assert.equal(w.cards[0]!.status, "resolved");
    const small = build({ icpRows: [], peopleRows: [{ k: "unchecked", n: "1000" }], variant: null, run });
    await siteCheck(small.deps, { question: "people", job_id: run.run_id });
    assert.ok(Number(small.cards[0]!.payload.worst_case_cents) >= 100);
    small.cards[0]!.payload.worst_case_cents = 1;
    const again = await siteCheck(small.deps, { question: "people", job_id: run.run_id, approved_by: "Josh" });
    assert.equal(again.status, "waiting_approval");
    assert.equal(small.cards.length, 2, "D51: the grown quote is a new card");
    assert.equal(small.gateCalls.length, 0);
  });
});
