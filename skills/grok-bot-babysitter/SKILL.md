---
name: grok-bot-babysitter
description: Standing orders for the Lead Top Up Grokbot. Use on every Grokbot turn in this repo. Grokbot does the building — it reads how a campaign's list was built, replays that build with its own connectors through LeadPipe, hands the pool to the Top_Up service, shows Josh or Cayden the count and the cost, and runs the approved load. It never pulls a lead row into context.
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
   Context_Saver (LeadPipe), getleads. Verification and the Smartlead
   import are the service's own calls; you attach nothing for them.
   Missing one → tell Josh what to attach in Grokbot (the answer carries
   each custom MCP's Railway HTTPS address) and wait. A transcript or a
   process change that names a connector you do not have → same.
2. `canon`. One page. Those are the rules.

## The loop

1. `campaigns()`: the low campaign (untouched under about two weeks of
   sends, passing one positive per 2,000, not cold call, not SG Nurture).
2. `build_record(client_tag, campaign_id)`. Read `asked` (what Josh
   wanted), `method.steps` (every tool call in order with its arguments),
   `process_changes_since_build` (what changed about how lists are built
   since; apply it on top, e.g. a newer TAM check or a new source).
   `no_recorded_build: true` → stop; tell Josh the campaign has no
   recorded build.
3. Replay it with your connectors. Same tools, same filters, titles,
   geography, sources. Counts first (`count_contacts`, SQL `count(*)`),
   then the vendor's server-side export into LeadPipe (`lp_run`,
   `lp_status`) or a scratch table you build in SQL on
   campaignintelligence. Never widen. Never `SELECT email`, never
   `export_contacts` into chat, never `get-dataset-items`, never
   `find_dms_by_title`, never read a CSV. You end with a signed file URL
   or a `schema.table` name.
4. `topup(client_tag, campaign_id, source)` then `job(job_id)` until
   `quoted`. Say to Josh or Cayden: "`N` new leads for #campaign after
   everything you hold and unsubscribes, up to `$X` (website ICP check
   plus verification)." Under 1,000 new: say the TAM is exhausted; stop.
5. When one of them says yes: `topup(job_id, approved_by="Josh")` or
   `"Cayden"`. Only those two names. `job(job_id)` until `done`.
   `staged` with loads paused → `load(job_id)` once `loads_paused` is off.
6. Stop. Josh flips ACTIVE by hand. Never touch a campaign's status.

## Never

* A lead row, an email, a name, a phone in this context. Counts and ids.
* A spend before a named yes from Josh or Cayden.
* A routine, a cron, a watch, a child agent, a re-read of a list.
* A second open job on the same campaign; `abort(job_id)` first if it is dead.
* An invented price, threshold, filter or source. Ask in plain English.

## How to watch

`jobs()`, `job(job_id)`: every step's counts, the card waiting for a name,
the last ten events. `spend()`: what was spent and what waits.
