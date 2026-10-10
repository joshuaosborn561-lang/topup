import type { IcpGate } from "../clients/icpGate.js";
import { jevModel } from "../clients/icpGate.js";
import { spendApprovalCard } from "../console/cards.js";
import type { Console } from "../console/console.js";
import type { Queryable } from "../db/pool.js";
import { ingestedTable } from "../db/pool.js";
import type { CardRow, Repo } from "../db/repo.js";
import type { RunRow } from "../domain/runs.js";
import type { LaneLedger } from "../ledger/lane.js";
import { usd, worstCaseCents } from "../spend/prices.js";
import type { SpendRails } from "../spend/rails.js";
import { realClock, type Clock } from "../stages/common.js";
import { icpWorstCaseCents } from "../stages/icp/index.js";
import { DISCO_MODEL, fetchAll, gradeAll, LLM_RESULTS, SITE_TEXT } from "../stages/icp/loops.js";
import { icpLabelSql } from "../stages/icp/parse.js";
import { discoverStores } from "./leftovers.js";

/**
 * The website checker as a verb (D71; skill icp-website-gate). Our own
 * site fetch (free), then one Jev question over a job's rows or a store
 * that `leftovers` named:
 *
 *   icp     Is each company in the client's ICP? The client's label set
 *           from topup.icp_variants; the verdict is per domain in
 *           client_salesglider.icp_llm_results, where icp(job_id) reads
 *           it too, so a checked domain is never paid for twice.
 *   owners  For each named person, which role Jev reads them into from
 *           the title we hold and the company's own site: owner_or_founder,
 *           executive_decision_maker, manager_or_lead,
 *           staff_or_individual_contributor. The verdict is per person in
 *           topup.site_check_people. The first two labels are the owners
 *           and decision makers Josh's call lists want.
 *
 * The first call returns the estimate and the counts so far; the same
 * call with approved_by runs it and records who said yes (D51). Nothing
 * on the store's rows changes. Jev cannot name a person it has not been
 * given: this verb judges the people a store already holds; names come
 * from site_staff, the people waterfall or a pull. Counts, labels and at
 * most ten sample domains; never a name.
 */
export const SITE_CHECK_QUESTIONS = ["icp", "owners"] as const;
export type SiteCheckQuestion = (typeof SITE_CHECK_QUESTIONS)[number];

/** The owners question's label set, one pick per person; the first two pass (D71). */
export const OWNER_LABELS = ["owner_or_founder", "executive_decision_maker", "manager_or_lead", "staff_or_individual_contributor"] as const;
export const OWNER_PASS: readonly string[] = ["owner_or_founder", "executive_decision_maker"];
/** The icp-llm variant that carries the owners question. */
export const OWNERS_VARIANT = "owners";
export const PEOPLE_TABLE = "topup.site_check_people";
export const LABEL_TOKEN = /^[a-z][a-z0-9_]{2,80}$/;
const SAMPLE_FLAGGED = 10;
const SAMPLE_PASSED = 4;

export const SITE_CHECK_RULE =
  "The website checker: our own site fetch (free) then one Jev question, about $0.11 per 1,000 answers (D71). " +
  "question=icp grades each company against the client's label set; question=owners sorts each named person into owner_or_founder, executive_decision_maker, manager_or_lead or staff_or_individual_contributor. " +
  "The first call is the estimate; approved_by=\"Name\" runs it. Verdicts are kept per domain and per person, so a re-run pays only for what is new. Nothing on the rows changes; you read the counts and decide (D53).";

export interface SiteCheckDeps {
  db: Queryable;
  repo: Pick<Repo, "getRun" | "openCardsForRun" | "openCards" | "spentTodayCents" | "updateCardPayload" | "setCardBlocks">;
  console: Pick<Console, "ask" | "resolveAs">;
  rails: Pick<SpendRails, "decide" | "record" | "cfg">;
  ledger?: Pick<LaneLedger, "event"> | null;
  gate: IcpGate | null;
  /** The OpenRouter model id Jev runs as (ICP_JEV_MODEL). */
  jevModel: string;
  pollMs: number;
  deadMs: number;
  by: string;
  clock?: Clock;
}

