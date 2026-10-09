# Canon — the rules Grok bot works by

Canon as of **D64** (2026-10-09). One page. `DECISIONS.md` is the append-only
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
    records `actual_cents` on completion. Maps `count` used/net-new is
    the union of already-live, already-ingested and already-contacted
    (90-day this client + suppression), each reported. `size` is the
    free dry-run of that pool plus suppression by reason; it opens no
    job. `lp_export` reads `result.signed_url` / `result.row_count`. A
    verify retry uses a recorded approval and does not park on a third
    failure (D64).
15. **A new rule is a new decision.** Append it to `DECISIONS.md`, fold it
   here, write a guard that names it. Ask Josh (D-meta).

## The reads

Every read returns what Supabase and the vendors hold, with the rule it
bears on stated and no verdict (D52).

| Read | What it answers |
|---|---|
| `canon` | This page. Also the MCP server's instructions. |
| `campaigns(client_tag?, include_inactive?)` | Every ACTIVE email campaign: lifetime sends, positives, rate per 2,000, leads left, lane, `passes_reply_bar`, `never_top_up`. Cold call campaigns are left off. |
| `campaign_record(client_tag, campaign_id)` | Every receipt (company, domain, person, email legs; `company_filters` as stored; build label; method note; yield; dates), the build rows, the stamped leads counted by label and by leg, the registry row, lifetime numbers, the source vocabulary for the values seen, the notes. |
| `sources` | The vocabulary: every value a receipt leg can carry, what it means, how to repeat it, what it costs. |
| `count(client_tag, source, filters, approved_by?)` | A count on `getleads` (free), `ai_ark` (paid; needs `approved_by`), `maps` (the stored pool in `client_<tag>.maps_raw`, scoped by `plan_id` and categories; the named ICP view, or companion `v_*_companies` ∪ `v_*_needs_domain` joined to `maps_raw` for `plan_id` when those exist; binds are typed; reports pool, already live, already ingested, already contacted, used as the union, and net new) or `permits` with the filters you pass. Returns the number, every call, the cost. |
| `held(client_tag, campaign_id, filters, tam, days?)` | How much of a getleads pool the client already holds, and `net_new`. Under 1,000: the TAM for this campaign is exhausted. |
| `size(client_tag, campaign_id, source, filters)` | Free dry-run of the stored Maps pool (plan_id + ICP view, same as `count`): already held, suppression drops by reason, net new. Opens no job, spends nothing, does not block the lane. Counts only. |
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
| `pull(client_tag, campaign_id, source, filters, max_rows, …)` | pull, ingest | Opens the job and returns the `job_id` at once (`status` started). Pull and ingest run in the background; poll `job(job_id)`. A hang or throw ends `failed` with `last_error` (D62). `source` is `getleads`, `maps`, `permits` or `table`. Maps copies the named ICP view or `maps_raw` into `lp.<tag>_ingested_leads` and skips held emails *before* `max_rows` (`already_held`). `max_rows` 1 to 2,000. Pass `job_id` to continue one. |
| `suppress(job_id)` | suppress | Response-based global list, the client's prior contacts (90 days), bounces, the public list, the client's domain list. Returns raw, dropped by reason, net new. |
| `icp(job_id, approved_by?)` | icp | The ICP website gate: our own site fetch (free), Jev picks a category (about $0.11 per 1,000 sites), DiscoLike on the sites we could not read (about $0.0038 each). Estimate first; `approved_by` runs it. Writes `icp_gate` yes / no / unknown on every row; the label is a token from the allowed set, never Jev's raw sentence (unparseable → null + flag). The spend card is re-quoted when the estimate changes and records `actual_cents` on completion. No and unknown are suppressed with a reason. Rows with no domain are left: `enrich` then `icp` again. |
| `enrich(job_id, approved_by?)` | puzzle, find_emails | Domains, people, emails through the waterfalls up to the job's max tier. Paid tiers estimate first. `approved_by` records the approval, closes the card, and runs the paid people waterfall. A step that did not run (or processed 0 of N queued) is failed/blocked, not done. |
| `verify(job_id, approved_by?)` | verify | MillionVerifier, then No2Bounce on catch-alls. Paid; estimate first. A recorded approval is reused on retry; a third failure does not park. |
| `normalize(job_id)` | normalize | Names, companies, locations, local sports team. Free. |
| `qa(job_id)` | qa | Every merge field populated or the row is held. Holds show in `holds`. |
| `stage(job_id)` | route, stage | Rows routed to the campaign and staged. |
| `import(job_id, approved_by?)` | import, post_import | Through LeadPipe into Smartlead. Refuses while `loads_paused`. Never sets ACTIVE. |
| `write_receipt(job_id, company_source, …, how_i_did_it)` | — | The receipt the next top-up reads. The four legs, `company_filters`, the note. |
| `abort(job_id)` | — | Stops the job, releases claimed rows, closes its cards. |
| `resolve(card_id, choice)` | — | Resolve a card by id: a QA hold (`accept`, `purge`, `reroute`), a parked job (`resume_run`), `abort`. Spend needs the owner token or `approved_by` on the verb. |
| `note(client_tag, lane, line, next_intent?)` | — | One line in the lane's event log. No lead data. |

