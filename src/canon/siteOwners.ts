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
 * D94 (qualifies D93) — a job-scoped owner count and pull. site_check
 * answers are cached per domain. This read joins only this job's ingest
 * rows (run_id) to site_answers / site_people when the owner domain or
 * place_id belongs to those rows. Owners cached by an earlier check on
 * this job's businesses belong to the job. The site_people_text batch is
 * not the attach key. It never SELECTs the shared view or a client
 * owner_* table. Counts only; a name never returns.
 */
export const SITE_OWNERS_SOURCE = "site_owners" as const;

export const SITE_OWNERS_RULE =
  "Job-scoped owner count and pull (D94): count(source=\"site_owners\", job_id) is the dry-run; " +
  "pull(job_id, source=\"site_owners\") attaches. Scope is this job's ingest rows by place_id or " +
  "normalized domain. Owners cached by an earlier site_check on those businesses belong to the job. " +
  "An owner whose domain or place is not on this job does not attach. It never reads topup.site_people_found " +
  "or a client owner table, and never another job or client. Free. Pass job_id; it never opens a new job. Ask Josh or Cayden.";

const IDENT = /^[a-z][a-z0-9_]*$/;

/** Shared or cross-client owner stores a table pull must never read (D93, D94). */
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
    `Never read the shared owner table ${table} across clients (D94). ` +
    `count(source="${SITE_OWNERS_SOURCE}", job_id) and pull(job_id, source="${SITE_OWNERS_SOURCE}") ` +
    `scope this job's places (place_id or normalized domain). Ask Josh or Cayden.`
  );
}