export interface SiteCheckInput {
  question: SiteCheckQuestion;
  client_tag?: string | null;
  job_id?: string | null;
  table?: string | null;
  approved_by?: string | null;
}

export interface SiteCheckCounts {
  [k: string]: number;
}

export interface SiteCheckResult {
  question: SiteCheckQuestion;
  client_tag: string | null;
  scope: string;
  status: "refused" | "waiting_approval" | "nothing" | "done";
  reason?: string;
  next?: string;
  batch?: string;
  model?: string;
  worst_case_cents?: number;
  card_id?: string | null;
  approved_by?: string | null;
  to_check?: number;
  counts?: SiteCheckCounts;
  by_label?: Record<string, number>;
  samples?: { flagged: string[]; passed: string[] };
  cost_cents?: number;
  labels?: readonly string[];
  passes?: readonly string[];
  rule: string;
}

interface Scope {
  kind: "job" | "table";
  clientTag: string;
  rel: string;
  where: string;
  params: unknown[];
  cols: Set<string>;
  label: string;
  run: RunRow | null;
}

const IDENT = /^[a-z][a-z0-9_]*$/;

/** A bare host from a domain, website or email column, lower case, no scheme, no www., no path. Null when it does not look like a domain. */
export function storeDomainSql(cols: Set<string>, prefix = ""): string | null {
  const host = (expr: string) => `split_part(split_part(regexp_replace(lower(btrim(${expr})), '^(https?://)?(www\\.)?', ''), '/', 1), ':', 1)`;
  const parts: string[] = [];
  for (const c of ["company_domain", "domain", "wf_domain", "website"]) if (cols.has(c)) parts.push(`nullif(${host(`${prefix}${c}`)}, '')`);
  for (const c of ["email", "wf_email", "candidate_email"]) if (cols.has(c)) parts.push(`nullif(lower(split_part(${prefix}${c}, '@', 2)), '')`);
  if (!parts.length) return null;
  const d = `coalesce(${parts.join(", ")})`;
  return `(case when ${d} ~ '^[a-z0-9][a-z0-9.-]*\\.[a-z]{2,}$' then ${d} else null end)`;
}

/** A person's display name from the store's columns; stays inside SQL (insert … select). `name` is left out: on Maps tables it is the business. */
export function storeNameSql(cols: Set<string>, prefix = ""): string | null {
  const parts: string[] = [];
  if (cols.has("first_name") || cols.has("last_name")) {
    const f = cols.has("first_name") ? `${prefix}first_name` : "null";
    const l = cols.has("last_name") ? `${prefix}last_name` : "null";
    parts.push(`nullif(btrim(concat_ws(' ', ${f}, ${l})), '')`);
  }
  for (const c of ["full_name", "owner_name", "dm_name"]) if (cols.has(c)) parts.push(`nullif(btrim(${prefix}${c}), '')`);
  if (!parts.length) return null;
  const n = `coalesce(${parts.join(", ")})`;
  return `(case when ${n} ~ '^[^@]{2,80}$' then ${n} else null end)`;
}

export function storeTitleSql(cols: Set<string>, prefix = ""): string {
  const parts = ["title", "job_title", "owner_title", "wf_title", "position", "headline", "role"].filter((c) => cols.has(c)).map((c) => `nullif(btrim(${prefix}${c}), '')`);
  return parts.length ? `left(coalesce(${parts.join(", ")}), 120)` : "null::text";
}

