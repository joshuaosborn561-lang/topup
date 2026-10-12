# Canon — the rules Grok bot works by

Canon as of **D97** (2026-10-12). One page. `DECISIONS.md` is the append-only
ledger of why; this page is what is true now. When a decision lands, this
page changes in the same PR; `src/guards/meta.test.ts` enforces both.

## What this is

A dumb, flat pipeline on Railway with an MCP on top. Grok bot does the
reasoning: it reads what Supabase holds about how a campaign was pulled,
works out how to pull more of the same, and calls the verbs one at a
time. The service counts, moves rows, and writes receipts. It never
decides what to pull, never starts on its own, never spends without a
person's name, and never touches a campaign's status.

Rows move **MCP → Supabase → LeadPipe → Smartlead**. They do not enter
Grok's context. No read or verb returns a lead row or a file URL (D2, D39,
D48).

## The rules

1. **One positive reply per 2,000 sends** is the bar. A campaign under it
   is not topped up (D11, D44, D51).
2. **At least 1,000 more leads** must be available after what the client
   already holds, or the answer is: *the TAM for this campaign is
   exhausted* (D46, D51). The TAM is the total leads available on the
   source with the receipt's filters.
3. **A job pulls 1 to 2,000 rows** for one campaign (D52, D53).
4. **A person approves every spend before it runs.** The auto cap is $0.
   A verb that needs money returns the estimate and a card; the same verb
   with `approved_by="Name"` runs it and records who (D9, D18, D51).
5. **Nothing starts on its own.** No watch, no cron, no planner. Grok calls
   the next verb or nothing moves. A call that would open as the watch, or
   with trigger runway / scheduled, is refused (D51, D53, D61).
6. **Josh flips ACTIVE by hand.** The service never sets a campaign ACTIVE,
   never pauses, stops or deletes one, and never creates or edits one in
   Smartlead (D5, D14).
7. **Never top up** SG Nurture (3122546) (D46). **Ignore any campaign
   marked as cold call** ("Cold Call", "Gabe Calls", "Cayden Calls",
   "Post-call"): it is not listed, not read, not pulled (D54).
8. **Counts and ids, never rows.** Logs, cards, receipts and answers carry
   counts, labels and notes. The logger redacts (D2).
9. **Only campaignintelligence** (`azpapwtnrbzywlnxxecz`). Secrets live in
   Railway. Smartlead is never started, paused, stopped or deleted from
   here (D1, D3, D5, D6).
10. **Phones are kept.** Every lane table and the staging table carry a
    phone column; any step that finds a phone writes it there; the stage
    carries it to Smartlead's phone_number; nothing drops one. `leftovers`
    shows `need_phone` and says when a store has no phone column (D56).
11. **The ICP gate runs before anything paid.** After suppression and
    before enrich, verify or import, every job's distinct domains go
    through our own site fetch and Jev's category pick (skill
    `icp-website-gate`). Only `icp_gate = yes` moves on; flagged rows are
    suppressed with a reason and stay in the table. A client with no label
    set in `topup.icp_variants` parks until one is written (D60).
