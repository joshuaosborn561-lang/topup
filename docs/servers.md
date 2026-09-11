# The servers, from their code

What each vendor server actually exposes, read from its repository (and, for
the one server with no repository on GitHub, from its live tool schema and
zero-cost probes). Written so `leadtopup` can call these servers without a
human rediscovering them in chat, and so Josh can see what is broken before
anything is built on it. Decision D22.

Every claim below cites a file (path:line at the commit named in the
section). Where the code and a README disagree, the code is quoted and the
README is called out. Nothing here is inferred from tool descriptions alone
except where the section says so.

> Reviewed by: _pending — Josh reviews this document before the service
> builds on any server in it._

## How to read a section

| Heading | Meaning |
|---|---|
| Identity | repo, branch/commit, runtime, how Railway runs it, the live URL |
| Tools | every tool, real arguments, sync or job id, what it returns |
| Jobs | status values, how to poll, what finished / failed / stalled look like, cancel, restart survival |
| Rows | table-source and writeback modes that keep rows out of the caller; the largest thing any tool can return |
| Prices | every unit price in code and how cost is reported |
| Breakage | the brief's four (no cancel, zero-dollar accounting, status errors on completed jobs, row-count truncation) confirmed or refuted, plus anything else that bites a programmatic caller |
| Prerequisite PRs | what must land on that server before `leadtopup` depends on the affected path |

## What runs where (Railway, 2026-09-11)

Read from the Railway API with the project token. `repo=github` means Railway
deploys from a GitHub branch; `repo=CLI` means the code was uploaded with
`railway up` from someone's machine, so **the deployed code cannot be tied to
a commit**. That is itself a finding: six of the ten servers are CLI deploys.

| Server (brief name) | Railway project / service | Source | Last deploy | Status |
|---|---|---|---|---|
| LeadPipe | `leadpipe` / `leadpipe` — `leadpipe-production-0df5.up.railway.app` | CLI; **no repository under joshuaosborn561-lang** | 2026-09-09 | SUCCESS |
| Google Maps Scraper | `google maps scraper` / `google-maps-mcp` — `google-maps-mcp-production-88a3.up.railway.app`; `google-maps-scraper` — `…-41db.up.railway.app` | CLI; repo `googlemaps-scraper` main is 2026-09-08, deploys are 2026-08-13 / 08-09 | 2026-08-13 | SUCCESS |
| PermitStack | `permitstack-mcp` / `permitstack-mcp` — `permitstack-mcp-production.up.railway.app` | CLI; repo `permitstack-mcp` **main is empty**, code is on `cursor/permitstack-full-mcp-70d0` | 2026-09-10 | SUCCESS |
| Property Owners | `permit and parcel mcp` / `permit and parcel mcp` — `workspace-production-4702.up.railway.app` | github `permits-GCs` main @ 4e038a7 | 2026-09-10 | SUCCESS |
| Domain Waterfall | `domain-waterfall` / `domain-waterfall` — `domain-waterfall-production.up.railway.app` | CLI; timing matches `cursor/domain-waterfall-7990` @ df53a19, **not main** | 2026-09-09 18:26Z | SUCCESS |
| Find Named Person | `people-waterfall` / `people-waterfall` — `people-waterfall-production.up.railway.app` | CLI; repo `find-named-person-waterfall` **main is empty**, code is on `cursor/people-waterfall-mcp-dbc8` | 2026-09-09 | SUCCESS |
| Email Finder Waterfall | `email-waterfall` / `email-waterfall` — `email-waterfall-production-021b.up.railway.app` | github `email-waterfall` main @ 9d93be4 | 2026-09-09 | SUCCESS |
| Name to Email | `name-to-email` / `finder` — `finder-production-e298.up.railway.app` (+ its own Postgres) | CLI; repo `name-to-email` main @ 64223dd (2026-08-23) | 2026-08-24 | SUCCESS |
| Email Verifier Progression | `email-verification-waterfall` / `verifyfall` — `verifyfall-production.up.railway.app` (+ `millionverifier-mcp`, `csv-host`) | CLI; repo `email-verifier-progression` main @ 165b527 | 2026-09-09 16:48Z | **FAILED** |
| Smartlead server | `smartlead mcp server` / `smartlead-mcp` — `workspace-production-9629.up.railway.app` | CLI; repo `smartleadmcp` **main is empty**, code is on `cursor/lead-purge-job-4596` (deploy is 2 s after that commit) | 2026-08-25 | SUCCESS |

Two things to fix before anything else, both outside this repo:

1. **LeadPipe has no repository on GitHub.** GitHub code search across the
   account for `lp_inventory`, `lp_export`, `leadpipe` and `ingested_leads`
   returns nothing; the Railway service is a CLI upload. The LeadPipe section
   below is therefore from the live tool schema and zero-cost probes only.
   Prerequisite: push the LeadPipe source to `joshuaosborn561-lang/leadpipe`
   and switch the Railway service to deploy from it.
2. **Three repos have an empty `main`** (a single file named `new`) with the
   real code on an unmerged `cursor/*` branch: `permitstack-mcp`,
   `find-named-person-waterfall`, `smartleadmcp`. Anyone reading `main` sees
   nothing. Prerequisite: merge the branch to `main` (or make it the default
   branch) and deploy from GitHub.

---

## 1. LeadPipe

### Identity

No repository under the GitHub account (see above). Live at
`leadpipe-production-0df5.up.railway.app`, last CLI deploy 2026-09-09. The
service reaches it as an MCP server over HTTP with a bearer token
(`LEADPIPE_MCP_URL`, `LEADPIPE_TOKEN` in `leadtopup`). Everything in this
section is from the live `tools/list` schema and the three zero-cost probes
recorded on 2026-09-11 (`lp_list_clients`, `lp_inventory peterson`,
`lp_status <unknown id>`, `lp_plan peterson "ingest csv"`).

