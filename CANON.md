# Canon — the rules Grok bot works by

Canon as of **D55** (2026-10-09). One page. `DECISIONS.md` is the append-only
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
   the next verb or nothing moves (D51, D53).
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
10. **A new rule is a new decision.** Append it to `DECISIONS.md`, fold it
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
| `count(client_tag, source, filters, approved_by?)` | A count on `getleads` (free), `ai_ark` (paid; needs `approved_by`), `maps` (the stored pool) or `permits` with the filters you pass. Returns the number, every call, the cost. |
| `held(client_tag, campaign_id, filters, tam, days?)` | How much of a getleads pool the client already holds, and `net_new`. Under 1,000: the TAM for this campaign is exhausted. |
| `jobs(client_tag?, limit?)` | Recent jobs and runs with status, step, who opened it, spend. |
| `job(job_id)` | One job: its steps with counts, the per-campaign report, vendor calls, the spend cards waiting for a name, the last events. |
| `spend` | Today, thirty days by vendor, month to date, and every spend card waiting. |
| `leftovers(client_tag?)` | Where past pulls left rows that may never have been sent: the LeadPipe lane table by status and label, the client schema (companies, contacts, leads) with email and domain counts, the waterfall tables, the people-waterfall statuses, the scratch tables (estimates). Counts only; reading it moves nothing. |
| `holds(client_tag?)` | Open cards: spend asks with the worst case, parked jobs, QA holds, stalls. |
| `loads_paused(paused?, by?)` | The global switch. While on, `import` refuses. Only a person flips it. |

## The verbs

Each verb runs one or two stages on a job, once, and returns counts.
Nothing chains. The job is one run row for one campaign (D52).

| Verb | Stage(s) | Notes |
|---|---|---|
| `pull(client_tag, campaign_id, source, filters, max_rows, …)` | pull, ingest | Opens the job. `source` is `getleads`, `maps`, `permits` or `table`. `max_rows` 1 to 2,000. Pass `job_id` to continue one. |
| `suppress(job_id)` | suppress | Response-based global list, the client's prior contacts (90 days), bounces, the public list, the client's domain list. Returns raw, dropped by reason, net new. |
| `enrich(job_id, approved_by?)` | puzzle, find_emails | Domains, people, emails through the waterfalls up to the job's max tier. Paid tiers estimate first. |
| `verify(job_id, approved_by?)` | verify | MillionVerifier, then No2Bounce on catch-alls. Paid; estimate first. |
| `normalize(job_id)` | normalize | Names, companies, locations, local sports team. Free. |
| `qa(job_id)` | qa | Every merge field populated or the row is held. Holds show in `holds`. |
| `stage(job_id)` | route, stage | Rows routed to the campaign and staged. |
| `import(job_id, approved_by?)` | import, post_import | Through LeadPipe into Smartlead. Refuses while `loads_paused`. Never sets ACTIVE. |
| `write_receipt(job_id, company_source, …, how_i_did_it)` | — | The receipt the next top-up reads. The four legs, `company_filters`, the note. |
| `abort(job_id)` | — | Stops the job, releases claimed rows, closes its cards. |
| `resolve(card_id, choice)` | — | Resolve a card by id: a QA hold (`accept`, `purge`, `reroute`), a parked job (`resume_run`), `abort`. Spend needs the owner token or `approved_by` on the verb. |
| `note(client_tag, lane, line, next_intent?)` | — | One line in the lane's event log. No lead data. |

Order: `pull` → `suppress` → `enrich` → `verify` → `normalize` → `qa` →
`stage` → `import` → `write_receipt`. Each answer says what to call next.

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
   Any other key stays as stored.
4. `held(client_tag, campaign_id, filters, tam)` with that count. If
   `net_new` is under 1,000, say *the TAM for this campaign is exhausted*
   and stop. Do not widen. If Josh wants options, give counts for each.
5. Tell Cayden or Josh what you will pull and what it will cost. When one
   of them says yes, `pull(...)` with `max_rows` 1 to 2,000.
6. `suppress`, `enrich`, `verify`, `normalize`, `qa`, `stage` in order.
   When a verb returns `waiting_approval`, name the worst case to a person
   and call it again with `approved_by="Their name"`. When a verb parks,
   read `job(job_id)`, fix or `abort`.
7. `import` only when `loads_paused` is off and a person said yes.
8. `write_receipt` with the legs and filters you used and one plain
   sentence on how.
9. Post counts and ids. Josh flips ACTIVE.

## Source vocabulary (short)

`company_source`: `getleads`, `ai_ark`, `maps`, `permits`,
`maps_and_permits`, `linkedin_import`, `table`, and the signal sources
(`serp_tool_mention`, `theirstack_tech_signal`, `job_posting_signal`,
`linkedin_engagers`, `web_visitor_pixel`). `domain_source`: `already`,
`domain_waterfall`, `site_scrape`. `person_source`: `getleads`,
`people_waterfall`, `site_staff`, `serp`. `email_source`: `getleads`,
`email_waterfall`, `name_to_email`, `site_scrape`, `already`. `sources`
has the full lines. A value not in the vocabulary is unknown; ask Josh.

## Never

* Never pull a lead row, an email, a name or a file into context. No
  `export_contacts`, no `get-dataset-items`, no `find_dms_by_title`, no
  SELECT of `email`, `first_name`, `last_name`, `phone`, `linkedin_url`.
* Never spawn child agents to fire GetLeads. Never set a Grok routine that
  re-reads lists.
* Never invent a filter, a price, a threshold or a source the record does
  not carry.
* Never widen a pool unasked. Never top up a campaign under the bar.
* Never run a paid call without a name. Never import while loads are
  paused.
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
