import { clientSchema } from "./mapsPool.js";
import {
  ANSWERS,
  DEFAULT_LOOKING_FOR,
  FOUND_VIEW,
  normalizeLookingFor,
  PEOPLE_TABLE,
  PEOPLE_TEXT,
  questionKey,
  siteCheckBatch,
  storeDomainSql,
} from "./siteCheck.js";
import { ingestedTable, type Queryable } from "../db/pool.js";
import type { Repo } from "../db/repo.js";

/**
 * D93 — a job-scoped owner count and pull. site_check("people") writes
 * text under a batch named from the job id, and answers per domain.
 * Those answer tables are shared. This read joins only this job's ingest
 * rows to this job's batch, then to site_answers / site_people for those
 * domains, keyed by place_id on maps_raw. It never SELECTs the shared
 * view or a client owner_* table. Counts only; a name never returns.
 */
export const SITE_OWNERS_SOURCE = "site_owners" as const;

export const SITE_OWNERS_RULE =
  "Job-scoped owner count and pull (D93): count(source=\"site_owners\", job_id) is the dry-run; " +
  "pull(job_id, source=\"site_owners\") attaches. Scope is this job's ingest rows and this job's " +
  "site_check batch on topup.site_people_text, keyed by job_id, batch and place_id. It never reads topup.site_people_found " +
  "or a client owner table. Free. Pass job_id; it never opens a new job. Ask Josh or Cayden.";

const IDENT = /^[a-z][a-z0-9_]*$/;

