# Canon — how a campaign gets topped up

Canon as of **D104** (2026-10-13). One page. `DECISIONS.md` is the append-only
ledger of why; this page is what is true now. When a decision lands, this
page changes in the same PR; `src/guards/meta.test.ts` enforces both.

## What this is

A campaign runs low. Grokbot reads how that campaign's list was built,
builds more of the same people the same way with its own connectors, and
hands the pool to this service. The service removes everyone the client
already has and every real unsubscribe, shows the approver the new-lead
count and the cost, waits for a yes, runs the website ICP check and
verification, and loads the campaign. Josh flips ACTIVE by hand.

Grokbot does the building. The service is the referee and the loader. It
never decides what to pull, never starts on its own, never spends without
a person's name, and never touches a campaign's status.

## Connect first

At the start of every session call `connectors(have=[your tool list])`.
Required, three: **Top_Up** (`https://leadtopup-production.up.railway.app/mcp`,
no login), **Supabase** (campaignintelligence `azpapwtnrbzywlnxxecz`),
**getleads**. LeadPipe, verification and the Smartlead import are the
service's own calls, with its own keys; you attach nothing for them and
never call LeadPipe yourself. Needed only when a transcript uses them: Email Finder Waterfall, AI Ark,
Google Maps Scraper, Domain Finder Waterfall, Find Named Person, DiscoLike,
Apify, PermitStack, FullEnrich, Prospeo. A required connector that is
missing stops the top-up: tell Josh which to attach in Grokbot and wait.
A transcript or a process change that names a tool you do not have: same,
ask Josh to connect it, then continue.

## The hard rules

1. **Every lead row moves through this service and LeadPipe.** You hand
   `topup` the vendor's signed export URL or a table name; the service runs
   LeadPipe, and keeps the people LeadPipe drops for having no email so the
   email finder can look them up (D103). Never SELECT emails, names or
   phones; never read an export, a dataset or a CSV into chat; never paste
   a row. Count, never read (D2, D39, D99).
2. **A named approver says yes to every spend before it runs.** Who may
   approve is a Railway setting (`TOPUP_APPROVERS`; Josh alone for now;
   Josh and Cayden by default, D92).
   The auto cap is $0. `topup` quotes first; `topup(job_id, approved_by)`
   runs. A yes is to an amount: a step priced more than a tenth above the
   quote stops and asks again with the new number (D51, D101). There is no
   daily cap: whatever the approver says yes to is the limit (D104). A
   parked step waits for a named `topup(job_id, approved_by)`; nothing
   re-runs it on its own.
3. **Nothing starts on its own.** No watch, no cron, no routine that
   re-reads lists. You call the next tool or nothing moves (D51, D88).
4. **The transcript is the truth.** Replay the recorded build: the same
   tools, filters, titles, geography and sources. Apply the process changes
   written since it on top (new sources, new checks). Never widen unasked.
   No recorded build means wait for Josh (D96, D99).
5. **Josh flips ACTIVE by hand.** The service never starts, pauses, stops,
   deletes, creates or edits a campaign in Smartlead (D5, D6, D14).
6. **Counts and ids, never rows.** In chat, cards, logs and records (D2).
7. **Only campaignintelligence.** Secrets live in Railway (D3, D6).
8. **Never top up** SG Nurture (3122546); **ignore any cold-call campaign**
   (Cold Call, Gabe Calls, Cayden Calls, Post-call) (D46, D54).
9. **Under 1,000 new leads after dedupe** the quote says the floor is not
   met (D46): tell the approver the count, the cost and that it is under
   the floor; they decide (D102). A campaign under **one positive reply per
   2,000 sends** is not topped up (D11).
10. **A new rule is a new decision.** Append it to `DECISIONS.md`, fold it
    in here, write a guard (D46).

## The loop

1. `connectors(have)`, then `canon`. Fix what is missing.
2. `campaigns()`: find the low one (untouched under about two weeks of
   sends, passing the reply bar, not cold call, not never-top-up).
3. `playbook(client_tag)`: every list build, disqualification and method
   change for this client, in order, with `list-build-transcripts` object
   names. Then `build_record(client_tag, campaign_id)`: the narrative, the
   method as the ordered tool calls, what the person asked, and
   `process_changes_since_build`. `no_recorded_build` → stop and wait.
4. Replay it with your own connectors. Count, then run the vendor's
   server-side export (getleads `export_contacts` then
   `check_contact_export` until it hands back a signed URL), or build a
   scratch table in SQL on campaignintelligence. Export without the
   `email_status` VALID filter: the people a vendor has no email for come
   along and the service finds their emails after the yes (D103). You end
   with a pool as a signed file URL or a `schema.table`. No row enters
   this chat.
5. `topup(client_tag, campaign_id, source)`. Poll `job(job_id)`. The quote
   says how many new leads are left after everyone the client already holds
   and the unsubscribes (with an email, and with none yet), and the most it
   can cost (website ICP check, email finder, verification). Tell the approver those two numbers (the answer names
   them). Under 1,000 net new the answer says so: that is the exhausted
   line (D46); the approver decides.
6. When the approver says yes: `topup(job_id, approved_by="their name")`.
   Poll `job(job_id)` to `done`. A restart does not lose a job: the
   service picks it back up on boot, and `topup(job_id)` with no name
   shows where it stands. Loads start paused (D102): the approved job
   stops at `staged` until an approver calls
   `loads_paused(paused=false, by="their name")`, then `load(job_id)`.
   Then stop. Josh flips ACTIVE.

## The tools

`canon` `connectors` `campaigns` `playbook` `build_record` `topup` `load`
`job` `jobs` `spend` `abort` `loads_paused`. Nothing else is registered.
None returns a lead row or a file URL.

## Where things are

Build records and transcripts: `topup.list_build_records` and the private
bucket `list-build-transcripts` (read through `playbook` and `build_record`).
The living per-client playbook is the view `topup.client_playbook` (D100).
Process changes: `topup.process_changes`. Jobs: `topup.runs`, `run_steps`,
`cards`, `spend_ledger`, `lane_events`. The pool lands in
`lp.<tag>_ingested_leads` and moves to `public.leads_staging`, then Smartlead
through the Smartlead server's `start_lead_import`. The website ICP check
reads one label set per client in `topup.icp_variants`; a client without
one cannot be approved until Josh writes it (D102). The service writes its
own top-up into `topup.list_build_records` when it loads.