12. **LeadMagic is dropped.** A stored `email_max_tier=leadmagic` (or
    `lm` / `lead_magic`) is a legacy ceiling: replay as `aiark`. A stored
    LeadMagic person source (`leadmagic_employee_finder` and the old
    aliases) replays as Find Named Person's default order `site_staff →
    cache → discolike → prospeo_search → aiark_people`. The stored
    receipt is not rewritten. New recipes and new receipts never write
    those names (D58).
13. **Maps pull is idempotent, and pull itself is not a long wait.** The
    stored-pool copy into `lp.<tag>_ingested_leads` reads the named ICP
    view (or `maps_raw`), not the companion-view join. It skips emails
    already in the ingest table *before* `max_rows`, then dedupes the
    batch on email (`NOT EXISTS`; `ON CONFLICT` only when a unique email
    index exists). Skipped rows are `already_held`. Successive pulls
    advance through the pool. The copy runs under a statement timeout.
    `pull` returns the job id at once and runs in the background; a
    background verb that throws or outruns the job timeout ends `failed`
    with `last_error`. `job(job_id)` is the poll (D61, D62, D64).
14. **A paid step that did not run is not done.** `approved_by` (within
    the approved amount) records the approval, closes the spend card
    (and a leftover parked spend card), and runs the paid work. A step
    that processed 0 of N queued rows reports failed/blocked with
    `last_error`, not `done`. Downstream `find_emails` does not skip
    while `needs_person` or `needs_domain` remain. Jev's ICP label is a
    token from the allowed set, never the raw sentence; unparseable is
    null + flag. A spend card is re-quoted when the estimate changes and
    records `actual_cents` on completion.    Maps `count` used/net-new is
   the union of already-live, already-ingested and already-contacted
   (this client's unsubscribes, hard bounces pending Josh, and the
   existing DNC list), each reported. `size` is the
    free dry-run of that pool plus suppression by reason; it opens no
    job. `lp_export` reads `result.signed_url` / `result.row_count`. A
    verify retry uses a recorded approval and does not park on a third
    failure (D64).
15. **Job 46b1c941 follow-up.** `size` returns a `size_id` at once and
    is polled with `size(size_id)`; the suppress pass is one aggregate
    JOIN, not a per-email EXISTS. A named approval is idempotent per
    step / approver / amount (a second tap of $1.40 stays $1.40). A QA
    hold count is distinct rows of this job, never the lane table and
    never multiplied by empty merge fields. A step pre-D64 marked
    `done` with rows still queued for it, or with 0 of N processed, is
    reopened, run, and its leftover parked card closed. Lane E
    role-inbox rows (`info@`, `office@`, …) take company from the Maps
    business name; a first-name/greeting fallback is a recipe key
    (`first_name_fallback`) whose default is unchanged — Josh decides
    the string (D65).
16. **People / email waterfalls read a pre-built domain view.**
   `ew_read_source` SELECTs identifier columns only — it cannot alias
   `company_domain` as `domain`. The service hands
   `topup.<tag>_ingested_leads_ew` (migration `0021`, unapplied until
   Josh says so). It never CREATE / DROP / ALTER at runtime, and it
   never grants on schema `lp`. A missing view fails and asks Josh
   (D66, D67). The other-repo alternative is
   `people_waterfall/source.py`: add `company_domain` to
   `FIELD_CANDIDATES['domain']` and make `count_source_with_domain`
   use the mapped column.
17. **A done step reopens when its rules changed, or when force is on.**
   Each step stores a `rules_hash` when it finishes. A later call with a
   different hash (or `force=true`) resets the step and runs it again
   (D66). A reopen wipes the step's result counts (keeps
   `approved_by`) and `finishStep` replaces them, so a stale
   `held_company_n` cannot survive (D69). Normalize's hash is
   `d69:hold-recompute-size`.
18. **Maps company is `maps_raw.name`.** The ingest copy coalesces
   `company`, then `name`, then `title` so an empty `company` column
   does not hide the business name. Normalize joins
   `client_<tag>.maps_raw` on `lower(email)` — ingest has no
   `place_id` — and fills empty company from that name. Role-inbox
   locals include the generic roles seen on job 46b1c941 (`staff`,
   `customerservice`, …). `title` is a role-inbox fallback only (D67).
19. **Hold and fill share `company_n`.** After normalize the merge
   value is `company_n` (staging copies it to Smartlead
   `company_name`). `MERGE_FIELD_COLUMN` maps `company_name` →
   `company_n` and `first_name` → `first_name_n`. An empty raw
   `company_name` is filled from `company_n` so the hold cannot read
   the empty source column (D68).
20. **Maps city is parsed; lane E ICP re-applies `main_category` and
   drops schools.** Ingest and normalize split `City, ST` in the city
   column. On `v_lane_e_*` the receipt categories match
   `maps_raw.main_category` (not `source_category`, the scrape
   bucket). Preschool through high school are excluded on lane E —
   they belong to lane D. This reverses D59's choice not to re-apply
   categories on the companion union (D68).
21. **A rerun replaces step counts; size pool binds start at `$11`.**
   `resetStep` keeps only `approved_by`. `finishStep` replaces the
   counts payload (does not `||` merge). `size` recycle SQL keeps
   `$2` as interested ids; the ICP pool's `$1` / `$2` shift to
   `$11` / `$12` so categories do not collide with `$2::int[]`
   (D69). The suppress CTE still names `$1::text` (the plan id)
   so Postgres can type that slot after the shift (D70).
22. **The website checker is a verb.** `site_check(question, …)` runs
   our own site fetch (free) and then a question over what the site
   says, on a job or a store `leftovers` named. `icp`: is each company
   in the client's ICP (the client's label set, Jev's pick; verdict per
   domain, which `icp(job_id)` stamps for free). `people`: crawl the
   homepage and the people pages, have Gemini list every person the site
   presents, and ask Jev which of them is `looking_for` (plain words;
   empty means the owner, or the person who runs the company). The
   people found stay in `topup.site_answers` / `site_people`.
   `count(source="site_owners", job_id)` is the dry-run;
   `pull(job_id, source="site_owners")` attaches them to this job's
   businesses only (place_id or normalized domain). Owners cached by an
   earlier check on those businesses belong to the job. Never pull the shared
   view `topup.site_people_found`. About $0.11 per 1,000 for `icp`, about $1.11 per 1,000 sites
   for `people`; estimate first, a name runs it; sites, people and
   answers are kept per domain so a re-run never pays twice. Nothing on
   the rows changes; counts, titles and at most ten sample domains come
   back, never a name (D71, D72). `people` fetch / extract / ask fan out
   (~50 fetch workers, 2 per host; ~28 Gemini and ~28 Jev; backoff on
   429/5xx; Gemini RPM limiter 200). A deploy kills the HTTP call;
   nothing starts on boot. Topup calls the same `site_check` again with
   the same scope and `approved_by`; already-extracted and
   already-answered domains are skipped (D73).
23. **getleads count maps every stored key.** Industries are official
   getleads names (LinkedIn commas map to semicolons). `company_description`
   and `purged_titles` (`exclude_job_titles`) are sent. An unmapped or
   unknown key fails; `filters_used` is exactly what was applied.
   `max_per_company`, `industries_by_campaign` and `over_1k_campaign`
   are honored when stored (D84; qualifies D43 / D74). `campaign_record` stamp counts are this
   campaign, not a shared build. `held` `net_new` is the pool minus
   held (this client's unsubscribes, hard bounces pending Josh, and
   the existing DNC list) as an exact full-list join, never a sampled
   page (D74, D80, D81).
24. **Operators read the build record before sizing or pulling a top-up.**
   `build_record(client_tag, campaign_id)` returns the matching
   `topup.list_build_records` rows (narrative, receipt_ids, campaign ids,
   transcript path). Read the narrative first. Fetch the transcript only
   for an edge case (`fetch_transcript` or `offset`/`limit`; the file can
   be large). Receipts stay the at-a-glance source of record. Read-only:
   no DDL, no write, no spend (D75, D86).
25. **Size the whole usable pool first.** Present every usable lead and
   the full cost. Do not stop at one 2,000-row batch. A job still pulls
   1 to 2,000 (D52); the approver cuts the pool by cost (D76).
26. **VALID email is a quality filter, not a TAM cap.** Count every
   email status. TAM = the receipt filters with `email_status` removed.
   Verify after the pull with MillionVerifier, then No2Bounce (D77).
27. **TAM cross-check.** Count GetLeads first, then AI Ark and Prospeo
   on a matched basis: exact titles, ICP industries mapped to each
   vendor's official names, same headcount bands, all email statuses,
   same max-per-company cap, same post-pull gates. Within 10%: TAM is
   right. More than 10% apart: GetLeads is the wrong source — use the
   one that fits. Dropping VALID or switching source is not widening
   (D78). Prospeo count is live (D83).
28. **Overlap sample.** Take about 50 people from the second source and
   join them against GetLeads / held (D79).
29. **Held / contacted / suppressed is an exact full-list join.** Never
    a sampled page (D80). `held` returns a `held_id` at once (`status`
    started); poll `held(held_id)`. The pool is a free chunked GetLeads
    export (0 credits, fair-use). Every `export_id` from a split is
    polled. A slice that outruns its deadline is `timeout`. A failed
    export names its class (`timeout`, `export_failed`, `fair_use`,
    `count_timeout`, `paid_export`). Never a paid export
    (`search_contacts` is 1 credit/row). If the only remaining path is
    paid, refuse and quote the exact cost. Addresses stay in memory
    (D97).
30. **Suppression is real unsubscribes only**, permanently, per client.
   The 6-month expiry is out (supersedes D63). Not-interested and other
   negatives are not suppressed. Every negative is classified
   `unsubscribe` vs `not_interested` and stored on `public.leads`
   (`negative_class`). Text and category first; AI only on the leftover
   via `classify_leftover` (D90). Future negatives classify as they
   arrive (trigger + the next `suppress`; text/category, no AI). Suppression
   views (`v_master_suppression`, `lp.reply_suppression`,
   `response_based_v1`) use only the unsubscribe class.
   `suppress` / `count` / `size` / `held` use per-client unsubscribes,
   hard bounces (kept pending Josh), and the existing DNC list.
   `public.sends.sender` records the sending inbox (migration 0024,
   unapplied). Never unsuppress anything in Smartlead itself (D81).
31. **Title filters are exact match** on GetLeads by default
    (`lower(current_title) IN (...)` on count and pull). Substring
    (`job_titles`) only when the receipt says `title_match=substring`.
    AI Ark counts use exact-title mode (`STRICT`) unless the receipt
    asks for substring (`WORD`) (D82).
32. **Prospeo is a count source.** `count(source="prospeo")` is page 1
   of search-person: 1 credit and `pagination.total_count`. No-result
   and 30-day repeat searches are free. About 1.5 cents per credit;
   estimate first, `approved_by` runs it. Map ICP industries to
   Prospeo's official names and flag inexact mappings (D83).
   Honor `industries_by_campaign` and `over_1k_campaign` (the receipt's
   stored 1001+ bands only). `max_per_company` stays on the answer;
   search-person does not apply it, so the count is uncapped (D84).
33. **Count honors** `max_per_company`, `industries_by_campaign` and
   `over_1k_campaign` when the receipt carries them, on every source
   (D84). Pass `campaign_id` when the industries map names more than
   one campaign. Getleads `count_contacts` still cannot take the cap
   (the API rejects the key); it stays on `filters_used`.
34. **Local-business owner finder.** `site_check("people")` (owner by
   default), then the email waterfall on the people found, then the
   generic inbox fallback (`info@` / `office@`, not `support@` /
   `payroll@`) (D85).
35. **A method Josh settles in chat** is written into this page and
   `DECISIONS.md` so every operator's bot follows it (D87).
36. **No self-initiated runs** on weekends or from 8pm to 6am CT unless
   Josh or Cayden asks live (D88).
37. **Cayden has full authority** over this service and this page: he
   can change, use or direct it however he wants (D89).
38. **Leftover-negative AI is `classify_leftover`.** Jev on OpenRouter
   Decisions — the same provider and vault secret (`openrouter_api_key`)
   icp-llm / site_check already use, model `ICP_JEV_MODEL`. No new
   vendor. A fixed prompt: explicit request to stop or remove =
   `unsubscribe`; anything else = `not_interested`; no inbound body
   stays unclassified. Estimate first; `approved_by` runs it. Hard cap
   $0.05. Writes `negative_class_source='ai'`. Idempotent (already
   classed rows are left alone). Counts only; bodies never return (D90).
   The OpenRouter key is `topup.jev_openrouter_key()` (security definer).
   The service never SELECTs `vault.decrypted_secrets`. leadtopup_app is
   not granted on schema vault (D91).
39. **Cayden is a full approver equal to Josh.** Paid steps, spend cards,
   and backfilled-filter confirmation accept `approved_by="Cayden"` the
   same as Josh. Ask strings say "Josh or Cayden". Owner wait status is
   `awaiting_owner` (`awaiting_josh` still counts). `confirm_filters`
   stamps `owner_confirmed_at` for either name and does not rewrite
   filters. Stored `industries_by_campaign` keys may be campaign ids or
   any non-id token on the stored map, matched as a word in the campaign
   name. No bucket list is hardcoded. Receipt-only keys such as `icp_gate` are stripped, not failed.
   A build whose lane does not match the campaign's registry lane is
   not attached to that campaign (D92).
40. **Owners attach by the job's places.** `count(source="site_owners",
   job_id)` is the free dry-run; `pull(job_id, source="site_owners")`
   writes first_name / last_name / title on this job's ingest rows.
   Scope is this job's `place_id`s and normalized domains. Owners cached
   by an earlier `site_check` on those businesses belong to the job. An
   owner whose domain or place is not on this job does not attach. It
   never opens a job, never reads `topup.site_people_found` or a client
   owner table, never another job or client, and does not abort or
   rewind the job (D93, D94).
41. **Replay the hand search.** The point of this service is to read the
   campaign's build record or receipt, rerun that same search, subtract
   what the client already holds with an exact full-list join, show net
   new plus cost, and pull / verify / stage on a named approval. Caller
   answers hide stamps, lane meta, key formats and sampling caps.
   `filters_applied` lists every filter that actually ran. `held` never
   samples and never falls back to a lane total. No per-client constants
   or canon steps (D95).
42. **The build transcript is the source of truth.** When a backfilled
   receipt disagrees with its matching `list_build_records` narrative or
   transcript, or is thinner than it, correct the receipt to match.
   That is a backfill fix, not widening. Diff first; `--apply` writes
   `company_filters` only. No per-client constants (D96).
43. **Skip registry lane `unassigned`.** It is a parking lot, not a
   top-up lane. Do not pull it. Do not retag stamps onto it or off it
   (D96).
44. **held is async and the pool export is a free chunked join.** The
    MCP call returns `held_id` at once. Background work splits the
    widest OR-list, starts a free export per slice, and polls every
    id. No sample, no lane total, no paid export (D97).
45. **A new rule is a new decision.** Append it to `DECISIONS.md`, fold it
   here, write a guard that names it. Ask Josh or Cayden (D-meta).

## The reads

Every read returns what Supabase and the vendors hold, with the rule it
bears on stated and no verdict (D52).

| Read | What it answers |
|---|---|
| `canon` | This page. Also the MCP server's instructions. |
| `campaigns(client_tag?, include_inactive?)` | Every ACTIVE email campaign: lifetime sends, positives, rate per 2,000, leads left, lane, `passes_reply_bar`, `never_top_up`. Cold call campaigns are left off. Registry lane `unassigned` is `never_top_up` (D96). |
| `campaign_record(client_tag, campaign_id)` | Every receipt (company, domain, person, email legs; `company_filters` as stored; build label; method note; yield; dates), the build rows, the stamped leads counted by label and by leg **for this campaign**, the registry row, lifetime numbers, the source vocabulary for the values seen, the notes. Receipts and builds whose lane does not match the campaign's registry lane are left off (D92). |
| `build_record(client_tag, campaign_id)` | The operator write-up of how this list was built (`topup.list_build_records`): narrative, receipt_ids, campaign ids, transcript path. Read the narrative first. Optional paged transcript text from the private `list-build-transcripts` bucket (`fetch_transcript`, `offset`/`limit`). The transcript / narrative is the source of truth when a backfilled receipt disagrees or is thinner (D96). Receipts stay the at-a-glance source of record after that fix. Read-only; no spend. |
| `sources` | The vocabulary: every value a receipt leg can carry, what it means, how to repeat it, what it costs. |
| `count(client_tag, source, filters, approved_by?, campaign_id?, job_id?)` | A count on `getleads` (free; exact titles by default via `lower(current_title) IN`, substring only when the receipt says `title_match=substring` (D82); every stored key is mapped or the call fails; honors `max_per_company`, `industries_by_campaign` and `over_1k_campaign` (D84); `industries_by_campaign` keys may be campaign ids or any non-id token on the stored map, matched as a word in the campaign name (D92, D93); `icp_gate` is receipt meta and is stripped (D92); `filters_used` is what the vendor received; `filters_applied` lists every filter that actually ran, including rewritten keys (D95); VALID is omitted — it is not a TAM cap (D77)), `ai_ark` (paid; needs `approved_by`; exact-title `STRICT` unless the receipt asks for substring), `maps` (the stored pool in `client_<tag>.maps_raw`, scoped by `plan_id` and categories; the named ICP view, or companion `v_*_companies` ∪ `v_*_needs_domain` joined to `maps_raw` for `plan_id` when those exist; on `v_lane_e_*` categories match `main_category` and schools are dropped; binds are typed; reports pool, already live, already ingested, already contacted, used as the union, and net new), `prospeo` (page 1 of search-person, 1 credit / about 1.5 cents; no-result and 30-day repeats are free; needs `approved_by`; industries mapped to official names with inexact flags; honors the same D84 receipt keys; search-person does not apply `max_per_company`, so that count is uncapped), `permits` with the filters you pass, or `site_owners` (free; pass `job_id`; this job's ingest rows by place_id or normalized domain; cached owners on those businesses belong to the job; never the shared owner view) (D94). Returns the number, every call, and the cost. Count every email status; VALID is not a TAM cap (D77). |
| `held(client_tag, campaign_id, filters, tam, days?)` | How much of a getleads pool the client already holds (per-client unsubscribes, hard bounces pending Josh, existing DNC list) as an **exact full-list join**, never a sampled page and never a lane-total fallback (D80, D81, D95, D97). Returns a `held_id` at once (`status` started); poll `held(held_id)`. Free chunked export; every split id is polled. A failed export names its class. Never a paid export. `net_new` is the pool minus that held count. Under 1,000: the TAM for this campaign is exhausted. |
| `size(client_tag, campaign_id, source, filters)` | Free dry-run of the stored Maps pool (plan_id + ICP view, same as `count`): already held, suppression drops by reason, net new. Pool binds are `$11` / `$12` so they do not collide with recycle `$2::int[]` (D69). The suppress CTE types `$1::text` so the first slot is not unused (D70). Returns a `size_id` at once (`status` started); poll `size(size_id)`. Opens no job, spends nothing, does not block the lane. Counts only. |
| `jobs(client_tag?, limit?)` | Recent jobs and runs with status, step, who opened it, spend. |
| `job(job_id)` | One job: its steps with counts, the per-campaign report, vendor calls, the spend cards waiting for a name, the last events. |
| `spend` | Today, thirty days by vendor, month to date, and every spend card waiting. |
| `leftovers(client_tag?)` | Where past pulls left rows that may never have been sent: the LeadPipe lane table by status and label, the client schema (companies, contacts, leads), the waterfall tables, the people-waterfall statuses, the scratch tables (estimates). Each store says how many rows have an email, a domain and a phone, and `gaps` says what the rest still need (`need_domain`, `need_person`, `need_email`, `need_phone`) with `next` naming the step that fills it. Counts only; reading it moves nothing. |
| `holds(client_tag?)` | Open cards: spend asks with the worst case, parked jobs, QA holds, stalls. |
| `loads_paused(paused?, by?)` | The global switch. While on, `import` refuses. Only a person flips it. |

## The verbs

Each verb runs one or two stages on a job, once, and returns counts.
Nothing chains. The job is one run row for one campaign (D52).

| Verb | Stage(s) | Notes |
|---|---|---|
| `pull(client_tag, campaign_id, source, filters, max_rows, …)` | pull, ingest | Opens the job and returns the `job_id` at once (`status` started). Pull and ingest run in the background; poll `job(job_id)`. A hang or throw ends `failed` with `last_error` (D62). `source` is `getleads`, `maps`, `permits`, `table` or `site_owners`. Maps copies the named ICP view or `maps_raw` into `lp.<tag>_ingested_leads` and skips held emails *before* `max_rows` (`already_held`). `site_owners` needs `job_id`: it attaches owners whose place_id or normalized domain is on this job's ingest rows and does not open a job or rewind one (D94). `max_rows` 1 to 2,000. Pass `job_id` to continue one. |
| `suppress(job_id)` | suppress | Per-client unsubscribes, hard bounces (pending Josh), and the existing DNC list (`public.suppression`). Classifies arriving negatives (text/category; no AI). Not-interested is not suppressed. Returns raw, dropped by reason, net new (D81). |
| `icp(job_id, approved_by?)` | icp | The ICP website gate: our own site fetch (free), Jev picks a category (about $0.11 per 1,000 sites), DiscoLike on the sites we could not read (about $0.0038 each). Estimate first; `approved_by` runs it. Writes `icp_gate` yes / no / unknown on every row; the label is a token from the allowed set, never Jev's raw sentence (unparseable → null + flag). The spend card is re-quoted when the estimate changes and records `actual_cents` on completion. No and unknown are suppressed with a reason. Rows with no domain are left: `enrich` then `icp` again. |
| `site_check(question, job_id \| client_tag + table, looking_for?, approved_by?)` | — | The website checker on a job or a store `leftovers` named: our own site fetch (free), then a question over what the site says. `icp` grades each company with the client's label set (Jev, about $0.11 per 1,000). `people` crawls the people pages, has Gemini list every person the site presents and asks Jev which of them is `looking_for` (about $1.11 per 1,000 sites); the people found stay in `topup.site_answers` / `site_people`. `count(source="site_owners", job_id)` then `pull(job_id, source="site_owners")` attaches them by this job's place_id or normalized domain (D94). First call: estimate and counts so far; `approved_by` runs it. A deploy does not resume it — call the same verb again. Kept per domain; nothing on the rows changes. Counts, titles, at most ten sample domains; never a name. |
| `classify_leftover(approved_by?)` | — | Leftover Smartlead negatives that text/category could not class. Jev (same OpenRouter path as icp-llm) reads each inbound body. Explicit stop/remove = unsubscribe; anything else = not_interested; no body stays unclassified. Estimate first; `approved_by` runs it. Hard cap $0.05. Writes `negative_class_source='ai'`. Idempotent. Counts only (D90). |
| `enrich(job_id, approved_by?, force?)` | puzzle, find_emails | Domains, people, emails through the waterfalls up to the job's max tier. Paid tiers estimate first. `approved_by` records the approval (once per step/approver/amount), closes the card, and runs the paid people waterfall. People and email waterfalls read `topup.<tag>_ingested_leads_ew` so `ew_read_source` sees `domain` (D67; apply 0021 first). The service never CREATE VIEW. A step that did not run (or processed 0 of N queued) is failed/blocked, not done. A pre-D64 false `done` with rows still queued is reopened and run (D65). `force=true` re-runs a done step. |
| `verify(job_id, approved_by?, force?)` | verify | MillionVerifier, then No2Bounce on catch-alls. Paid; estimate first. A recorded approval is reused on retry and is not added again. A third failure does not park. |
| `normalize(job_id, force?)` | normalize | Names, companies, locations, local sports team. Free. Empty company is filled from `client_<tag>.maps_raw.name` joined on email (D67). The hold reads `company_n`, not the empty raw `company_name` (D68). `City, ST` in city is split before geocode. Role-inbox `title` fill is the fallback. `first_name_fallback` is optional and off by default. Re-runs this job's merge-field holds. Reopens when the stored `rules_hash` is stale or `force=true`. |
| `qa(job_id)` | qa | Every merge field populated or the row is held. Hold counts are this job only. Holds show in `holds`. |
| `stage(job_id)` | route, stage | Rows routed to the campaign and staged. |
| `import(job_id, approved_by?)` | import, post_import | Through LeadPipe into Smartlead. Refuses while `loads_paused`. Never sets ACTIVE. |
| `write_receipt(job_id, company_source, …, how_i_did_it)` | — | The receipt the next top-up reads. The four legs, `company_filters`, the note. |
| `confirm_filters(receipt_id, approved_by)` | — | Stamp `owner_confirmed_at` on a backfill receipt. Josh or Cayden only (D92). Does not rewrite filters. |
| `abort(job_id)` | — | Stops the job, releases claimed rows, closes its cards. |
| `resolve(card_id, choice)` | — | Resolve a card by id: a QA hold (`accept`, `purge`, `reroute`), a parked job (`resume_run`), `abort`. Spend needs the owner token or `approved_by` on the verb. |
| `note(client_tag, lane, line, next_intent?)` | — | One line in the lane's event log. No lead data. |

Order: `pull` → `suppress` → `icp` → `enrich` → `verify` → `normalize` →
`qa` → `stage` → `import` → `write_receipt`. Each answer says what to
call next.

## How to top up a campaign

Replicate the hand search. Do not reason about stamps, lane meta, key
formats, or sampling caps (D95).

1. Read `campaign_record` or `build_record`. Take the exact filters,
   titles, industries, headcount and source. A missing field is a
   question, not a guess. Read the narrative first; fetch the transcript
   only for an edge case. Receipts stay the at-a-glance source of record
   (D75, D86). Keep campaigns that pass the reply bar; skip the rest in
   one line, including any registry lane `unassigned` (D96). After `site_check("people", job_id)`,
   `count(source="site_owners", job_id)` then
   `pull(job_id, source="site_owners")` attaches the people found
   on this job's places (place_id or normalized domain) (D94).
2. Rerun that same search with `count`. Size the **whole usable pool**
   first (D76). Every email status (VALID is a quality filter, not a TAM
   cap) (D77). `filters_applied` lists every filter that actually ran.
   Cross-check AI Ark and Prospeo on a matched basis; within 10% the TAM
   is right; more than 10% apart means switch source (D78). Take about
   50 people from the second source against GetLeads / held (D79).
3. `held` subtracts what this client already holds as an **exact
   full-list join**, never a sample and never a lane total (D80, D95,
   D97). It returns a `held_id` at once; poll `held(held_id)`. Under
   1,000 net new: *the TAM for this campaign is exhausted*. Do not
   widen.
4. Show net new and the full cost. The approver cuts by cost (D76).
5. On a named approval: `pull` (1 to 2,000) → `suppress` → `icp` →
   `enrich` → `verify` → `normalize` → `qa` → `stage`. `import` only when
   `loads_paused` is off and a person said yes. `write_receipt` with the
   legs and one plain sentence. Josh flips ACTIVE. No self-initiated run
   on a weekend or 8pm–6am CT unless Josh or Cayden asked live (D88).

## Source vocabulary (short)

`company_source`: `getleads`, `ai_ark`, `maps` (stored pool by `plan_id`, D57), `permits`,
`maps_and_permits`, `linkedin_import`, `table`, and the signal sources
(`serp_tool_mention`, `theirstack_tech_signal`, `job_posting_signal`,
`linkedin_engagers`, `web_visitor_pixel`). `domain_source`: `already`,
`domain_waterfall`, `site_scrape`. `person_source`: `getleads`,
`people_waterfall`, `site_staff`, `serp`. A stored
`leadmagic_employee_finder` is legacy and maps to `people_waterfall`
(D58). `email_source`: `getleads`,
`email_waterfall`, `name_to_email`, `site_scrape`, `already`. A stored
`email_max_tier=leadmagic` maps to `aiark`. `sources`
has the full lines. A value not in the vocabulary is unknown; ask Josh or Cayden.

## Never

* Never pull a lead row, an email, a name or a file into context. No
  `export_contacts`, no `get-dataset-items`, no `find_dms_by_title`, no
  SELECT of `email`, `first_name`, `last_name`, `phone`, `linkedin_url`.
* Never spawn child agents to fire GetLeads. Never set a Grok routine that
  re-reads lists.
* Never invent a filter, a price, a threshold or a source the record does
  not carry. Never drop `plan_id` from a maps count or pull, and never
  scope that pool by ZIP or `client_tag` alone (D57). Never send an
  untyped `$1` on a maps ICP count (D59). Never copy maps through the
  companion-view join (D62). A maps insert that hits an email already
  in `lp.<tag>_ingested_leads` skips it as `already_held` (D61, D62).
  Never leave a background pull at `running` with empty counts and no
  `last_error` (D62). Never apply `max_rows` before skipping held maps
  emails (D64). Never mark a paid step done when it did not run (D64).
  Never store Jev's raw sentence as an ICP label (D64). Never add the
  same approval twice (D65). Never count a QA hold across the lane
  table or by empty-field array length (D65). Never refuse enrich when
  a step was marked done with rows still queued (D65).   Never hold a
  Lane E role-inbox for a missing company when the Maps name is there
  (D65). Never invent a greeting; `first_name_fallback` stays off
  until Josh sets it (D65). Never hand `lp.<tag>_ingested_leads` to
  `ew_read_source` without a `domain` column — use the `_ew` view
  (D66, D67). Never CREATE / DROP / ALTER at runtime, and never GRANT
  on schema `lp` (D67). Never skip a normalize whose `rules_hash` is
  stale (D66). Never ALTER a live lane table to add `domain` (D66).
  Never pick the first existing Maps column for company when a later
  one holds the business name (D67). Never hold a filled `company_n`
  because the check read empty `company_name` (D68). Never geocode
  the raw `City, ST` city column (D68). Never skip the receipt
  categories on a lane E ICP union, and never leave preschool
  through high school on lane E (D68). Never merge a rerun's step
  counts over stale `held_*` keys (D69). Never bind size's ICP
  categories as `$2` — that slot is interested ids; pool binds start
  at `$11` (D69). Never leave size `$1` untyped after that shift
  (D70). Never drop a stored getleads filter (a comma industry,
  `company_description`, `purged_titles`) and never count
  `lead_provenance` across twin campaigns that share a build (D74).
  Never drop `max_per_company`, `industries_by_campaign` or
  `over_1k_campaign` from a count when the receipt carries them (D84).
  Never size or pull a top-up without reading the build record
  (narrative first; transcript only for an edge case). Never CREATE /
  DROP / ALTER `list_build_records`, never write that table, never
  return a signed URL for a transcript, and never fetch a storage path
  that is not on a matching row (D75, D86). Never stop a size at one
  2,000 batch (D76). Never treat VALID as a TAM cap (D77). Never call
  dropping VALID or switching the matched source "widening" (D78).
  Never subtract held from a sampled page (D80). Never suppress
  not-interested. Never treat Smartlead category Do Not Contact as an
  unsubscribe. Never expire an unsubscribe at 6 months. Never
  unsuppress in Smartlead. Never run the negative-class AI leftover
  without a name. Never apply `0024_sends_sender.sql` or
  `0025_d81_negative_class.sql` until Josh says so. Never write
  `dl_status`, `sg_exclude`, or `skip_*` (D81). Never run
  `classify_leftover` without a name, never over the $0.05 hard cap,
  never invent a Jev prompt, never classify an empty body, never add
  a new LLM vendor (D90). Never SELECT `vault.decrypted_secrets` from
  this service. Never grant leadtopup_app on schema vault (D91). Never
  refuse Cayden as an approver on a paid step or a backfill-filter
  confirm. Never treat `awaiting_josh` as unknown after `awaiting_owner`
  exists. Never fail `industries_by_campaign` when the stored key is a
  bucket word in the campaign name. Never fail a getleads parse on
  `icp_gate`. Never attach a receipt or build whose lane does not match
  the campaign's registry lane (D92). Never read the shared owner table
  (`topup.site_people_found` or a client owner table) across clients.
  Never attach site_check people without job_id and a place_id or
  normalized domain on this job (D94). Never attach an owner whose domain or place is not on this job.
  Never sample held and never fall back to a lane total (D95).
  Never wait on a synchronous held export. Never poll only the first
  export_id of a split. Never use a paid GetLeads export or
  `search_contacts` for held. Never hide the export error class (D97).
  Never hide a filter that actually ran from `filters_applied` (D95).
  Never put a client fact, a per-client constant or a per-client canon
  step on this page (D95). Never leave a backfilled receipt in place
  when its matching transcript or narrative disagrees or is thinner
  (D96). Never call that correction widening (D96). Never retag stamps
  onto or off registry lane unassigned, and never pull a campaign on
  that lane (D96). Never start a run on a weekend or
  8pm–6am CT unless Josh or Cayden asked live (D88). Never send
  GetLeads `job_titles` as a substring match unless the receipt asks
  for `title_match=substring` (D82). Never count AI Ark titles in
  WORD mode when the receipt did not ask for substring (D82).
* Never widen a pool unasked. Never top up a campaign under the bar.
* Never run a paid call without a name. Never import while loads are
  paused. Never call LeadMagic (D58).
* Never read a name out of `topup.site_people` or `site_people_found`
  into chat; `site_check` returns counts, titles and domains, and a
  table pull moves the rows (D72).
* Never start `site_check` on boot after a deploy. Resume is the same
  verb with the same scope and `approved_by`; skip `site_extractions`
  and `site_answers` that already landed (D73).
* Never start, pause, stop, edit or delete a Smartlead campaign. The
  service never sets a campaign ACTIVE.

## Where things are

* Service: `https://leadtopup-production.up.railway.app` (`/health`, `/mcp`).
* Data: Supabase `azpapwtnrbzywlnxxecz`, schema `topup` (`runs`,
  `run_steps`, `cards`, `spend_ledger`, `pull_receipts`,
  `campaign_builds`, `campaign_registry`, `client_map`,
  `lead_provenance`, `lane_events`, `list_build_records`) and private
  Storage bucket `list-build-transcripts`.
* Code: `src/canon` (the reads), `src/jobs` (the verbs), `src/stages` (the
  twelve stages), `src/console` (cards and roles), `src/spend` (the gate
  and the ledger), `src/mcp` (the surface), `src/guards` (the tests that
  name a decision).
* Skills: `skills/grok-bot-babysitter` (Grok's standing orders),
  `skills/leadpipe`, `skills/supabase-csv-endpoint` (how rows move).