export function siteCheckBatch(question: SiteCheckQuestion, seed: string): string {
  return `check_${question}_${seed.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

/** Worst case for n answers: the ICP question adds the DiscoLike fallback on the unreadable tenth; the owners question is Jev only. */
export function siteCheckWorstCaseCents(question: SiteCheckQuestion, n: number): number {
  return question === "icp" ? icpWorstCaseCents(n) : worstCaseCents("jev", "grade", n);
}

async function columnsOf(db: Queryable, schema: string, table: string): Promise<Set<string>> {
  const { rows } = await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, table]);
  return new Set(rows.map((r) => r.column_name));
}

async function resolveScope(d: SiteCheckDeps, input: SiteCheckInput): Promise<Scope | { error: string; next: string }> {
  const tag = input.client_tag ?? null;
  if (input.job_id && input.table) return { error: "pass job_id or table, not both", next: "site_check(question, job_id) or site_check(question, client_tag, table)" };
  if (input.job_id) {
    const run = await d.repo.getRun(input.job_id);
    if (!run) return { error: "no such job", next: "jobs() lists them" };
    if (tag && tag !== run.client_tag) return { error: `job ${input.job_id.slice(0, 8)} belongs to ${run.client_tag}, not ${tag}`, next: "leave client_tag out, or pass the job's" };
    const rel = ingestedTable(run.client_tag);
    const [schema, table] = rel.split(".") as [string, string];
    return { kind: "job", clientTag: run.client_tag, rel, where: "run_id = $1", params: [run.run_id], cols: await columnsOf(d.db, schema, table), label: `job:${run.run_id.slice(0, 8)}`, run };
  }
  if (!input.table) return { error: "name a scope: job_id, or client_tag plus table (schema.table as leftovers lists it)", next: "leftovers(client_tag) names the stores" };
  if (!tag || !IDENT.test(tag)) return { error: "table needs client_tag", next: "site_check(question, client_tag, table)" };
  const [schema, table, extra] = input.table.replace(/"/g, "").split(".");
  if (!schema || !table || extra || !IDENT.test(schema) || !IDENT.test(table)) return { error: `table must be schema.table, not ${input.table}`, next: "leftovers(client_tag) lists them as schema and table" };
  const found = (await discoverStores(d.db, tag)).find((f) => f.schema === schema && f.table === table);
  if (!found) return { error: `${schema}.${table} is not a store leftovers lists for ${tag}`, next: `leftovers("${tag}") names the stores this client owns` };
  return { kind: "table", clientTag: tag, rel: `"${schema}"."${table}"`, where: "true", params: [], cols: found.columns, label: `table:${schema}.${table}`, run: null };
}

/** The open spend card for this scope and question, if any. */
async function openCard(d: SiteCheckDeps, scope: Scope, question: SiteCheckQuestion): Promise<CardRow | null> {
  const cards = scope.run ? await d.repo.openCardsForRun(scope.run.run_id) : await d.repo.openCards("spend_approval");
  return cards.find((c) => c.kind === "spend_approval" && c.payload?.step === "site_check" && c.payload?.question === question && c.payload?.scope === scope.label) ?? null;
}

type Approval = { ok: true; approvedCents: number; by: string | null } | { ok: false; card: CardRow };

/**
 * D51: a name approves the quoted worst case before Jev runs. No name: the
 * card is posted (or re-quoted) and the caller waits. A name with an open
 * card taps it; a name with no card opens one and taps it in the same
 * breath, so the ledger of cards still says who approved what. A quote
 * that grew past what was approved asks again.
 */
async function approval(d: SiteCheckDeps, scope: Scope, question: SiteCheckQuestion, rows: number, worst: number, approvedBy: string | null, spentToday: number): Promise<Approval> {
  const payload = { step: "site_check", question, client_tag: scope.clientTag, scope: scope.label, vendor: question === "icp" ? "jev+discolike" : "jev", action: question === "icp" ? "icp_gate" : "owners", rows, worst_case_cents: worst };
  const blocks = (cardId: string) =>
    spendApprovalCard({ cardId, runId: scope.run?.run_id ?? scope.label, clientTag: scope.clientTag, step: "icp", vendor: question === "icp" ? "jev + discolike" : "jev", action: `site_check ${question}`, rows, worstCaseCents: worst, projectedUseful: null, spentTodayCents: spentToday, dailyCapCents: d.rails.cfg.dailyCapCents });
  const text = `site_check(${question}) on ${scope.label}: ${rows} to check, worst case ${usd(worst)}.`;
  let card = await openCard(d, scope, question);
  if (!approvedBy) {
    if (card) {
      await d.repo.updateCardPayload(card.card_id, payload);
      await d.repo.setCardBlocks(card.card_id, blocks(card.card_id));
    } else {
      card = await d.console.ask({ run: scope.run, kind: "spend_approval", audience: "owner", payload, text, blocks });
    }
    return { ok: false, card };
  }
  if (card) {
    const quoted = Number(card.payload?.worst_case_cents ?? 0);
    const tapped = await d.console.resolveAs(`${approvedBy} via ${d.by}`, "owner", card.card_id, "approve_spend");
    if (!tapped.ok) return { ok: false, card };
    if (quoted >= worst) return { ok: true, approvedCents: quoted, by: approvedBy };
    const again = await d.console.ask({ run: scope.run, kind: "spend_approval", audience: "owner", payload, text: `${text} (grew past the ${usd(quoted)} ${approvedBy} approved)`, blocks });
    return { ok: false, card: again };
  }
  const fresh = await d.console.ask({ run: scope.run, kind: "spend_approval", audience: "owner", payload, text, blocks });
  const tapped = await d.console.resolveAs(`${approvedBy} via ${d.by}`, "owner", fresh.card_id, "approve_spend");
  if (!tapped.ok) return { ok: false, card: fresh };
  return { ok: true, approvedCents: worst, by: approvedBy };
}

async function variantFor(db: Queryable, clientTag: string): Promise<{ jev_variant: string; disco_icp: string | null } | null> {
  try {
    const { rows } = await db.query<{ jev_variant: string; disco_icp: string | null }>(`select jev_variant, disco_icp from topup.icp_variants where client_tag = $1`, [clientTag]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/** The distinct domains of the scope, as a subquery named `d` with one column `d`. */
function domainsSql(scope: Scope, dsql: string): string {
  return `(select distinct ${dsql} as d from ${scope.rel} where ${scope.where} and ${dsql} is not null)`;
}

/** The distinct people of the scope: domain `d`, name `n`, title `t`, key `k`. Names stay in SQL. */
function peopleSql(scope: Scope, dsql: string, nsql: string, tsql: string): string {
  return `(select distinct on (d, k) d, n, t, k from (select ${dsql} as d, ${nsql} as n, ${tsql} as t, md5(lower(${dsql}) || '|' || lower(${nsql})) as k from ${scope.rel} where ${scope.where}) s where d is not null and n is not null order by d, k)`;
}

interface IcpTally {
  domains: number;
  checked_yes: number;
  checked_no: number;
  unreadable: number;
  unchecked: number;
  by_label: Record<string, number>;
}

async function icpTally(d: SiteCheckDeps, scope: Scope, dsql: string, model: string): Promise<IcpTally> {
  const n = scope.params.length;
  const { rows } = await d.db.query<{ gate: string | null; label: string | null; unreadable: boolean | null; n: string }>(
    `select v.fit as gate, v.label, (v.fit is null and t.http_status is not null and not (t.http_status between 200 and 399 and coalesce(t.chars, 0) > 300)) as unreadable, count(*)::text as n
       from ${domainsSql(scope, dsql)} d
       left join lateral (select r.fit, ${icpLabelSql(true)} as label from ${LLM_RESULTS} r
                            where r.domain = d.d and r.model in ($${n + 1}, '${DISCO_MODEL}') and r.error is null and r.fit in ('yes', 'no')
                            order by (r.model = $${n + 1}) desc limit 1) v on true
       left join ${SITE_TEXT} t on t.domain = d.d
      group by 1, 2, 3`,
    [...scope.params, model],
  );
  const t: IcpTally = { domains: 0, checked_yes: 0, checked_no: 0, unreadable: 0, unchecked: 0, by_label: {} };
  for (const r of rows) {
    const c = Number(r.n);
    t.domains += c;
    if (r.gate === "yes") t.checked_yes += c;
    else if (r.gate === "no") t.checked_no += c;
    else if (r.unreadable) t.unreadable += c;
    else t.unchecked += c;
    if (r.gate) {
      const key = `label_${(r.label ?? "none").replace(/[^a-z0-9_]/gi, "_").slice(0, 40)}`;
      t.by_label[key] = (t.by_label[key] ?? 0) + c;
    }
  }
  return t;
}

interface PeopleTally {
  people: number;
  answered: number;
  unreadable: number;
  unanswered: number;
  owner_or_decision_maker: number;
  by_label: Record<string, number>;
}

async function peopleTally(d: SiteCheckDeps, scope: Scope, dsql: string, nsql: string, tsql: string): Promise<PeopleTally> {
  const n = scope.params.length;
  const { rows } = await d.db.query<{ choice: string | null; unreadable: boolean | null; n: string }>(
    `select p.choice, (p.choice is null and t.http_status is not null and not (t.http_status between 200 and 399 and coalesce(t.chars, 0) > 300)) as unreadable, count(*)::text as n
       from ${peopleSql(scope, dsql, nsql, tsql)} s
       left join ${PEOPLE_TABLE} p on p.client_tag = $${n + 1} and p.domain = s.d and p.person_key = s.k
       left join ${SITE_TEXT} t on t.domain = s.d
      group by 1, 2`,
    [...scope.params, scope.clientTag],
  );
  const t: PeopleTally = { people: 0, answered: 0, unreadable: 0, unanswered: 0, owner_or_decision_maker: 0, by_label: {} };
  for (const r of rows) {
    const c = Number(r.n);
    t.people += c;
    if (r.choice && LABEL_TOKEN.test(r.choice)) {
      t.answered += c;
      t.by_label[`label_${r.choice.slice(0, 40)}`] = (t.by_label[`label_${r.choice.slice(0, 40)}`] ?? 0) + c;
      if (OWNER_PASS.includes(r.choice)) t.owner_or_decision_maker += c;
    } else if (r.unreadable) t.unreadable += c;
    else t.unanswered += c;
  }
  return t;
}

/** The ten-sample rule (D2): at most ten flagged and four passed domains with their label. Domains, never people. */
async function icpSamples(d: SiteCheckDeps, scope: Scope, dsql: string, model: string): Promise<{ flagged: string[]; passed: string[] }> {
  const n = scope.params.length;
  const pick = async (fit: string, limit: number) => {
    const { rows } = await d.db.query<{ d: string; label: string | null }>(
      `select d.d, v.label from ${domainsSql(scope, dsql)} d
         join lateral (select r.fit, ${icpLabelSql(true)} as label from ${LLM_RESULTS} r
                        where r.domain = d.d and r.model in ($${n + 1}, '${DISCO_MODEL}') and r.error is null and r.fit in ('yes', 'no')
                        order by (r.model = $${n + 1}) desc limit 1) v on v.fit = $${n + 2}
        order by d.d limit $${n + 3}`,
      [...scope.params, model, fit, limit],
    );
    return rows.map((r) => `${r.d} (${r.label ?? "?"})`);
  };
  try {
    return { flagged: await pick("no", SAMPLE_FLAGGED), passed: await pick("yes", SAMPLE_PASSED) };
  } catch {
    return { flagged: [], passed: [] };
  }
}

async function costCents(db: Queryable, sql: string, params: unknown[]): Promise<number> {
  try {
    const { rows } = await db.query<{ usd: string | null }>(sql, params);
    return Math.ceil(Number(rows[0]?.usd ?? 0) * 100);
  } catch {
    return 0;
  }
}

export async function siteCheck(d: SiteCheckDeps, input: SiteCheckInput): Promise<SiteCheckResult> {
  const clock = d.clock ?? realClock;
  const base = { question: input.question, client_tag: input.client_tag ?? null, rule: SITE_CHECK_RULE };
  if (!SITE_CHECK_QUESTIONS.includes(input.question)) return { ...base, scope: "", status: "refused", reason: `question must be one of ${SITE_CHECK_QUESTIONS.join(", ")}` };
  const scope = await resolveScope(d, input);
  if ("error" in scope) return { ...base, scope: "", status: "refused", reason: scope.error, next: scope.next };
  const out = { ...base, client_tag: scope.clientTag, scope: scope.label };
  if (!d.gate) return { ...out, status: "refused", reason: "the website checker is not configured on this service (ICP_SITE_FETCH_KEY, ICP_LLM_KEY). Ask Josh." };
  const dsql = storeDomainSql(scope.cols);
  if (!dsql) return { ...out, status: "refused", reason: `${scope.label} has no domain, website or email column to read a site from`, next: "domain_waterfall fills domains; then site_check again" };
  const seed = scope.run?.run_id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const batch = siteCheckBatch(input.question, seed);
  const spentToday = await d.repo.spentTodayCents();

  if (input.question === "icp") {
    const variant = await variantFor(d.db, scope.clientTag);
    if (!variant) return { ...out, status: "refused", reason: `no ICP label set for ${scope.clientTag}: write it per skills/icp-website-gate (JEV_Q and PASS in icp-llm, then a row in topup.icp_variants). Ask Josh.` };
    const model = jevModel(d.jevModel, variant.jev_variant);
    const before = await icpTally(d, scope, dsql, model);
    const toCheck = before.unchecked + (variant.disco_icp ? before.unreadable : 0);
    const counts = (t: IcpTally): SiteCheckCounts => ({ domains: t.domains, checked_yes: t.checked_yes, checked_no: t.checked_no, unreadable: t.unreadable, unchecked: t.unchecked });
    const tail = { batch, model, labels: undefined, passes: undefined };
    if (toCheck === 0) return { ...out, ...tail, status: "nothing", to_check: 0, counts: counts(before), by_label: before.by_label, samples: await icpSamples(d, scope, dsql, model), next: before.domains === 0 ? "no domains in scope" : "every domain in scope has a verdict; read the counts" };
    const worst = siteCheckWorstCaseCents("icp", toCheck);
    const ok = await approval(d, scope, "icp", toCheck, worst, input.approved_by ?? null, spentToday);
    if (!ok.ok) return { ...out, ...tail, status: "waiting_approval", to_check: toCheck, worst_case_cents: worst, card_id: ok.card.card_id, counts: counts(before), by_label: before.by_label, next: `name the worst case ${usd(worst)} to a person, then site_check again with approved_by="Their name"` };
    const decision = d.rails.decide({ runId: scope.run?.run_id ?? "canon", clientTag: scope.clientTag, step: "icp", vendor: "jev", action: "grade", rows: toCheck, recipeAuthorised: true, approvedCents: ok.approvedCents, worstCaseCents: worst }, spentToday);
    if (decision.kind !== "proceed") return { ...out, ...tail, status: "refused", reason: decision.reason, worst_case_cents: worst, counts: counts(before) };
    const n = scope.params.length;
    // 1. The unchecked domains join the batch; a domain graded under another batch is re-pointed only when this model has no verdict for it.
    await d.db.query(
      `insert into ${SITE_TEXT} (domain, batch)
       select d.d, $${n + 1} from ${domainsSql(scope, dsql)} d
        where not exists (select 1 from ${LLM_RESULTS} r where r.domain = d.d and r.model = $${n + 2} and r.error is null and r.fit in ('yes', 'no'))
       on conflict (domain) do update set batch = excluded.batch where ${SITE_TEXT}.http_status is distinct from -1`,
      [...scope.params, batch, model],
    );
    // 2. Fetch (free), 3. Jev (one call at a time).
    const fetched = await fetchAll(d.gate, batch);
    const graded = await gradeAll((per, w) => d.gate!.grade(batch, model, per, w));
    const jevCost = await costCents(d.db, `select coalesce(sum(cost), 0)::text as usd from ${LLM_RESULTS} where batch = $1 and model = $2`, [batch, model]);
    await d.rails.record({ runId: scope.run?.run_id ?? null, clientTag: scope.clientTag, step: "site_check", vendor: "jev", action: "grade", rows: graded.graded, credits: graded.graded, worstCaseCents: worst, balanceBefore: null, balanceAfter: null, vendorJobId: batch, approvedBy: ok.by });
    // 4. DiscoLike on what we could not read, one task at a time.
    let fallback = 0;
    if (variant.disco_icp) {
      const sub = await d.gate.discoSubmit(batch, variant.disco_icp);
      fallback = sub.domains;
      if (sub.task_id) {
        const started = clock.now();
        for (;;) {
          const c = await d.gate.discoCollect(sub.task_id, batch);
          if (c.status === "completed") break;
          if (clock.now() - started > d.deadMs) throw new Error(`DiscoLike task ${sub.task_id} still running after ${Math.round(d.deadMs / 60000)} min`);
          await clock.sleep(d.pollMs);
        }
        await d.rails.record({ runId: scope.run?.run_id ?? null, clientTag: scope.clientTag, step: "site_check", vendor: "discolike", action: "validate_icp", rows: fallback, credits: fallback, worstCaseCents: null, balanceBefore: null, balanceAfter: null, vendorJobId: sub.task_id, approvedBy: ok.by });
      }
    }
    const after = await icpTally(d, scope, dsql, model);
    const cost = jevCost + worstCaseCents("discolike", "validate_icp", fallback);
    const result: SiteCheckResult = {
      ...out,
      ...tail,
      status: "done",
      approved_by: ok.by,
      to_check: toCheck,
      worst_case_cents: worst,
      counts: { ...counts(after), fetched: fetched.fetched, fetched_ok: fetched.fetched_ok, graded: graded.graded, grade_errors: graded.errors, fallback_domains: fallback, newly_checked: after.checked_yes + after.checked_no - before.checked_yes - before.checked_no },
      by_label: after.by_label,
      samples: await icpSamples(d, scope, dsql, model),
      cost_cents: cost,
      next: "read the label counts; if one label swallows a big share, the label set is wrong (icp-website-gate). icp(job_id) stamps these verdicts on a job's rows at no extra cost.",
      ...(graded.last_error ? { reason: `last Jev error: ${graded.last_error.slice(0, 120)}` } : {}),
    };
    await d.ledger?.event({ client_tag: scope.clientTag, lane: scope.run?.lane ?? "site_check", run_id: scope.run?.run_id ?? null, event: "step", line: `site_check(icp) on ${scope.label} by ${d.by}, approved by ${ok.by}: ${after.checked_yes} yes · ${after.checked_no} no · ${after.unreadable} unreadable · ${usd(cost)}.`, actor: d.by }).catch(() => undefined);
    return result;
  }

  // owners
  const nsql = storeNameSql(scope.cols);
  if (!nsql) return { ...out, status: "refused", reason: `${scope.label} has no name column (first_name/last_name, full_name, owner_name or dm_name); the owners question judges people a store already holds`, next: "people_waterfall or a pull names people; then site_check again" };
  const tsql = storeTitleSql(scope.cols);
  const model = jevModel(d.jevModel, OWNERS_VARIANT);
  const before = await peopleTally(d, scope, dsql, nsql, tsql);
  const counts = (t: PeopleTally): SiteCheckCounts => ({ people: t.people, answered: t.answered, owner_or_decision_maker: t.owner_or_decision_maker, unreadable: t.unreadable, unanswered: t.unanswered });
  const tail = { batch, model, labels: OWNER_LABELS, passes: OWNER_PASS };
  if (before.unanswered === 0) return { ...out, ...tail, status: "nothing", to_check: 0, counts: counts(before), by_label: before.by_label, next: before.people === 0 ? "no named people with a domain in scope" : "every person in scope has a verdict; read the counts" };
  const worst = siteCheckWorstCaseCents("owners", before.unanswered);
  const ok = await approval(d, scope, "owners", before.unanswered, worst, input.approved_by ?? null, spentToday);
  if (!ok.ok) return { ...out, ...tail, status: "waiting_approval", to_check: before.unanswered, worst_case_cents: worst, card_id: ok.card.card_id, counts: counts(before), by_label: before.by_label, next: `name the worst case ${usd(worst)} to a person, then site_check again with approved_by="Their name"` };
  const decision = d.rails.decide({ runId: scope.run?.run_id ?? "canon", clientTag: scope.clientTag, step: "icp", vendor: "jev", action: "grade", rows: before.unanswered, recipeAuthorised: true, approvedCents: ok.approvedCents, worstCaseCents: worst }, spentToday);
  if (decision.kind !== "proceed") return { ...out, ...tail, status: "refused", reason: decision.reason, worst_case_cents: worst, counts: counts(before) };
  const n = scope.params.length;
  // 1. The people join the queue, server side; an answered person keeps the answer, an unanswered one is re-pointed and retried.
  await d.db.query(
    `insert into ${PEOPLE_TABLE} (client_tag, domain, person_key, full_name, title, batch)
     select $${n + 1}, s.d, s.k, s.n, s.t, $${n + 2} from ${peopleSql(scope, dsql, nsql, tsql)} s
     on conflict (client_tag, domain, person_key) do update
       set batch = excluded.batch, title = coalesce(excluded.title, ${PEOPLE_TABLE}.title), error = null
       where ${PEOPLE_TABLE}.choice is null`,
    [...scope.params, scope.clientTag, batch],
  );
  // 2. Their sites join the fetch queue; a site fetched before is read as it is.
  await d.db.query(
    `insert into ${SITE_TEXT} (domain, batch)
     select distinct p.domain, $2 from ${PEOPLE_TABLE} p where p.batch = $2 and p.client_tag = $1 and p.choice is null
     on conflict (domain) do update set batch = excluded.batch where ${SITE_TEXT}.http_status is null`,
    [scope.clientTag, batch],
  );
  const fetched = await fetchAll(d.gate, batch);
  // 3. Jev reads each person into a role, one call at a time.
  const graded = await gradeAll((per, w) => d.gate!.gradePeople(batch, model, per, w));
  const cost = await costCents(d.db, `select coalesce(sum(cost), 0)::text as usd from ${PEOPLE_TABLE} where batch = $1 and client_tag = $2`, [batch, scope.clientTag]);
  await d.rails.record({ runId: scope.run?.run_id ?? null, clientTag: scope.clientTag, step: "site_check", vendor: "jev", action: "grade", rows: graded.graded, credits: graded.graded, worstCaseCents: worst, balanceBefore: null, balanceAfter: null, vendorJobId: batch, approvedBy: ok.by });
  const after = await peopleTally(d, scope, dsql, nsql, tsql);
  const result: SiteCheckResult = {
    ...out,
    ...tail,
    status: "done",
    approved_by: ok.by,
    to_check: before.unanswered,
    worst_case_cents: worst,
    counts: { ...counts(after), fetched: fetched.fetched, fetched_ok: fetched.fetched_ok, graded: graded.graded, grade_errors: graded.errors, newly_answered: after.answered - before.answered },
    by_label: after.by_label,
    cost_cents: cost,
    next: "owner_or_founder and executive_decision_maker are the owners and decision makers; the rest are not. Nothing on the rows changed: you decide what to do with the counts.",
    ...(graded.last_error ? { reason: `last Jev error: ${graded.last_error.slice(0, 120)}` } : {}),
  };
  await d.ledger?.event({ client_tag: scope.clientTag, lane: scope.run?.lane ?? "site_check", run_id: scope.run?.run_id ?? null, event: "step", line: `site_check(owners) on ${scope.label} by ${d.by}, approved by ${ok.by}: ${after.owner_or_decision_maker} owners or decision makers of ${after.people} · ${after.unreadable} unreadable · ${usd(cost)}.`, actor: d.by }).catch(() => undefined);
  return result;
}
