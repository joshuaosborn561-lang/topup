import type { IcpGate } from "../clients/icpGate.js";
import { jevModel } from "../clients/icpGate.js";
import { geminiModel, jevPickModel, type SitePeople } from "../clients/sitePeople.js";
import { createHash } from "node:crypto";
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
import { RpmLimiter } from "../lib/backoff.js";
import { DISCO_MODEL, fetchAll, gradeAll, LLM_RESULTS, peopleLoopConfig, SITE_TEXT, type PeopleLoopConfig } from "../stages/icp/loops.js";
import { icpLabelSql } from "../stages/icp/parse.js";
import { discoverStores } from "./leftovers.js";

/**
 * The website checker as a verb (D71, D72; skill icp-website-gate). Our
 * own site fetch (free), then a question over what the site says, on a
 * job's rows or a store that `leftovers` named:
 *
 *   icp     Is each company in the client's ICP? The client's label set
 *           from topup.icp_variants, Jev's category pick; the verdict is
 *           per domain in client_salesglider.icp_llm_results, where
 *           icp(job_id) reads it too, so a checked domain is never paid
 *           for twice.
 *   people  Who on the site is what we are looking for? The site-people
 *           function crawls the homepage and the people pages (team,
 *           leadership, staff, about, contact), Gemini (Josh's key) lists
 *           every person the site presents into topup.site_people, and
 *           Jev picks which of them is `looking_for` (default: the owner,
 *           or the person who runs the company) into topup.site_answers.
 *           The people found are rows of the view topup.site_people_found
 *           (first_name, last_name, title, domain, source_url) that a
 *           table pull can bring into a job.
 *
 * The first call returns the estimate and the counts so far; the same
 * call with approved_by runs it and records who said yes (D51). Nothing
 * on the store's rows changes. Sites, people and answers are kept per
 * domain, so a re-run pays only for what is new. A container restart
 * does not resume this (D5); Topup calls the same verb again. Counts,
 * labels and at most ten sample domains; never a name.
 */
export const SITE_CHECK_QUESTIONS = ["icp", "people"] as const;
export type SiteCheckQuestion = (typeof SITE_CHECK_QUESTIONS)[number];

/** What the people question looks for when the caller does not say. */
export const DEFAULT_LOOKING_FOR = "the owner, or the person who runs the company";
export const PEOPLE_TEXT = "topup.site_people_text";
export const PEOPLE_TABLE = "topup.site_people";
export const ANSWERS = "topup.site_answers";
export const FOUND_VIEW = "topup.site_people_found";
export const LABEL_TOKEN = /^[a-z][a-z0-9_]{2,80}$/;
const SAMPLE_FLAGGED = 10;
const SAMPLE_PASSED = 4;
const SAMPLE_FOUND = 10;
const TITLES_SHOWN = 10;

export const SITE_CHECK_RULE =
  "The website checker: our own site fetch (free), then a question over what the site says (D71, D72). " +
  "question=icp grades each company against the client's label set (Jev, about $0.11 per 1,000). " +
  "question=people crawls the site's people pages, has Gemini list every person it presents, and asks Jev which of them is looking_for (about $1.11 per 1,000 sites worst case); the people found are rows of topup.site_people_found. " +
  "The first call is the estimate; approved_by=\"Name\" runs it. Sites, people and answers are kept per domain, so a re-run pays only for what is new. A deploy does not resume the loop — call the same verb again (D5, D73). Nothing on the rows changes; you read the counts and decide (D53).";