export function siteOwnersNeedJobId(): string {
  return (
    `source="${SITE_OWNERS_SOURCE}" needs an existing job_id. ` +
    `It never opens a job from a shared owner table (D94). Ask Josh or Cayden.`
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
  job_places: number;
  found_on_job: number;
  cached_other_batch: number;
  already_named: number;
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
 * job's ingest rows to site_answers / site_people when the owner domain
 * or place_id belongs to those rows. Never FROM site_people_found. The
 * site_people_text batch is not the attach filter (D94).
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
    job_places: 0,
    found_on_job: 0,
    cached_other_batch: 0,
    already_named: 0,
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
  const destCols = await columnsOf(d.db, ingestSchema, ingestTable);
  for (const col of ["first_name", "last_name", "title", "run_id"]) {
    if (!destCols.has(col)) {
      return { ...base, status: "refused", reason: `${ingest} has no ${col} column`, next: "Ask Josh or Cayden.", counts: empty };
    }
  }
  const dsql = storeDomainSql(destCols, "i.");
  if (!dsql) {
    return { ...base, status: "refused", reason: `${ingest} has no domain or email column`, next: "Ask Josh or Cayden.", counts: empty };
  }

  const hasMaps = await relationExists(d.db, mapsSchema, "maps_raw");
  const mapsCols = hasMaps ? await columnsOf(d.db, mapsSchema, "maps_raw") : new Set<string>();
  const mapsHasPlace = mapsCols.has("place_id");
  const mapsHasEmail = mapsCols.has("email");
  const mapsHasDomain = mapsCols.has("domain");
  const canPlace = hasMaps && mapsHasPlace && (mapsHasEmail || mapsHasDomain);

  const mapsRef = `"${mapsSchema}"."maps_raw"`;
  const emailPlace = canPlace && mapsHasEmail
    ? `email_place as (
         select distinct on (lower(email)) lower(email) as email, place_id
           from ${mapsRef}
          where place_id is not null and email is not null
          order by lower(email), place_id
       )`
    : `email_place as (select null::text as email, null::text as place_id where false)`;
  const domainPlace = canPlace && mapsHasDomain
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
  const placeHosts = canPlace && mapsHasDomain
    ? `place_hosts as (
         select distinct m.place_id, ${mapsDomainSql("m")} as dom
           from ${mapsRef} m
          where m.place_id is not null
       )`
    : `place_hosts as (select null::text as place_id, null::text as dom where false)`;

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
         ${emailPlace},
         ${domainPlace},
         ${placeHosts},
         placed as (
           select j.id, j.domain, j.email, j.named,
                  coalesce(e.place_id, d.place_id) as place_id
             from job j
             left join email_place e on e.email = j.email
             left join domain_place d on d.dom = j.domain
         ),
         found as (
           select distinct on (p.id)
                  p.id, p.domain, p.place_id, p.named
             from placed p
             join ${ANSWERS} a
               on a.question_key = md5(lower((select looking_for from looking)))
              and a.person_key is not null
              and a.error is null
              and (
                (p.domain is not null and a.domain = p.domain)
                or (p.place_id is not null and exists (
                  select 1 from place_hosts h
                   where h.place_id = p.place_id and h.dom = a.domain
                ))
              )
             join ${PEOPLE_TABLE} sp
               on sp.domain = a.domain and sp.person_key = a.person_key
            where p.domain is not null or p.place_id is not null
            order by p.id, (a.domain = p.domain) desc nulls last
         )`;

  const { rows: tally } = await d.db.query<{
    job_rows: string;
    job_domains: string;
    job_places: string;
    found_on_job: string;
    cached_other_batch: string;
    already_named: string;
    attachable: string;
  }>(
    `${scoped}
     select
       (select count(*)::text from job) as job_rows,
       (select count(distinct domain)::text from job where domain is not null) as job_domains,
       (select count(distinct place_id)::text from placed where place_id is not null) as job_places,
       (select count(*)::text from found) as found_on_job,
       (select count(*)::text from found f
         where f.domain is not null
           and not exists (
             select 1 from ${PEOPLE_TEXT} t
              where t.batch = (select batch from looking)
                and ${hostSql("t.domain")} = f.domain
           )
       ) as cached_other_batch,
       (select count(*)::text from found where named) as already_named,
       (select count(*)::text from found where not named) as attachable`,
    [run.run_id, lookingFor, batch],
  );
  const t = tally[0];
  const counts: SiteOwnersCounts = {
    job_rows: Number(t?.job_rows ?? 0),
    job_domains: Number(t?.job_domains ?? 0),
    job_places: Number(t?.job_places ?? 0),
    found_on_job: Number(t?.found_on_job ?? 0),
    cached_other_batch: Number(t?.cached_other_batch ?? 0),
    already_named: Number(t?.already_named ?? 0),
    attached: 0,
  };
  const attachable = Number(t?.attachable ?? 0);
  if (counts.job_rows === 0) {
    return { ...base, status: "nothing", reason: "this job has no ingest rows", next: "pull the campaign first", counts };
  }
  const nextCount =
    attachable > 0
      ? `pull(job_id, source="${SITE_OWNERS_SOURCE}") would attach ${attachable} owners on this job's places (place_id or normalized domain). It does not abort the job.`
      : counts.found_on_job > 0
        ? `every owner on this job's places is already named; ${counts.found_on_job} found, ${counts.already_named} already named`
        : `no site_check owner on this job's places for "${lookingFor}"; site_check(question="people", job_id) first`;
  if (!apply) {
    return {
      ...base,
      status: attachable > 0 || counts.found_on_job > 0 ? "done" : "nothing",
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
             on a.question_key = md5(lower((select looking_for from looking)))
            and a.person_key is not null
            and a.error is null
            and (
              (f.domain is not null and a.domain = f.domain)
              or (f.place_id is not null and exists (
                select 1 from place_hosts h
                 where h.place_id = f.place_id and h.dom = a.domain
              ))
            )
           join ${PEOPLE_TABLE} sp
             on sp.domain = a.domain and sp.person_key = a.person_key
          where i.id = f.id
            and i.run_id = $1
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