/** Shared or cross-client owner stores a table pull must never read (D93). */
export function isSharedOwnerTable(table: string | null | undefined): boolean {
  if (!table) return false;
  const t = table.replace(/"/g, "").trim().toLowerCase();
  if (!t) return false;
  if (t === FOUND_VIEW || t === "topup.site_check_people") return true;
  const [schema, name, extra] = t.split(".");
  if (!schema || !name || extra) return t === "site_people_found";
  if (name === "site_people_found" || name === "site_check_people") return true;
  if (name.startsWith("owner_") || name.includes("_owner_")) return true;
  return false;
}

export function refuseSharedOwnerTable(table: string | null | undefined): string | null {
  if (!isSharedOwnerTable(table)) return null;
  return (
    `Never read the shared owner table ${table} across clients (D93). ` +
    `count(source="${SITE_OWNERS_SOURCE}", job_id) and pull(job_id, source="${SITE_OWNERS_SOURCE}") ` +
    `scope this job's batch only, keyed by job_id, batch and place_id. Ask Josh or Cayden.`
  );
}

export function siteOwnersNeedJobId(): string {
  return (
    `source="${SITE_OWNERS_SOURCE}" needs an existing job_id. ` +
    `It never opens a job from a shared owner table (D93). Ask Josh or Cayden.`
  );
}

export function siteOwnersBatch(jobId: string): string {
  return siteCheckBatch("people", jobId);
}

export interface SiteOwnersDb extends Queryable {
  withRun: <T>(runId: string, fn: (tx: Queryable) => Promise<T>) => Promise<T>;
}

export interface SiteOwnersInput {
  job_id: string;
  client_tag?: string | null;
  looking_for?: string | null;
  /** Default false: counts only. true writes first_name / last_name / title on this job's rows. */
  apply?: boolean;
}

export interface SiteOwnersCounts {
  job_rows: number;
  job_domains: number;
  batch_domains: number;
  found_in_batch: number;
  found_outside_batch: number;
  with_place: number;
  already_named: number;
  no_place: number;
  attached: number;
}

export interface SiteOwnersResult {
  job_id: string;
  source: typeof SITE_OWNERS_SOURCE;
  batch: string;
  status: "refused" | "nothing" | "done";
  reason?: string;
  next?: string;
  looking_for: string;
  question_key: string;
  apply: boolean;
  counts: SiteOwnersCounts;
  rule: string;
}

async function columnsOf(db: Queryable, schema: string, table: string): Promise<Set<string>> {
  const { rows } = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = $1 and table_name = $2`,
    [schema, table],
  );
  return new Set(rows.map((r) => r.column_name));
}

async function relationExists(db: Queryable, schema: string, table: string): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `select 1::text as n from information_schema.tables where table_schema = $1 and table_name = $2 limit 1`,
    [schema, table],
  );
  return rows.length > 0;
}

function mapsDomainSql(alias: string): string {
  if (!IDENT.test(alias)) throw new Error(`not an identifier: ${alias}`);
  const host = (expr: string) =>
    `split_part(split_part(regexp_replace(lower(btrim(${expr})), '^(https?://)?(www\\.)?', ''), '/', 1), ':', 1)`;
  return `nullif(${host(`${alias}.domain`)}, '')`;
}

function hostSql(expr: string): string {
  return `nullif(split_part(split_part(regexp_replace(lower(btrim(${expr})), '^(https?://)?(www\\.)?', ''), '/', 1), ':', 1), '')`;
}

/**
 * Count (and optionally attach) site_check owners for one job. Joins this
 * job's ingest rows to this job's site_people_text batch, then to
 * site_answers / site_people, then maps_raw for place_id. Never FROM
 * site_people_found.
 */
export async function attachSiteOwners(
  d: { db: SiteOwnersDb; repo: Pick<Repo, "getRun"> },
  input: SiteOwnersInput,
): Promise<SiteOwnersResult> {
  const lookingFor = normalizeLookingFor(input.looking_for);
  const qkey = questionKey(lookingFor);
  const apply = input.apply === true;
  const batch = siteOwnersBatch(input.job_id);
  const empty: SiteOwnersCounts = {
    job_rows: 0,
    job_domains: 0,
    batch_domains: 0,
    found_in_batch: 0,
    found_outside_batch: 0,
    with_place: 0,
    already_named: 0,
    no_place: 0,
    attached: 0,
  };
  const base = {
    job_id: input.job_id,
    source: SITE_OWNERS_SOURCE,
    batch,
    looking_for: lookingFor,
    question_key: qkey,
    apply,
    rule: SITE_OWNERS_RULE,
  };
  const run = await d.repo.getRun(input.job_id);
  if (!run) {
    return { ...base, status: "refused", reason: "no such job", next: "jobs() lists them", counts: empty };
  }
  if (input.client_tag && input.client_tag !== run.client_tag) {
    return {
      ...base,
      status: "refused",
      reason: `job ${input.job_id.slice(0, 8)} belongs to ${run.client_tag}, not ${input.client_tag}`,
      next: "leave client_tag out, or pass the job's",
      counts: empty,
    };
  }
  const ingest = ingestedTable(run.client_tag);
  const [ingestSchema, ingestTable] = ingest.split(".") as [string, string];
  const mapsSchema = clientSchema(run.client_tag);
  if (!(await relationExists(d.db, ingestSchema, ingestTable))) {
    return { ...base, status: "refused", reason: `${ingest} is missing`, next: "Ask Josh or Cayden.", counts: empty };
  }
  if (!(await relationExists(d.db, mapsSchema, "maps_raw"))) {
    return { ...base, status: "refused", reason: `${mapsSchema}.maps_raw is missing; place_id has nowhere to come from`, next: "Ask Josh or Cayden.", counts: empty };
  }
  const destCols = await columnsOf(d.db, ingestSchema, ingestTable);
  const mapsCols = await columnsOf(d.db, mapsSchema, "maps_raw");
  for (const col of ["first_name", "last_name", "title", "run_id"]) {
    if (!destCols.has(col)) {
      return { ...base, status: "refused", reason: `${ingest} has no ${col} column`, next: "Ask Josh or Cayden.", counts: empty };
    }
  }
  if (!mapsCols.has("place_id")) {
    return { ...base, status: "refused", reason: `${mapsSchema}.maps_raw has no place_id`, next: "Ask Josh or Cayden.", counts: empty };
  }
  const dsql = storeDomainSql(destCols, "i.");
  if (!dsql) {
    return { ...base, status: "refused", reason: `${ingest} has no domain or email column`, next: "Ask Josh or Cayden.", counts: empty };
  }
  const mapsHasEmail = mapsCols.has("email");
  const mapsHasDomain = mapsCols.has("domain");
  if (!mapsHasEmail && !mapsHasDomain) {
    return { ...base, status: "refused", reason: `${mapsSchema}.maps_raw has no email or domain to resolve place_id`, next: "Ask Josh or Cayden.", counts: empty };
  }

  const mapsRef = `"${mapsSchema}"."maps_raw"`;
  const emailPlace = mapsHasEmail
    ? `email_place as (
         select distinct on (lower(email)) lower(email) as email, place_id
           from ${mapsRef}
          where place_id is not null and email is not null
          order by lower(email), place_id
       )`
    : `email_place as (select null::text as email, null::text as place_id where false)`;
  const domainPlace = mapsHasDomain
    ? `domain_place as (
         select distinct on (dom) dom, place_id
           from (
             select place_id, ${mapsDomainSql("m")} as dom
               from ${mapsRef} m
              where place_id is not null
           ) x
          where dom is not null
          order by dom, place_id
       )`
    : `domain_place as (select null::text as dom, null::text as place_id where false)`;

  const scoped = `
    with looking as (select $2::text as looking_for, $3::text as batch),
         job as (
           select i.id,
                  ${dsql} as domain,
                  lower(i.email) as email,
                  (i.first_name is not null and btrim(i.first_name) <> '') as named
             from ${ingest} i
            where i.run_id = $1
         ),
         batch as (
           select ${hostSql("t.domain")} as host
             from ${PEOPLE_TEXT} t
            where t.batch = (select batch from looking)
         ),
         ${emailPlace},
         ${domainPlace},
         placed as (
           select j.id, j.domain, j.email, j.named,
                  coalesce(e.place_id, d.place_id) as place_id,
                  exists (select 1 from batch b where b.host = j.domain) as in_batch
             from job j
             left join email_place e on e.email = j.email
             left join domain_place d on d.dom = j.domain
         ),
         found as (
           select p.id, p.domain, p.place_id, p.named, p.in_batch
             from placed p
             join ${ANSWERS} a
               on a.domain = p.domain
              and a.question_key = md5(lower((select looking_for from looking)))
              and a.person_key is not null
              and a.error is null
             join ${PEOPLE_TABLE} sp
               on sp.domain = a.domain and sp.person_key = a.person_key
            where p.domain is not null
         )`;

  const { rows: tally } = await d.db.query<{
    job_rows: string;
    job_domains: string;
    batch_domains: string;
    found_in_batch: string;
    found_outside_batch: string;
    with_place: string;
    already_named: string;
    no_place: string;
    attachable: string;
  }>(
    `${scoped}
     select
       (select count(*)::text from job) as job_rows,
       (select count(distinct domain)::text from job where domain is not null) as job_domains,
       (select count(*)::text from batch) as batch_domains,
       (select count(*)::text from found where in_batch) as found_in_batch,
       (select count(*)::text from found where not in_batch) as found_outside_batch,
       (select count(*)::text from found where in_batch and place_id is not null) as with_place,
       (select count(*)::text from found where in_batch and named) as already_named,
       (select count(*)::text from found where in_batch and place_id is null) as no_place,
       (select count(*)::text from found where in_batch and place_id is not null and not named) as attachable`,
    [run.run_id, lookingFor, batch],
  );
  const t = tally[0];
  const counts: SiteOwnersCounts = {
    job_rows: Number(t?.job_rows ?? 0),
    job_domains: Number(t?.job_domains ?? 0),
    batch_domains: Number(t?.batch_domains ?? 0),
    found_in_batch: Number(t?.found_in_batch ?? 0),
    found_outside_batch: Number(t?.found_outside_batch ?? 0),
    with_place: Number(t?.with_place ?? 0),
    already_named: Number(t?.already_named ?? 0),
    no_place: Number(t?.no_place ?? 0),
    attached: 0,
  };
  const attachable = Number(t?.attachable ?? 0);
  if (counts.job_rows === 0) {
    return { ...base, status: "nothing", reason: "this job has no ingest rows", next: "pull the campaign first", counts };
  }
  const nextCount =
    attachable > 0
      ? `pull(job_id, source="${SITE_OWNERS_SOURCE}") would attach ${attachable} owners on this job's batch (job_id + batch + place_id). It does not abort the job.`
      : counts.found_in_batch > 0
        ? `every in-batch owner is already named or missing place_id; ${counts.found_in_batch} in batch, ${counts.already_named} already named, ${counts.no_place} with no place_id`
        : `no site_check owner on this job's batch for "${lookingFor}"; site_check(question="people", job_id) first`;
  if (!apply) {
    return {
      ...base,
      status: attachable > 0 || counts.found_in_batch > 0 ? "done" : "nothing",
      next: nextCount,
      counts,
    };
  }

  const written = await d.db.withRun(run.run_id, async (tx) => {
    const { rows } = await tx.query<{ n: string }>(
      `${scoped},
       upd as (
         update ${ingest} i
            set first_name = split_part(sp.full_name, ' ', 1),
                last_name = nullif(btrim(substr(sp.full_name, length(split_part(sp.full_name, ' ', 1)) + 1)), ''),
                title = case when i.title is null or btrim(i.title) = '' then sp.title else i.title end
           from found f
           join ${ANSWERS} a
             on a.domain = f.domain
            and a.question_key = md5(lower((select looking_for from looking)))
            and a.person_key is not null
            and a.error is null
           join ${PEOPLE_TABLE} sp
             on sp.domain = a.domain and sp.person_key = a.person_key
          where i.id = f.id
            and i.run_id = $1
            and f.in_batch
            and f.place_id is not null
            and not f.named
          returning 1
       )
       select count(*)::text as n from upd`,
      [run.run_id, lookingFor, batch],
    );
    return Number(rows[0]?.n ?? 0);
  });
  counts.attached = written;
  return {
    ...base,
    status: written > 0 ? "done" : "nothing",
    next: written > 0 ? "enrich(job_id) finds emails for the attached owners; the job's other steps are unchanged" : "nothing to attach",
    counts,
  };
}

/** Dry-run. Same as attachSiteOwners with apply=false. */
export function countSiteOwners(
  d: { db: SiteOwnersDb; repo: Pick<Repo, "getRun"> },
  input: Omit<SiteOwnersInput, "apply">,
): Promise<SiteOwnersResult> {
  return attachSiteOwners(d, { ...input, apply: false });
}