### Tools

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `lp_ensure_client` | **client_tag** (snake_case), display_name | sync | creates `client_<tag>` schema (leads/companies/contacts), registers in `lp.clients`, exposes to PostgREST, ensures `lp.<tag>_ingested_leads`; idempotent; also runs on every `lp_run` |
| `lp_list_clients` | — | sync | `{clients:[{client_tag, created_at, schema_name, display_name}], n}` — 13 tags on 2026-09-11 (basco, bcp, goliath, infonaligy, insight, insight_oem, parlay, peterson, salesglider, techevo, techevo_city, techevo_fx, techevo_trim) |
| `lp_inventory` | **client_tag**, scope | sync | counts only: `companies, contacts, with_email, dm_grade, suppressed, ingested_leads, by_source_tier{getleads, ingested, leadmagic, waterfall, fullenrich, maps_owner}, gaps{missing_email, dm_missing_email, unresolved_companies}, notes[]` |
| `lp_plan` | **client_tag**, **goal** (free text), filters | sync, always $0 | `{candidate_count, estimated_cost_usd: 0, breakdown, recommended_kind, notes[]}` |
| `lp_run` | **job_kind** ∈ backfill \| ingest_serp \| ingest_csv \| sync_smartlead \| import_smartlead \| build_suppression, **client_tag**, params, approve_cost_usd (unused, always $0), force | **job id** | `job_id + status`. Idempotent on params hash unless `force=true`. **Zero source rows → the job fails**, it does not return an empty success. |
| `lp_status` | **job_id** | sync poll | "counts, pct, ETA, useful_output_count, cost" (schema text); never rows |
| `lp_sample` | **client_tag**, filter, n, table ∈ contacts \| companies \| ingested_leads | sync | ≤ 10 rows, hard cap in the tool |
| `lp_export` | **client_tag**, table ∈ contacts \| ingested_leads (default contacts), format ∈ csv \| jsonl, columns[], where{} (equality), filter_sql ("AND-chained equalities only"), filter (LeadFilter) | sync | `signed_url + row_count`, never content. Live columns read from `information_schema`. |

`lp_run` params by kind (from the tool description, not code):
`ingest_csv: {urls[], source_label, column_map?, dedupe_key?,
exclude_name_patterns?, exclude_domain_list?}`; `ingest_serp:
{storage_paths | apify_run_ids, target_titles, persona}`; `backfill: {source:
'gc'|'basco'|'peterson'|…}`.

### Jobs

- Poll `lp_status(job_id)`. Status vocabulary is **not in the schema** and
  the source is unavailable; treat any status other than a documented
  terminal one as running and confirm the vocabulary on the first real job.
- Unknown job id: `{ok:false, code:"not_found", error:"Job not found: …",
  hint:"Schema/table missing or not exposed to PostgREST."}` — the `hint`
  is misleading for a plain miss; a caller must key on `code`, not `hint`.
- **No cancel tool exists** in the schema. Confirmed from `tools/list`.
- Restart survival, heartbeat, stall detection: unknown without the source.

### Rows

- `lp_export` is the only export and returns a signed URL plus `row_count`;
  `leadtopup` already asserts the downloaded row count equals `row_count`
  (verify stage).
- `lp_sample` is capped at ten rows in the tool itself.
- `lp_inventory`, `lp_plan`, `lp_status`, `lp_list_clients` are counts only.

### Prices