Order: `pull` → `suppress` → `icp` → `enrich` → `verify` → `normalize` →
`qa` → `stage` → `import` → `write_receipt`. Each answer says what to
call next.

## How to top up a campaign

1. `canon` once. Then `campaigns(client_tag)`. Keep the ones with
   `passes_reply_bar` true and `never_top_up` false. Skip the rest and say
   why in one line.
2. `campaign_record(client_tag, campaign_id)`. Find where most of the leads
   came from: the receipt or build with the most `rows_imported`, and the
   `leads_by_leg` counts. Those four legs and that `company_filters` are
   the method. Read `how_i_did_it` and `notes`. A missing leg or an empty
   `company_filters` is a question for Josh, not a guess. `leftovers(client_tag)`
   shows rows earlier pulls left in the stores; name the store to the person
   who approves before reusing one.
3. `count(client_tag, source, filters)` with the filters from that record.
   getleads is free. BCP-style records keep industries per campaign under
   `industries_by_campaign`; pass that campaign's list as `industries`.
   Any other key stays as stored. Maps keeps `plan_id` and the categories
   list; it never scopes by ZIP or `client_tag` alone (D57). Companion
   views that omit `plan_id` join `maps_raw` so `$1::text` is used (D59).
   Maps used/net-new includes already-ingested and this-client prior
   contact/suppression (D64). `size` is the free dry-run of that pool.
4. `held(client_tag, campaign_id, filters, tam)` with that count. If
   `net_new` is under 1,000, say *the TAM for this campaign is exhausted*
   and stop. Do not widen. If Josh wants options, give counts for each.
5. Tell Cayden or Josh what you will pull and what it will cost. When one
   of them says yes, `pull(...)` with `max_rows` 1 to 2,000. It returns the
   `job_id` at once; poll `job(job_id)` until pull is done or failed
   (D61, D62). If it failed, read `last_error` and stop.
6. `suppress`, `icp`, `enrich`, `verify`, `normalize`, `qa`, `stage` in
   order. After `icp`, read the label counts in `job(job_id)`: if one
   label swallows a big share, the label set is wrong; say so and stop.
   When a verb returns `waiting_approval`, name the worst case to a person
   and call it again with `approved_by="Their name"`. When a verb parks,
   read `job(job_id)`, fix or `abort`.
7. `import` only when `loads_paused` is off and a person said yes.
8. `write_receipt` with the legs and filters you used and one plain
   sentence on how.
9. Post counts and ids. Josh flips ACTIVE.

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
has the full lines. A value not in the vocabulary is unknown; ask Josh.

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
  Never store Jev's raw sentence as an ICP label (D64).
* Never widen a pool unasked. Never top up a campaign under the bar.
* Never run a paid call without a name. Never import while loads are
  paused. Never call LeadMagic (D58).
* Never start, pause, stop, edit or delete a Smartlead campaign. The
  service never sets a campaign ACTIVE.

## Where things are

* Service: `https://leadtopup-production.up.railway.app` (`/health`, `/mcp`).
* Data: Supabase `azpapwtnrbzywlnxxecz`, schema `topup` (`runs`,
  `run_steps`, `cards`, `spend_ledger`, `pull_receipts`,
  `campaign_builds`, `campaign_registry`, `client_map`,
  `lead_provenance`, `lane_events`).
* Code: `src/canon` (the reads), `src/jobs` (the verbs), `src/stages` (the
  twelve stages), `src/console` (cards and roles), `src/spend` (the gate
  and the ledger), `src/mcp` (the surface), `src/guards` (the tests that
  name a decision).
* Skills: `skills/grok-bot-babysitter` (Grok's standing orders),
  `skills/leadpipe`, `skills/supabase-csv-endpoint` (how rows move).