export interface SiteCheckDeps {
  db: Queryable;
  repo: Pick<Repo, "getRun" | "openCardsForRun" | "openCards" | "spentTodayCents" | "updateCardPayload" | "setCardBlocks">;
  console: Pick<Console, "ask" | "resolveAs">;
  rails: Pick<SpendRails, "decide" | "record" | "cfg">;
  ledger?: Pick<LaneLedger, "event"> | null;
  gate: IcpGate | null;
  people: SitePeople | null;
  /** The OpenRouter model id Jev runs as (ICP_JEV_MODEL). */
  jevModel: string;
  /** The Gemini model that lists a site's people (SITE_PEOPLE_GEMINI_MODEL). */
  geminiModel: string;
  /** People-loop fan-out (D73). Missing: env defaults (~50 fetch, ~28 Gemini/Jev). */
  peopleLoops?: PeopleLoopConfig;
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
  looking_for?: string | null;
  approved_by?: string | null;
  fetch_parallel?: number | null;
  fetch_workers?: number | null;
  extract_parallel?: number | null;
  extract_workers?: number | null;
  ask_parallel?: number | null;
  ask_workers?: number | null;
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
  looking_for?: string;
  question_key?: string;
  by_title?: Record<string, number>;
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

/** The question as the function stores it: whitespace collapsed, trimmed; the key is md5 of its lower case, the same expression Postgres uses. */
export function normalizeLookingFor(v: string | null | undefined): string {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t || DEFAULT_LOOKING_FOR;
}

export function questionKey(lookingFor: string): string {
  return createHash("md5").update(lookingFor.toLowerCase()).digest("hex");
}

export function siteCheckBatch(question: SiteCheckQuestion, seed: string): string {
  return `check_${question}_${seed.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}

/** Worst case for n sites: the ICP question adds the DiscoLike fallback on the unreadable tenth; the people question is Gemini on every site plus Jev on every site. */
export function siteCheckWorstCaseCents(question: SiteCheckQuestion, n: number): number {
  return question === "icp" ? icpWorstCaseCents(n) : worstCaseCents("gemini", "extract", n) + worstCaseCents("jev", "grade", n);
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
  const payload = { step: "site_check", question, client_tag: scope.clientTag, scope: scope.label, vendor: question === "icp" ? "jev+discolike" : "gemini+jev", action: question === "icp" ? "icp_gate" : "people", rows, worst_case_cents: worst };
  const blocks = (cardId: string) =>
    spendApprovalCard({ cardId, runId: scope.run?.run_id ?? scope.label, clientTag: scope.clientTag, step: "icp", vendor: question === "icp" ? "jev + discolike" : "gemini + jev", action: `site_check ${question}`, rows, worstCaseCents: worst, projectedUseful: null, spentTodayCents: spentToday, dailyCapCents: d.rails.cfg.dailyCapCents });
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
  domains: number;
  found: number;
  nobody_listed: number;
  unreadable: number;
  unchecked: number;
}

/** Per domain: found (Jev picked someone), nobody_listed (asked, nobody fits), unreadable (fetched, no text), unchecked. Counts only. */
async function peopleTally(d: SiteCheckDeps, scope: Scope, dsql: string, lookingFor: string): Promise<PeopleTally> {
  const n = scope.params.length;
  const { rows } = await d.db.query<{ k: string; n: string }>(
    `select case when a.domain is not null and a.person_key is not null then 'found'
                 when a.domain is not null then 'nobody_listed'
                 when t.http_status is not null and not (t.http_status between 200 and 399 and coalesce(t.chars, 0) > 300) then 'unreadable'
                 else 'unchecked' end as k, count(*)::text as n
       from ${domainsSql(scope, dsql)} d
       left join ${ANSWERS} a on a.domain = d.d and a.question_key = md5(lower($${n + 1})) and a.error is null
       left join ${PEOPLE_TEXT} t on t.domain = d.d
      group by 1`,
    [...scope.params, lookingFor],
  );
  const t: PeopleTally = { domains: 0, found: 0, nobody_listed: 0, unreadable: 0, unchecked: 0 };
  for (const r of rows) {
    const c = Number(r.n);
    t.domains += c;
    if (r.k === "found") t.found += c;
    else if (r.k === "nobody_listed") t.nobody_listed += c;
    else if (r.k === "unreadable") t.unreadable += c;
    else t.unchecked += c;
  }
  return t;
}

/** The titles the people found carry, as counts (top ten); and up to ten found domains with that title. Titles and domains, never names. */
async function peopleTitles(d: SiteCheckDeps, scope: Scope, dsql: string, lookingFor: string): Promise<{ by_title: Record<string, number>; samples: string[] }> {
  const n = scope.params.length;
  const join = `from ${domainsSql(scope, dsql)} d
       join ${ANSWERS} a on a.domain = d.d and a.question_key = md5(lower($${n + 1})) and a.person_key is not null and a.error is null
       join ${PEOPLE_TABLE} p on p.domain = a.domain and p.person_key = a.person_key`;
  try {
    const { rows } = await d.db.query<{ title: string | null; n: string }>(`select lower(coalesce(nullif(btrim(p.title), ''), 'no title given')) as title, count(*)::text as n ${join} group by 1 order by 2 desc, 1 limit ${TITLES_SHOWN}`, [...scope.params, lookingFor]);
    const { rows: sample } = await d.db.query<{ d: string; title: string | null }>(`select d.d, p.title ${join} order by d.d limit ${SAMPLE_FOUND}`, [...scope.params, lookingFor]);
    return { by_title: Object.fromEntries(rows.map((r) => [r.title ?? "no title given", Number(r.n)])), samples: sample.map((r) => `${r.d} (${r.title ?? "no title given"})`) };
  } catch {
    return { by_title: {}, samples: [] };
  }
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
  const seed = scope.run?.run_id ?? createHash("md5").update(scope.label).digest("hex");
  const batch = siteCheckBatch(input.question, seed);
  const spentToday = await d.repo.spentTodayCents();

  if (input.question === "icp") {
    const variant = await variantFor(d.db, scope.clientTag);
    if (!variant) return { ...out, status: "refused", reason: `no ICP label set for ${scope.clientTag}: write it per skills/icp-website-gate (JEV_Q and PASS in icp-llm, then a row in topup.icp_variants). Ask Josh.` };
    const model = jevModel(d.jevModel, variant.jev_variant);
    const before = await icpTally(d, scope, dsql, model);
    const toCheck = before.unchecked + (variant.disco_icp ? before.unreadable : 0);
    const counts = (t: IcpTally): SiteCheckCounts => ({ domains: t.domains, checked_yes: t.checked_yes, checked_no: t.checked_no, unreadable: t.unreadable, unchecked: t.unchecked });
    const tail = { batch, model };
    if (toCheck === 0) return { ...out, ...tail, status: "nothing", to_check: 0, counts: counts(before), by_label: before.by_label, samples: await icpSamples(d, scope, dsql, model), next: before.domains === 0 ? "no domains in scope" : "every domain in scope has a verdict; read the counts" };
    const worst = siteCheckWorstCaseCents("icp", toCheck);
    const ok = await approval(d, scope, "icp", toCheck, worst, input.approved_by ?? null, spentToday);
    if (!ok.ok) return { ...out, ...tail, status: "waiting_approval", to_check: toCheck, worst_case_cents: worst, card_id: ok.card.card_id, counts: counts(before), by_label: before.by_label, next: `name the worst case ${usd(worst)} to a person, then site_check(question="icp", ${scope.kind === "job" ? `job_id="${scope.run!.run_id}"` : `client_tag="${scope.clientTag}", table="${scope.rel.replace(/"/g, "")}"`}, approved_by="Their name"). A deploy does not resume this.` };
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

  // people
  if (!d.people) return { ...out, status: "refused", reason: "the site-people function is not configured on this service (SITE_PEOPLE_KEY). Ask Josh." };
  const lookingFor = normalizeLookingFor(input.looking_for);
  const qkey = questionKey(lookingFor);
  const gModel = geminiModel(d.geminiModel);
  const jModel = jevPickModel(d.jevModel);
  const before = await peopleTally(d, scope, dsql, lookingFor);
  const counts = (t: PeopleTally): SiteCheckCounts => ({ domains: t.domains, found: t.found, nobody_listed: t.nobody_listed, unreadable: t.unreadable, unchecked: t.unchecked });
  const tail = { batch, model: `${gModel} then ${jModel}`, looking_for: lookingFor, question_key: qkey };
  const pullHint = `the people found are rows of ${FOUND_VIEW} (first_name, last_name, title, domain, source_url); pull(client_tag, campaign_id, source="table", filters={"table":"${FOUND_VIEW}","where":"question_key = '${qkey}'"}, max_rows) brings them into a job`;
  if (before.unchecked === 0) {
    const titles = await peopleTitles(d, scope, dsql, lookingFor);
    return { ...out, ...tail, status: "nothing", to_check: 0, counts: counts(before), by_title: titles.by_title, samples: { flagged: [], passed: titles.samples }, next: before.domains === 0 ? "no domains in scope" : `every site in scope has an answer for "${lookingFor}"; ${pullHint}` };
  }
  const worst = siteCheckWorstCaseCents("people", before.unchecked);
  const ok = await approval(d, scope, "people", before.unchecked, worst, input.approved_by ?? null, spentToday);
  const resume = `site_check(question="people", ${scope.kind === "job" ? `job_id="${scope.run!.run_id}"` : `client_tag="${scope.clientTag}", table="${scope.rel.replace(/"/g, "")}"`}${input.looking_for ? `, looking_for="${lookingFor}"` : ""}, approved_by="Their name")`;
  if (!ok.ok) return { ...out, ...tail, status: "waiting_approval", to_check: before.unchecked, worst_case_cents: worst, card_id: ok.card.card_id, counts: counts(before), next: `name the worst case ${usd(worst)} to a person, then ${resume}. A deploy does not resume this — nothing starts on boot (D5).` };
  const decision = d.rails.decide({ runId: scope.run?.run_id ?? "canon", clientTag: scope.clientTag, step: "icp", vendor: "gemini", action: "extract", rows: before.unchecked, recipeAuthorised: true, approvedCents: ok.approvedCents, worstCaseCents: worst }, spentToday);
  if (decision.kind !== "proceed") return { ...out, ...tail, status: "refused", reason: decision.reason, worst_case_cents: worst, counts: counts(before) };
  const n = scope.params.length;
  const loops = peopleLoopConfig(process.env, {
    fetch_parallel: input.fetch_parallel ?? d.peopleLoops?.fetch.parallel,
    fetch_workers: input.fetch_workers ?? d.peopleLoops?.fetch.workers,
    fetch_per_call: d.peopleLoops?.fetch.perCall,
    extract_parallel: input.extract_parallel ?? d.peopleLoops?.extract.parallel,
    extract_workers: input.extract_workers ?? d.peopleLoops?.extract.workers,
    extract_per_call: d.peopleLoops?.extract.perCall,
    ask_parallel: input.ask_parallel ?? d.peopleLoops?.ask.parallel,
    ask_workers: input.ask_workers ?? d.peopleLoops?.ask.workers,
    ask_per_call: d.peopleLoops?.ask.perCall,
    per_host: d.peopleLoops?.perHost,
    gemini_rpm: d.peopleLoops?.geminiRpm,
  });
  // Dead claims from a killed container: http_status=-1 and in_progress extracts older than 2 min.
  await d.db.query(`update ${PEOPLE_TEXT} set http_status = null where http_status = -1 and fetched_at < now() - interval '2 minutes'`).catch(() => undefined);
  await d.db.query(`update topup.site_extractions set error = 'released' where error = 'in_progress' and extracted_at < now() - interval '3 minutes'`).catch(() => undefined);
  // 1. Sites without an answer join the batch. Already-extracted / already-answered domains are not re-paid (extract and ask skip those tables). A fetched site keeps its text and is re-pointed so ask can see it after a restart.
  await d.db.query(
    `insert into ${PEOPLE_TEXT} (domain, batch)
     select d.d, $${n + 1} from ${domainsSql(scope, dsql)} d
      where not exists (select 1 from ${ANSWERS} a where a.domain = d.d and a.question_key = md5(lower($${n + 2})) and a.error is null)
     on conflict (domain) do update set batch = excluded.batch where ${PEOPLE_TEXT}.http_status is distinct from -1`,
    [...scope.params, batch, lookingFor],
  );
  // 2. Fetch (free, ~50 workers, 2 per host). 3. Gemini lists. 4. Jev picks. Fan-out; each call claims rows.
  const fetched = await fetchAll(d.people, batch, loops.fetch);
  let extracted = 0;
  const geminiLim = new RpmLimiter(loops.geminiRpm);
  const ex = await gradeAll(async (per, w) => {
    for (let i = 0; i < w; i++) await geminiLim.take();
    const r = await d.people!.extract(batch, gModel, per, w);
    extracted += r.people;
    return r;
  }, loops.extract);
  await d.rails.record({ runId: scope.run?.run_id ?? null, clientTag: scope.clientTag, step: "site_check", vendor: "gemini", action: "extract", rows: ex.graded, credits: ex.graded, worstCaseCents: worst, balanceBefore: null, balanceAfter: null, vendorJobId: batch, approvedBy: ok.by });
  const asked = await gradeAll((per, w) => d.people!.ask(batch, lookingFor, jModel, per, w), loops.ask);
  const jevCost = await costCents(d.db, `select coalesce(sum(cost), 0)::text as usd from ${ANSWERS} where domain in (select domain from ${PEOPLE_TEXT} where batch = $1) and question_key = md5(lower($2))`, [batch, lookingFor]);
  await d.rails.record({ runId: scope.run?.run_id ?? null, clientTag: scope.clientTag, step: "site_check", vendor: "jev", action: "grade", rows: asked.graded, credits: asked.graded, worstCaseCents: null, balanceBefore: null, balanceAfter: null, vendorJobId: batch, approvedBy: ok.by });
  const after = await peopleTally(d, scope, dsql, lookingFor);
  const titles = await peopleTitles(d, scope, dsql, lookingFor);
  const cost = worstCaseCents("gemini", "extract", ex.graded) + jevCost;
  const lastError = ex.last_error ?? asked.last_error;
  const result: SiteCheckResult = {
    ...out,
    ...tail,
    status: "done",
    approved_by: ok.by,
    to_check: before.unchecked,
    worst_case_cents: worst,
    counts: { ...counts(after), fetched: fetched.fetched, fetched_ok: fetched.fetched_ok, extracted_sites: ex.graded, people_listed: extracted, asked: asked.graded, errors: ex.errors + asked.errors, newly_found: after.found - before.found },
    by_title: titles.by_title,
    samples: { flagged: [], passed: titles.samples },
    cost_cents: cost,
    next: `${after.found} sites name someone who is "${lookingFor}"; ${pullHint}. nobody_listed means the site shows no one who fits; unreadable means our fetch could not read the site.`,
    ...(lastError ? { reason: `last model error: ${lastError.slice(0, 120)}` } : {}),
  };
  await d.ledger?.event({ client_tag: scope.clientTag, lane: scope.run?.lane ?? "site_check", run_id: scope.run?.run_id ?? null, event: "step", line: `site_check(people, "${lookingFor.slice(0, 60)}") on ${scope.label} by ${d.by}, approved by ${ok.by}: found ${after.found} · nobody ${after.nobody_listed} · unreadable ${after.unreadable} of ${after.domains} · ${usd(cost)}.`, actor: d.by }).catch(() => undefined);
  return result;
}
