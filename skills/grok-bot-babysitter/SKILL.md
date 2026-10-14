---
name: grok-bot-babysitter
description: Standing orders for the Lead Top Up Grokbot. Use on every Grokbot turn in this repo. Grokbot does the building — it reads how a campaign's list was built, replays that build with its own connectors, hands the pool (a signed file URL or a table) to the Top_Up service, which runs it through LeadPipe, shows the approver the count and the cost, and runs the approved load. It never pulls a lead row into context.
---

# Grokbot does the building; the service is the referee (D39, D53, D99)

Josh, 2026-09-24: "I nuked our grok bot usage again trying to do lead top up."
Josh, 2026-10-13: "It needs to run things through LeadPipe 100% of the
time. It should not pull anything into the context."

So: you read the record, you replay it, you hand the pool over, you ask a
person, you call the next tool. You stop. Rows move **MCP → Supabase →
LeadPipe → Smartlead**. They never enter this context.

## Start every session the same way

1. `connectors(have=[your tool list])`. Required: Top_Up, Supabase,
   getleads. LeadPipe, verification and the Smartlead import are the
   service's own calls; you attach nothing for them and never call
   LeadPipe yourself.
   Missing one → tell Josh what to attach in Grokbot (the answer carries
   each custom MCP's Railway HTTPS address) and wait. A transcript or a
   process change that names a connector you do not have → same.
2. `canon`. One page. Those are the rules.

## The loop

1. `campaigns()`: the low lane (untouched under about two weeks of
   sends, passing one positive per 2,000, not cold call, not SG Nurture).
   The answer rolls campaigns up by lane and shows the lane runway
   (STOPPED is out of the sum). Size the lane, not one segment. How the
   lane splits into its campaigns is read from the lane's build transcript
   and sits on its record (D106); it is the truth the way the build is and
   quotes on its own, nobody confirms it (D107). A lane whose record has no
   split, or a question the transcript does not answer: never guess, never
   write a split yourself; ask Josh one plain-English question.
2. `playbook(client_tag)`. The living how-we-build for this client: every
   list build, disqualification and method change in chronological order,
   plus transcript object names in `list-build-transcripts`. Then
   `build_record(client_tag, campaign_id)`. Read `asked` (what Josh
   wanted), `method.steps` (every tool call in order with its arguments),
   `process_changes_since_build` (what changed about how lists are built
   since; apply it on top, e.g. a newer TAM check or a new source).
   `no_recorded_build: true` → stop; tell Josh the campaign has no
   recorded build.
3. Replay the lane's search once with your connectors. Same tools, same filters, titles,
   geography, sources. Counts first (`count_contacts`, SQL `count(*)`),
   then the vendor's server-side export (`export_contacts`, then
   `check_contact_export` until it hands back a signed URL) or a scratch
   table you build in SQL on campaignintelligence. Export without the
   `email_status` VALID filter, even where the transcript used it: the
   people with no email come along and the service looks them up after the
   yes (D103). Still report gross and VALID counts. Never widen. Never `SELECT email`, never
   `export_contacts` into chat, never `get-dataset-items`, never
   `find_dms_by_title`, never read a CSV. You end with a signed file URL
   or a `schema.table` name.
4. `topup(client_tag, lane, source)` (or `campaign_id`, which points at
   its lane) then `job(job_id)` until
   `quoted`. Say to the approver the answer names: "`N` new leads with an
   email for lane X after everything you hold and unsubscribes, plus `M`
   more with no email that the finder will look up; up to `$X` (website ICP
   check, email finder, verification)." Only the emails it finds are
   verified and loaded (D103). Under 1,000 new the answer says so: tell
   them it is under the floor (D46); they decide (D102). If the service
   says the split cannot be determined, stop and tell Josh; do not guess.
5. When the approver says yes: `topup(job_id, approved_by="their name")`.
   Only the names the service lists count. `job(job_id)` until `done`.
   If it answers `waiting_approval` with a higher number, say that number
   and call again with the name once they say yes to it.
   Loads start paused (D102): `staged` → an approver's
   `loads_paused(paused=false, by="their name")`, then `load(job_id)`.
6. Stop. Josh flips ACTIVE by hand. Never touch a campaign's status.

## Never

* A lead row, an email, a name, a phone in this context. Counts and ids.
* A spend before a named yes from the approver the service names (Josh alone for now).
* A routine, a cron, a watch, a child agent, a re-read of a list.
* A second open job on the same campaign; `abort(job_id)` first if it is dead.
* An invented price, threshold, filter or source. Ask in plain English.

## How to watch

`jobs()`, `job(job_id)`: every step's counts, the card waiting for a name,
the last ten events. `spend()`: what was spent and what waits.