Pass-through only; every job is $0 by design ("No enrichment. No paid vendor
lookups."). `approve_cost_usd` is accepted and ignored.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed** (no such tool). |
| Zero-dollar accounting | Not applicable — LeadPipe spends nothing. |
| Status errors on completed jobs | Cannot confirm without source. Unknown-id response shape recorded above. |
| Row-count truncation | Cannot confirm without source. `lp_export` returns `row_count`; `leadtopup` asserts against it and refuses a mismatch, which bounds the damage. |
| Other | `lp_status` `hint` text is wrong for a not-found job; write to `lp.<tag>_ingested_leads` is done by LeadPipe outside any `leadtopup` run, which is why the INSERT path on that table is deliberately unguarded by the write lock (0002). |

### Prerequisite PRs (LeadPipe)

1. Push the source to GitHub and deploy from it (blocks every other line here).
2. Add a cancel/abort for `ingest_*` and `backfill` jobs, or document that a
   job cannot be stopped so `leadtopup` bounds batch size accordingly.
3. Publish the `lp_status` status vocabulary and a `finished_at` / last-progress
   timestamp so a stall can be told from slow work.

---

## 2. Google Maps Scraper

### Identity

Repo `googlemaps-scraper`, `main` @ c570e90 (2026-09-08). Python; FastMCP over
streamable HTTP at `/mcp`, **no inbound auth**. Two Railway services
(`google-maps-mcp`, `google-maps-scraper`), both CLI deploys dated 2026-08-13
and 2026-08-09, so **the live code is at least three weeks behind `main`** and
cannot be tied to a commit. Writes to Supabase `kemvxzhcxvynmoutwdrh`
(google-maps-scraper-leads) — the project id is a hardcoded default
(`gmscraper/source_binding.py:91`), not just an env var. Unmerged branches on
the repo: `details-writeback`, `resolve-loop-guards`,
`pp-rpc-resolve-errors`, `sync-contacts-dataset`, `per-client-icp`.

### Tools

43 tools registered in `mcp_server/server.py`. The ones `leadtopup` would
touch:

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `pipeline_run` | **client_tag**, **query / geo** parameters, plan options | **job id** | `{job_id, status}`; attaches to an existing job when the `queue_key` matches (idempotent) |
| `resolve_places` | **schema**, **table**, **key_column**, where, writeback columns (`domain, website, phone, place_id, …, attempted_at`), max cost | **job id** | table source + writeback; refuses with `reason: "exceeds_MAPS_MAX_COST_USD"` (`gmscraper/resolve_places.py:415`) |
| `enrich_waterfall` | **rows** (inline only — no table source), max_tier (default `leadmagic`), need | **job id** | order apify → aiark → getleads → leadmagic → fullenrich; `estimated_cost_usd` is always `0.0` (`gmscraper/waterfall.py:698`) |
| `get_job_status` | **job_id** | sync poll | `{status, progress, heartbeat_age, stall_after_seconds: 300, …}` (`server.py:1311-1375`) |
| `cancel_job` | **job_id**, reason | sync | removes a queued job / kills the running one (`server.py:1463`) |
| `sync_to_supabase` | **client_tag**, dataset, resume_token | sync, paged 1000 | writes `client_<tag>.leads` / `client_<tag>.contacts`; returns counts + `resume_token` |
| `export_csv` | filters | sync | **inline CSV, cap 5000 rows** |
| `query_leads` | filters, page | sync | rows inline, page ≤ 50 |
| `sample_leads` | filters, n | sync | rows inline, n ≤ 100 |

### Jobs

- Statuses: `queued | running | completed | failed | stalled | interrupted |
  cancelled` (`server.py:1300-1310`). Heartbeat every 30 s; a job with no
  heartbeat for `STALL_SECONDS = 300` is reported `stalled`
  (`mcp_server/jobs.py:32,219,304`). Jobs persist on disk under `data/jobs/`;
  `interrupted` marks a job the process lost on restart — it is **not**
  resumed.
- `finished` = `status ∈ {completed, failed, cancelled}`; `failed` carries an
  `error` string; `stalled` is a live judgement from heartbeat age, not a
  stored state, so it can flip back to `running`.
- **Cancel exists** (`cancel_job`). The brief's "no cancel" does **not** apply
  to this server.

### Rows

- `resolve_places` and `sync_to_supabase` are the row-safe paths (table source
  with writeback; counts + resume token).
- `enrich_waterfall` takes inline rows only — **there is no table source**, so
  calling it from `leadtopup` would put lead rows in the request. Not usable
  under the non-negotiables until it grows a `source_table` mode.
- `export_csv` returns up to 5000 rows inline; `query_leads`/`sample_leads`
  return rows. `leadtopup` must not call them except `sample_leads(n ≤ 10)`.

### Prices

`gmscraper/config.py`: Maps plan rates $0.001 / $0.0009 / $0.00005 per place
by plan tier with 20 % quota share; `MAPS_MAX_COST_USD` default 25.0
(`config.py:242`); Apify $0.001 per start + $0.002 per page, `APIFY_MAX_COST_USD`
default 5.0 (`config.py:231`); SERP $0.0005 per query; OpenAI $0.05 / $0.40 per
1 M tokens. The waterfall's `estimated_cost_usd` is a literal `0.0`.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Refuted** — `cancel_job` exists. |
| Zero-dollar accounting | **Confirmed** for `enrich_waterfall` (`waterfall.py:698` hardcodes `0.0`). Maps/Apify paths do estimate. |
| Status errors on completed jobs | Not reproduced in code; `get_job_status` reads the on-disk record and returns `unknown` for a missing id rather than raising. |
| Row-count truncation | `export_csv` silently caps at 5000; `sync_to_supabase` pages correctly with a resume token. |
| Other | Approval gates were removed from `pipeline_run` (nothing asks before spending up to the caps). Hardcoded project id. README still says `maps_leads`; code writes `client_<tag>.*`. Deployed code is weeks behind `main` and un-attributable. |

### Prerequisite PRs (Google Maps Scraper)

1. Deploy from GitHub `main` (stop CLI uploads) so the live code is a commit.
2. Give `enrich_waterfall` a `source_table` + `where` + writeback mode, or
   `leadtopup` will not call it.
3. Make `enrich_waterfall` report real `estimated_cost_usd` from the tier
   prices it already has.
4. Remove the hardcoded Supabase project default; require the env var.

---

## 3. PermitStack

### Identity

Repo `permitstack-mcp`; `main` is empty, code on `cursor/permitstack-full-mcp-70d0`
@ d9f705a. TypeScript; streamable HTTP at `/mcp`, **no inbound auth**;
authenticates to PermitStack with `X-API-Key` from `PERMITSTACK_API_KEY`
(`src/api.ts`). Railway `permitstack-mcp`, CLI deploy 2026-09-10.

### Tools

31 tools plus 4 aliases, all **synchronous passthroughs** to the PermitStack
REST API generated from `src/openapi-ops.json`. There is no job, cancel, cost
or table layer of any kind.

| Tool | Arguments | Notes |
|---|---|---|
| `search_permits` | q, city, state, per_page (default 25, **no max in the tool**; the API clamps to plan max — `openapi-ops.json:208-241`) | rows inline |
| `export_permits` | filters, limit ≤ **1,000,000** (`openapi-ops.json:410`) | **inline CSV**, unbounded in practice |
| `sync_permits` | cursor, per page ≤ **50,000** (`openapi-ops.json:497`) | rows inline |
| `get_permit` | schema requires `permit_id`, code also accepts `permit_number` (`src/api.ts:43-61`) | mismatch between schema and code |
| plays, contractors, property history, webhooks, metrics tools | passthrough | rows inline |

### Jobs

None. Every call returns when PermitStack answers. Nothing to poll, nothing
to cancel, nothing survives a restart because nothing is stored.

### Rows

There is **no table-source or writeback mode**. Every tool returns rows to the
caller. For `leadtopup` this means PermitStack cannot be called directly under
"no lead rows beyond ten sample rows": a permit feed lane needs a small
intermediary that pages `sync_permits` into a Supabase table, and that
intermediary does not exist yet.

### Prices

No prices in code; PermitStack is plan-billed. No cost is reported per call.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | Not applicable (synchronous). |
| Zero-dollar accounting | Not applicable (no cost layer at all). |
| Status errors on completed jobs | Not applicable. |
| Row-count truncation | The **opposite** problem: `export_permits` and `sync_permits` return up to 1 M / 50 k rows inline with no cap in the tool. |
| Other | `get_permit` schema/code mismatch. Only a smoke test exists. `main` is empty. |

### Prerequisite PRs (PermitStack)

1. Merge the working branch to `main`; deploy from GitHub.
2. Add a `sync_permits_to_table` (or equivalent) that writes to a named
   Supabase table and returns counts + cursor, so a permit lane never receives
   rows.
3. Cap `export_permits` / `search_permits` `per_page` in the tool schema.

---

## 4. Property Owners

### Identity

Repo `permits-GCs`, `main` @ 4e038a7 — Railway project "permit and parcel mcp",
deployed **from GitHub** (the only server besides email-waterfall that is).
TypeScript; **stateful** MCP sessions over `/mcp` held in process memory;
authless. Writes to Supabase `kemvxzhcxvynmoutwdrh`, schema `permit_parcel`.
Vendors: PermitStack, Shovels, Veriphone, Texas Comptroller, Florida Sunbiz.

### Tools

38 tools in `src/mcp/createServer.ts`. Grouped:

| Group | Tools | Sync / job | Rows |
|---|---|---|---|
| Contractors (Shovels) | `query_contractors`, `sample_contractors`, `get_contractor`, `export_contractors_csv` | sync | query ≤ 50/page; export **inline CSV cap 5000** (`createServer.ts:275,296`) |
| Parcels | `query_parcels`, `sample_parcels`, `export_parcels_csv` | sync | export inline cap 5000 (`src/server/routes/parcels.ts:46-51`) |
| Keys | shovels / permitstack key management, `estimate_credits` | sync | counts |
| Pull | `pull` (max_records ≤ 50 000; cursor kept in `pull_state.json`), `pull_calling_list` (confirm gate; max 8000 — `importCallingList.ts:9`) | sync, long | counts only |
| Calling lists | `save_calling_list`, `import_calling_list`, `list_calling_lists`, `query_calling_list` (≤ 50/page) | sync | rows on query |
| Enrichment | `score_calling_list`, `match_texas_officers`, `match_florida_officers` (48 s budgets per call, re-call to continue), `recompute_officer_dial_status`, `lookup_line_type` (Veriphone $0.0024/number, confirm gate), `owner_people_search`, `record_owner_cell` | sync | counts |
| Operators | `build_operators` — shell-LLC rollup by tax mailing address (`src/server/services/operators.ts`) | sync | counts |
| Sync | `sync_to_supabase` | sync | counts |

### Jobs

No async jobs and no cancel. Long work (`pull`, officer matching) is done in
48 s slices the caller re-invokes; progress lives in `pull_state.json` on the
container disk. `upsertJob` in `src/server/services/syncToSupabase.ts:62`
**always writes `status: 'completed'`** and zero costs — the job table is a
log, not a state machine.

### Rows

Counts-only paths exist for every bulk operation (`pull`, `build_operators`,
`sync_to_supabase`, scoring/matching). Row-returning tools are the `query_*`
(≤ 50), `sample_*`, and `export_*_csv` (5000 inline) — `leadtopup` must use
only `sample_*` with n ≤ 10.

### Prices

Veriphone $0.0024 per lookup (behind a confirm gate). Shovels / PermitStack
credits via `estimate_credits`. Texas Comptroller and Sunbiz are free. Cost is
**not** recorded in the job rows (always zero).

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed** (nothing to cancel; slices simply stop when not re-called). |
| Zero-dollar accounting | **Confirmed** (`syncToSupabase.ts:62` — completed, zero cost, unconditionally). |
| Status errors on completed jobs | Not applicable — status is always `completed`, which is its own error. |
| Row-count truncation | `export_*_csv` cap silently at 5000; `pull_calling_list` caps at 8000 (`enrichCallingList.ts:132,569,927`). |
| Other | Stateful sessions in memory: a redeploy drops every session; `pull_state.json` lives on a single container disk. |

### Prerequisite PRs (Property Owners)

1. Record real status and cost in `upsertJob` (or drop the table).
2. Return a `truncated: true` flag from the capped exports and the calling-list
   import.
3. Move `pull_state.json` to Postgres so a redeploy does not lose the cursor.

---

## 5. Domain Waterfall

### Identity

Repo `domain-finder-waterfall`. `main` @ dcb9a97 ("Fix silent row truncation")
but the Railway `domain-waterfall` service is a CLI deploy whose timestamp
(2026-09-09 18:26Z) matches `cursor/domain-waterfall-7990` @ df53a19 — **the
deployed code predates the truncation fix and has no progress counters**.
Python FastMCP over HTTP, no inbound auth. Reads/writes Supabase
`azpapwtnrbzywlnxxecz` through security-definer RPCs.

### Tools

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `health` | — | sync | ok |
| `ensure_profile` / `get_profile` | **client_tag**, profile fields | sync | profile (titles, tier order, ceilings) |
| `receipt_test` | **client_tag**, n | sync, small paid | per-tier hit rate on a sample |
| `resolve_domain` | **source_table**, **client_tag**, where, max_tier, approve_cost_usd, estimate_only, limit | **job id** over HTTP (sync in stdio) | `{job_id}`; with `estimate_only=true` a quote: rows, per-tier unit prices, worst case |
| `get_job_status` | **job_id** | sync poll | never raises; unknown id → `{status: "unknown"}` |
| `list_jobs` | — | sync | job summaries |

### Jobs

- Statuses `queued | running | completed | failed`. Jobs are JSON files on the
  container disk run by daemon threads; **a restart leaves them `running`
  forever** (no resume, no stall marker). **No cancel.**
- Deployed df53a19 reports only `phase` events (start / cost_gate / tier /
  tier_done) — no processed/hits counters — so progress within a tier is
  invisible. `main` (`cursor/job-progress-counter-7990` merged) adds counters.
- Finished = `completed` with `summary` (per-tier attempts/hits/cost) or
  `failed` with `error`.

### Rows

- Table source: `source_table` (schema.table) + `where`, paged **500**
  (`domain_waterfall/source.py:14`) via `dw_read_source` / `dw_count_source`
  RPCs. Deployed df53a19 pages with a `%I::text > %L` keyset on the key column
  (`supabase/migrations/001_domain_waterfall.sql:187`), which **silently skips
  rows** when the key is not text-ordered — the "row-count truncation" of the
  brief; fixed on `main` by `004_fix_source_pagination.sql`.
- Writeback allowlist: `wf_domain, wf_domain_source, wf_domain_confidence,
  wf_domain_agreement, wf_domain_candidates, wf_phone, wf_domain_status`.
  Nothing else on the source row is touched.
- No tool returns rows.

### Prices

`domain_waterfall/waterfall.py:119-183`: cache 0, maps 0, aiark 0.0005,
discolike 0.00425, serp 0.0045 (published fallback; live rate if the vendor
reports one — `vendors/serp.py:55-61`), prospeo 0.015 `free_on_miss`, leadmagic
0.015 (`vendors/leadmagic.py:27,47`). Cascade order cache → maps → aiark →
discolike → serp → prospeo → leadmagic. `OUT_BY_DESIGN`: fullenrich, hunter,
llm, **pdl** (never called). aiark and leadmagic are billed per attempt by the
vendor but the code books them per hit → **under-bills on a miss**.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed.** |
| Zero-dollar accounting | Partial — real unit prices, but aiark/leadmagic misses are booked at $0. |
| Status errors on completed jobs | Refuted for the tool (`get_job_status` never raises), but a job orphaned by a restart is reported `running` indefinitely. |
| Row-count truncation | **Confirmed in the deployed build** (df53a19); fixed on `main`. |
| Other | Deployed build cannot be tied to a commit with certainty (CLI upload). |

### Prerequisite PRs (Domain Waterfall)

1. Redeploy from `main` **and** apply `004_fix_source_pagination.sql` to the
   database; until then `leadtopup` treats every job's row count as suspect
   and bounds batches to ≤ 500 rows (one page) so truncation cannot hide.
2. Deploy from GitHub, not CLI.
3. Mark jobs `interrupted` on boot (or resume them) so `running` means running.
4. Book aiark / leadmagic per attempt.

---

## 6. Find Named Person

### Identity

Repo `find-named-person-waterfall`; `main` is empty, code on
`cursor/people-waterfall-mcp-dbc8` @ 7154c52. Railway `people-waterfall`, CLI
deploy 2026-09-09. Python FastMCP over HTTP, no inbound auth. Supabase
`azpapwtnrbzywlnxxecz`.

### Tools

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `resolve_people` | **source_table**, **client_tag**, where, max_tier (default `"all"`), approve_cost_usd (default **-1 = no ceiling**), estimate_only (default **true**), require_title_match, background | **job id** on HTTP; sync in stdio | quote when `estimate_only`; `{job_id}` otherwise (`mcp_server/server.py:114-147`) |
| `receipt_test` | **client_tag**, n=15, approve_cost_usd=3.0 | sync, small paid | per-tier scores against ground truth (`server.py:242-261`) |
| `get_profile` | **client_tag** | sync | ranked titles, tier order |
| `get_job_status` | **job_id** | sync poll | `{status, counter:{done,total,pct}, summary}`; unknown → `status: "unknown"` |
| `list_jobs` | — | sync | summaries |

### Jobs

- Statuses `queued | running | completed | deferred | failed | unknown`.
  Persisted to disk **and** `public.pw_jobs` (`mcp_server/jobs.py:64,149,232`)
  but not resumed after a restart. **No cancel.**
- Finished = `completed` (summary with per-tier attempts/hits/cost, `name_bank`
  count) or `failed`. `deferred` means the cost gate refused; nothing spent.

### Rows

- Table source paged 500 via `ew_read_source` (shares the email-waterfall RPC —
  `people_waterfall/receipt.py:32`). Count fallback **caps at 50 000**, so a
  larger source under-reports `total`.
- Writes people to `public.<tag>_wf_contacts`; source writeback
  `wf_people_count, wf_people_source, wf_people_status`; rejected titles go
  to `public.name_bank`. No tool returns rows.

### Prices

Per row attempt: cache / getleads / smartlead 0; leadmagic_employee 0.05 credit
(≈ $0.0005–0.0012 by plan); aiark 0.5 credit (≈ $0.001–0.0049); serp 0.0045;
prospeo 1 credit `free_on_miss`; leadmagic_role 2 credits. Default order cache
→ getleads → smartlead → leadmagic_employee → aiark → serp → prospeo →
leadmagic_role. leadmagic_employee and aiark book $0 on a miss; a vendor retry
can bill the same row twice.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed.** |
| Zero-dollar accounting | Partial — misses on two paid tiers booked at $0. |
| Status errors on completed jobs | Refuted for the tool; orphaned jobs stay `running`. |
| Row-count truncation | Count fallback caps at 50 000 (progress `total` wrong above that); read path pages correctly. |
| Other | `approve_cost_usd` default `-1` means **no ceiling** once `estimate_only=false` — `leadtopup` must always pass an explicit ceiling. `main` is empty. |

### Prerequisite PRs (Find Named Person)

1. Merge to `main`; deploy from GitHub.
2. Make a positive `approve_cost_usd` mandatory when `estimate_only=false`.
3. Mark orphaned jobs on boot; add cancel.
4. Book per attempt on leadmagic_employee / aiark; dedupe retries.

---

## 7. Email Finder Waterfall

### Identity

Repo `email-waterfall`, `main` @ 9d93be4, deployed **from GitHub** (Railway
`email-waterfall`, 2026-09-09). Python FastMCP over HTTP, no inbound auth.
Supabase `azpapwtnrbzywlnxxecz`. This is the `email-waterfall` MCP already
attached to this workspace.

### Tools

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `health` | — | sync | ok |
| `ensure_client` | **client_tag**, profile (`owner`/`service`), target_titles | sync | creates `public.<tag>_wf_companies` / `_wf_contacts` |
| `list_clients` / `describe_client` | client_tag | sync | tags, titles, table names |
| `enrich_waterfall` | **client_tag**; **rows XOR source_table+where**; need ∈ email\|dm\|both\|phone; max_tier (default `leadmagic`); estimate_only; writeback (default on) | **job id** on HTTP or when inline rows > 2000 chars (`mcp_server/server.py:371`); else sync | quote or `{job_id}` |
| `get_job_status` | **job_id** | sync poll | raises `ValueError` **only** for an unknown id |
| `list_background_jobs` | — | sync | summaries |

### Jobs

- Statuses `queued | running | completed | failed`; JSON under `data/jobs/` +
  memory; daemon threads; no resume after restart; **no cancel**.
- Finished = `completed` with per-tier `attempts / hits / credits`,
  `suppressed_by_need` counts; `failed` with `error`.

### Rows

- Table source paged **500** via `ew_read_source` (`email_waterfall/source.py:16,420-450`),
  columns via `ew_source_columns`, writeback via `ew_patch_source`
  (`source.py:606`), `ew_ensure_wf_writeback` adds the `wf_*` columns.
- Writeback: `wf_status, wf_email, wf_email_status, wf_vendor, wf_updated_at`
  plus `dl_status, candidate_email, dl_provider` on Peterson-style queues.
- FullEnrich bulk path truncates to `rows[:100]`
  (`email_waterfall/vendors/fullenrich.py:76`) — rows past 100 in a batch are
  silently never sent to FullEnrich.
- No tool returns rows when a table source is used.

### Prices

Credits only, no dollars: 1.0 credit per attempt (aiark 1.5; email 1.0, phone
0.5), LeadMagic / AI Ark mobile 5 credits on hit, FullEnrich 1 credit on hit.
`estimated_cost_usd` is hardcoded `0.0` (`email_waterfall/waterfall.py:875`)
and the estimate's `spend` is `0`. Cascade getleads → smartlead → aiark →
leadmagic → prospeo → fullenrich; FullEnrich is unreachable at the default
`max_tier`, which matches the non-negotiable. No PDL anywhere.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed.** |
| Zero-dollar accounting | **Confirmed** (`waterfall.py:875`). Credits are counted; dollars are not. |
| Status errors on completed jobs | Refuted for known ids; unknown id raises rather than returning a status. |
| Row-count truncation | FullEnrich `rows[:100]` silent truncation. Source paging is correct. |
| Other | Orphaned jobs on restart. |

### Prerequisite PRs (Email Finder Waterfall)

1. Convert credits to dollars per vendor plan and report `estimated_cost_usd`.
2. Page the FullEnrich bulk call instead of slicing at 100 (or refuse > 100
   with a clear error).
3. Add cancel; mark orphaned jobs on boot.

---

## 8. Name to Email

### Identity

Repo `name-to-email`, `main` @ 64223dd (2026-08-23). Railway project
`name-to-email`, service `finder` (+ its own Postgres), CLI deploy 2026-08-24.
FastAPI; MCP JSON-RPC served at `/` and `/mcp` (`src/finder/mcp_http.py`);
the "open OAuth" flow in `oauth_open.py` is **not enforced**.

### Tools

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `verify_person` | **first_name, last_name, domain** | sync | one result: pattern tried, `status`, verifier |
| `start_run` | **people[]** (inline), max_cost (USD ceiling, default `DEFAULT_COST_CEILING` 25) | **job id** | `{run_id}` |
| `get_run` | **run_id** | sync poll | counts by status, `cost_usd`, `hunter_calls`; **no `updated_at`** exposed |
| `export_run` | **run_id**, segment ∈ valid\|catchall\|unresolved | sync | **unbounded inline CSV text** |

### Jobs

- Run statuses `pending | running | completed | stopped | failed`. Runs are
  persisted in the service's own Postgres but **not auto-resumed** after a
  restart. **No cancel.** Cost ceiling is check-before / charge-after.
- Finished = `completed` or `stopped` (ceiling hit) or `failed`.

### Rows

- `start_run` takes people **inline** only. The REST API has a `table` source
  but it is `SELECT *` unbounded and **not exposed over MCP**.
- `export_run` returns the CSV body in the tool result — the largest thing any
  server here can return. `leadtopup` must not call it.

### Prices

MillionVerifier $0.00178 per check (valid and invalid both billed —
`src/finder/verifiers/waterfall.py:78`, `millionverifier.py:32`); No2Bounce
$0.008 via `api.reacher.email` (`waterfall.py:88-90`, `no2bounce.py:33-35`);
Hunter has **no dollar constant** — only `hunter_calls` is counted
(`models.py:48`, `api.py:107-115`).

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed.** |
| Zero-dollar accounting | **Confirmed for Hunter** (calls counted, dollars never). |
| Status errors on completed jobs | Not reproduced; `get_run` reads the row. |
| Row-count truncation | The opposite — `export_run` is unbounded inline. |
| Other | **Catch-all confirmations are written `status="valid"` with `domain_is_catchall=True`** (`src/finder/engine.py:452-457, 475-480, 576`), contradicting the server's own instruction "catch-all is never mixed into valid". A caller filtering on `status = valid` receives catch-all addresses. |

### Prerequisite PRs (Name to Email)

1. Write catch-all confirmations as `status="catchall"` (or a distinct value),
   never `valid`.
2. Add a `source_table` mode to `start_run` and a signed-URL `export_run`;
   until then the server cannot be used from `leadtopup` without putting rows
   in the request.
3. Price Hunter calls; add cancel; resume or mark runs on boot.

---

## 9. Email Verifier Progression

### Identity

Repo `email-verifier-progression`, `main` @ 165b527. Railway project
`email-verification-waterfall`, service `verifyfall` (+ `millionverifier-mcp`,
`csv-host`), CLI deploy 2026-09-09 16:48Z — **FAILED**. Node ESM, NIXPACKS,
healthcheck `/api/health` with `healthcheckTimeout = 60` (`railway.toml:7`).
Supabase `azpapwtnrbzywlnxxecz`: tables `verification_runs`,
`verification_run_logs`, `verification_address_results`, `domain_mx_cache`;
buckets `verification-uploads`, `verification-results`. This is the
`email-verification-waterfall` MCP attached to this workspace and the server
behind `leadtopup`'s `src/clients/verifier.ts`.

**HEAD cannot start.** `node --check src/mcp-server.js` at 165b527 fails with
`SyntaxError: Unexpected token '=>'` at line 190 — the `resume_verification`
input schema is missing a closing `},`. That is why the latest deploy failed;
the live URL still answers 200 from the previous replica. An unmerged branch
raises the healthcheck timeout to 180 s, which does not fix the boot.

### Tools

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `start_verification` | **file_url**, segment_name, prior_run_id, force_fresh | **run id** | `{run_id}` |
| `get_verification_status` | **run_id** | sync poll | `{status, stage_completed, counts, mv_credits_used, n2b_credits_used, partial}`; **throws** on a missing run |
| `list_verification_runs` | limit ≤ 100 | sync | summaries |
| `get_verification_results` | **run_id** | sync | signed URLs (1 h): sendable, rejected, seg, other, unresolved; `partial` flag |
| `resume_verification` | **run_id**, force | run id | re-enters at `stage_completed` |
| `export_all_sendable` | **run_ids[]** ≤ 100 | sync | signed zip URL |

### Jobs

- Statuses `queued → classifying_mx → verifying_mv → verifying_n2b → merging →
  completed | failed | paused` (`src/pipeline.js:256,461,870`); `stage_completed
  ∈ none|mx|mv|n2b|merge` drives resume.
- MV stall: `MV_STALL_TIMEOUT_MS` 12 min, `MV_STAGE_TIMEOUT_MS` 45 min
  (`src/config.js:41-43`); a stalled MV stage recovers as **partial** when ≥ 90 %
  of addresses are back. N2B polling deadline is a **hardcoded 60 min**
  (`src/providers/no2bounce.js:109`); `n2bStageTimeoutMs` (`config.js:51`) is
  read but unused.
- **No cancel.** In-process workers; a restart leaves a run at its last
  status until `resume_verification` is called.
- Finished = `completed` (results signed URLs available) or `failed`; `paused`
  means a provider stopped it and resume is expected.

### Rows

Input is a file URL; output is signed URLs. Results are upserted 500 at a time
and paged 1000 into `verification_address_results`. No tool returns addresses.
`leadtopup` already downloads the sendable CSV and asserts its row count
against `counts`.

### Prices

Credits only: MV credits = ok + invalid; N2B from `creditDebited / totalCredit /
len`. `mv_credits_used` can legitimately read 0 after real calls when MV
reports credits asynchronously. No dollar figure anywhere. BillionVerifier was
removed (`supabase/migrations/20260810000000_remove_bv_…`).

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed.** |
| Zero-dollar accounting | **Confirmed** — credits, never dollars; MV credits can be 0 after spend. |
| Status errors on completed jobs | `get_verification_status` throws for a missing run id; completed runs read fine. |
| Row-count truncation | Not found; paging is explicit. |
| Other | **HEAD does not parse**; deploy FAILED; N2B timeout hardcoded. |

### Prerequisite PRs (Email Verifier Progression)

1. Fix the syntax error in `src/mcp-server.js` (~line 184-190) and redeploy;
   add `node --check` / a boot test to CI so a non-parsing HEAD cannot ship.
2. Convert credits to dollars per plan; report `cost_usd` on status.
3. Use `n2bStageTimeoutMs`; add cancel.

---

## 10. Smartlead server

### Identity

Repo `smartleadmcp`; `main` is empty, code on `cursor/lead-purge-job-4596`
@ 49fd8d9 (the Railway deploy of 2026-08-25 is 2 s after that commit, so this
is production). TypeScript / Express; streamable HTTP at `/mcp`, **no
inbound auth**; Smartlead `api_key` query param from `SMARTLEAD_API_KEY`.
`express.json({ limit: "25mb" })` (`src/index.ts:17`). Supabase
`azpapwtnrbzywlnxxecz`: `leads_staging`, `lead_import_runs`, `lead_stage_runs`,
`lead_purge_runs` and their log tables. 48 tools; `catalog.json` lists 195
raw endpoints reachable through `smartlead_request`. No tests.

### Tools

Those `leadtopup` may call (read or additive only):

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `list_campaigns`, `get_campaign`, `get_campaign_analytics*`, `get_campaign_statistics`, `get_analytics_overview` | campaign_id | sync | metadata / counts; `list_campaigns` unbounded but not rows |
| `list_campaign_leads` | **campaign_id**, offset, limit | sync | **lead rows inline**; unbounded without `limit` — do not call |
| `get_lead_by_email` | **email** | sync | one lead |
| `stage_leads_from_url` | **csv_url**, auto_import, campaign_id | **run id** | inserts into `leads_staging` in 400-row chunks (`src/leadStageJob.ts:7`) |
| `start_lead_import` | **campaign_id**, filters | **run id** | reads `leads_staging where imported=false` in pages of 400, posts chunks of 400 with 1500 ms delay (`src/client.ts:2`, `src/leadImportJob.ts:4`), marks `imported`, `import_run_id`; custom fields `Local_Sports_Team`, `vendor` (falls back to brand), `job_title` |
| `get_lead_import_status`, `get_lead_stage_status`, `list_lead_import_runs`, `list_lead_stage_runs` | run_id | sync poll | `{status, counts, errors}` |
| `import_leads` | **campaign_id**, **leads[]** inline | sync (whole payload) | chunked 400 (`src/tools.ts:382`) — puts rows in the request; do not call |
| `add_to_block_list` | domains / emails | sync | additive only |
| `create_webhook`, `list_email_accounts`, `list_clients`, `list_lead_lists`, `list_inbox_replies` | — | sync | metadata |

**Destructive tools `leadtopup` must never call** (non-negotiables):
`update_campaign_status` (ACTIVE→START / PAUSED / STOPPED — `src/tools.ts:675-683`),
`delete_campaign`, `start_lead_purge` (DELETEs leads), `unsubscribe_lead`,
`pause_lead`, `unlink_mailboxes`, and `smartlead_request` with any method
other than GET — the catalog exposes `delete_domain_block_list` →
`/leads/delete-domain-block-list` (`src/catalog.json:281`). There is no named
block-list-removal tool; the only route to it is `smartlead_request`, which is
why `leadtopup`'s guard bans that tool entirely rather than by method.

### Jobs

- Statuses `queued | running | completed | failed` in `lead_*_runs`; workers
  are in-process; **no resume** after restart (a run stays `running`);
  **no cancel**; every call starts a new run (no idempotency key).
- Finished = `completed` with `{staged | imported, failed_chunks[]}` or
  `failed` with `error`.
- **No row-count assertion after import**: the job trusts Smartlead's per-chunk
  response and never compares `imported` to the campaign's lead count. The
  brief's "row-count truncation" for Smartlead is this: a partially accepted
  chunk is not detected.

### Rows

- Row-safe path: `stage_leads_from_url` (CSV URL → `leads_staging`) then
  `start_lead_import` (staging → campaign). Rows never transit the MCP call.
- Row-returning tools: `list_campaign_leads`, `export_campaign_leads`
  (unbounded inline), `import_leads` (inline request). Banned for `leadtopup`.

### Prices

None. Smartlead is plan-billed; no cost is tracked.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed.** |
| Zero-dollar accounting | Not applicable (no paid vendor). |
| Status errors on completed jobs | Not reproduced in code. Orphaned runs stay `running`. |
| Row-count truncation | **Confirmed by omission** — no post-import count check; partial chunk acceptance is invisible. |
| Other | Destructive reach through `smartlead_request`; `main` empty; no tests; no inbound auth on a server that can stop campaigns and delete leads. |

### Prerequisite PRs (Smartlead server)

1. After `start_lead_import` completes, read the campaign's lead count and
   record `expected` vs `observed`; mark the run `failed` on a mismatch.
2. Put an allowlist in front of `smartlead_request` (GET only, or remove the
   DELETE and status endpoints from the catalog) and add inbound auth.
3. Mark orphaned runs on boot; add an idempotency key so a retried call
   attaches instead of re-importing.
4. Merge to `main`; deploy from GitHub.

---

## 11. getleads (hosted MCP, third party)

### Identity

Not one of the ten Railway servers: getleads is a vendor, and its MCP is
hosted by getleads at `https://app.getleads.io/api/mcp`
(`skills/MCP_SERVERS.md`). There is no repository to read, so this section is
from the live `tools/list` schema and the server's own instructions text,
read on 2026-09-11. **Auth is OAuth for a person** (the workspace connection
was made by a human signing in). The schema publishes no API-key or
service-token path; `leadtopup` reads `GETLEADS_TOKEN` from Railway and sends
it as a bearer, and whether getleads accepts a bearer from a service is the
open question at the top of the PR. Until it does, steps 2 and 3 on a getleads
lane park with "GETLEADS_MCP_URL is not configured" rather than guess.

Two balances, per the server's instructions: **plan credits** cover contact
search, export and enrichment (unlimited plan → `creditsRemaining` null, not
zero); a **prepaid wallet** funds only paid scrapes (profile monitoring,
company followers, website visitors), none of which `leadtopup` uses. A low
wallet is never "out of credits". `get_fair_use` shows the daily/monthly
fair-use budget and `resets_at` (next 00:00 UTC).

### Tools

Those `leadtopup` calls; everything else on the server is out of scope.

| Tool | Arguments (required in bold) | Sync / job | Returns |
|---|---|---|---|
| `count_contacts` | the contact filters: `job_titles[]`, `company_size[]` (**band labels** — `"11 to 50"`, `"51 to 200"`, …), `employee_profiles_on_linkedin {min,max}`, `countries[]`, `states[]`, `cities[]`, `industries[]` / `companyIndustry[]` (no commas — they shred silently), `email_status[]` (`["VALID"]` only), … | sync, **free, always** | `{total_matching, exportable_rows}` |
| `export_contacts` | same filters + `columns[]`, `max_per_company` (1–50), `max_rows` (1–50 000), **`confirmed: true`** (refused without it) | **export id** | `{export_id}`; later `cap_reason ∈ per_company \| max_rows \| hard_ceiling \| fair_use \| credits \| filtered` says why fewer rows than asked |
| `check_contact_export` | **export_id** | sync poll | `{job_status, export_url, rows_exported, rows_available, cap_reason, cap_message}` |
| `get_fair_use` | — | sync, free | remaining daily/monthly budget, `resets_at` |

### Jobs

- An export is a job: `export_contacts` returns `export_id`; poll
  `check_contact_export` until `job_status` is terminal. The status words are
  **not in the schema**; the client treats `completed / done / finished /
  succeeded / ready` as done and `failed / error / cancelled` as failed, and
  the first real job confirms the vocabulary (`src/clients/getleads.ts`).
- **No cancel tool.** An export that was asked for is delivered.
- `rows_exported` can be **below `max_rows`** with a `cap_reason`; the service
  reads `rows_exported` and never assumes it got what it asked for (step 4's
  gate compares against `rows_exported`, not the request).

### Rows

- `export_contacts` hands back a URL; the file never transits the MCP call
  and `leadtopup` never opens it — LeadPipe ingests from the URL (step 4).
- `search_contacts`, `lookup_decision_makers`, `getleads_enrich_person_batch`
  and every `*_batch` / `lookup_*` tool return contact rows inline. **Never
  called** from `leadtopup`.

### Prices

Included plan: `count_contacts` and `export_contacts` are $0 per call
(`src/spend/prices.ts` `getleads: included`). Every call still writes a
`topup.spend_ledger` row. The fair-use budget is the real ceiling; a
`cap_reason: fair_use` on an export is reported in the thread and the ledger,
never worked around.

### Breakage

| Brief item | Finding |
|---|---|
| No cancel | **Confirmed** (no such tool). |
| Zero-dollar accounting | Not applicable — included plan; the service books $0 and counts rows. |
| Status errors on completed jobs | Cannot confirm; vocabulary unpublished. |
| Row-count truncation | **By design** — `cap_reason` reduces `rows_exported` silently unless the caller reads it. The service reads it and gates step 4 on `rows_exported`. |
| Other | OAuth-for-a-person is the only documented auth. Numeric headcount bounds (`employee_count_min/max`) and comma industries shred results silently (brief section 9); the recipe schema refuses both before a call is made. |

### Prerequisite PRs (getleads)

Not ours to write. Two things Josh must settle before a run reaches step 3:

1. A credential a service may present (`GETLEADS_TOKEN`), or confirmation
   that the OAuth session token may be used and how it is refreshed.
2. The `job_status` words of `check_contact_export`, from the first real
   export, written back into this section.

---

## What `leadtopup` may call

Derived from the sections above and the non-negotiables. Anything not listed
is a decision for Josh (D18: unclear → judgement column).

| Server | Allowed | Never |
|---|---|---|
| LeadPipe | `lp_inventory`, `lp_plan`, `lp_run`, `lp_status`, `lp_export` (signed URL), `lp_sample` (n ≤ 10), `lp_list_clients`, `lp_ensure_client` | — |
| Google Maps Scraper | `pipeline_run`, `resolve_places`, `get_job_status`, `cancel_job`, `sync_to_supabase`, `sample_leads` (n ≤ 10) | `enrich_waterfall` (inline rows), `export_csv`, `query_leads` |
| PermitStack | nothing until a table-writing tool exists | every tool (all return rows) |
| Property Owners | `pull`, `build_operators`, `sync_to_supabase`, `score_*`, `match_*`, `estimate_credits`, `sample_*` (n ≤ 10) | `export_*_csv`, `query_*` beyond samples, `lookup_line_type` without a card |
| Domain Waterfall | `resolve_domain` (estimate first; `approve_cost_usd` explicit; ≤ 500 rows/batch until redeploy), `get_job_status`, `get_profile`, `health` | `receipt_test` without a card |
| Find Named Person | `resolve_people` (estimate first; explicit ceiling), `get_job_status`, `get_profile` | `resolve_people` with `approve_cost_usd < 0` |
| Email Finder Waterfall | `enrich_waterfall` with `source_table` (estimate first; `max_tier` ≤ leadmagic unless `owner_approved_at`), `get_job_status`, `ensure_client`, `describe_client` | `enrich_waterfall` with inline `rows` |
| Name to Email | `verify_person` (single, on a card), `get_run` | `start_run` (inline rows), `export_run` |
| Email Verifier Progression | `start_verification`, `get_verification_status`, `get_verification_results`, `resume_verification`, `list_verification_runs` | `export_all_sendable` (aggregate is a judgement) |
| Smartlead server | `stage_leads_from_url`, `start_lead_import`, `get_lead_*_status`, `list_lead_*_runs`, `list_campaigns`, `get_campaign*`, `get_sequences`, `list_campaign_mailboxes`, analytics/statistics, `get_lead_by_email`, `add_to_block_list`, `list_email_accounts` | `update_campaign_status`, `delete_campaign`, `start_lead_purge`, `unsubscribe_lead`, `pause_lead`, `unlink_mailboxes`, `import_leads`, `list_campaign_leads`, `export_campaign_leads`, `smartlead_request` |
| getleads (hosted) | `count_contacts`, `export_contacts` (`confirmed: true`, band labels, `VALID` only), `check_contact_export`, `get_fair_use` | every tool that returns contacts inline (`search_contacts`, `lookup_*`, `*_batch`), every wallet-funded scrape |

`src/clients/smartlead.ts` carries the Smartlead allow list in code
(`SMARTLEAD_ALLOWED`: `start_lead_import`, `get_lead_import_status`,
`get_sequences`, `get_campaign`, `list_campaign_mailboxes`) and refuses any
other tool name before a request is built.

Anything over $5 per step still asks first with the worst case in dollars,
regardless of the table.

## Prerequisite PRs, by server (summary)

| Server | Blocks | PRs |
|---|---|---|
| LeadPipe | attribution of any bug | push source to GitHub; cancel; status vocabulary + last-progress timestamp |
| Google Maps Scraper | any physical lane using the waterfall | deploy from `main`; `source_table` mode on `enrich_waterfall`; real `estimated_cost_usd`; drop hardcoded project id |
| PermitStack | permit lane | merge to `main`; table-writing sync tool; cap `per_page` |
| Property Owners | parcel lane accounting | real status/cost in `upsertJob`; `truncated` flag; cursor in Postgres |
| Domain Waterfall | Phase 3 cascade step 1 | redeploy `main` + `004_fix_source_pagination.sql`; deploy from GitHub; orphan marking; bill per attempt |
| Find Named Person | Phase 3 cascade step 2 | merge to `main`; mandatory ceiling; orphan marking + cancel; bill per attempt |
| Email Finder Waterfall | Phase 3 cascade step 3 | dollars from credits; FullEnrich paging; cancel + orphan marking |
| Name to Email | Phase 3 cascade step 3 (pattern path) | catch-all ≠ valid; `source_table` + signed-URL export; price Hunter; cancel |
| Email Verifier Progression | **Phase 1 verify step today** | fix `src/mcp-server.js` syntax + boot test; dollars; use `n2bStageTimeoutMs`; cancel |
| Smartlead server | Phase 2 import | post-import count assertion; `smartlead_request` allowlist + inbound auth; orphan marking + idempotency; merge to `main` |

`leadtopup` does not work around any of these. Where a path is used before its
PR lands, the run is bounded by batch size (≤ 500 rows per vendor job, one
page) and the PR description says so.
