---
name: grok-bot-babysitter
description: Standing orders for the Lead Top Up Grok bot. Use on every Grok / Cursor Grok / Slack Cursor turn in this repo. Grok does the reasoning — it reads the canon, reads what Supabase holds about how a campaign was pulled, counts, asks a person before any spend, and runs the verbs one at a time on the Railway service. It never pulls lead rows into context, never walks the thirteen-step skill in chat, and never fans out GetLeads child agents.
---

# Grok bot does the reasoning (D39, D53)

Josh, 2026-09-24: "I nuked our grok bot usage again trying to do lead top up."
The desktop Grok agent "Lead top-up service" spawned dozens of child runs
named "Fire GetLeads n=…" and "Apply leftover … CSVs". That is the opposite
of this skill.

Josh, 2026-10-09: "This app is dumb, flat pipeline. Grokbot should figure
out how I initially pulled the leads and run that again." So: the service
counts and moves rows. You decide. You read the record, you count, you
ask a person, you call the next verb. You stop. Rows move **MCP →
Supabase → LeadPipe → Smartlead**. They do not enter this context.

Read `skills/leadpipe/SKILL.md` and `skills/supabase-csv-endpoint/SKILL.md`
before you move a single row by hand. Those are how Claude already kept
tokens down. Copy that, do not invent a chat pipeline.

## Start here: the canon

Call `canon` once per session. It is one page: the rules, the reads, the
verbs, how to read a record, when to stop. It is also the MCP server's
instructions. Everything below is the short form.

The rules you apply:

* **One positive reply per 2,000 sends** is the bar. Under it, no top-up.
* **At least 1,000 net new** or say *the TAM for this campaign is
  exhausted* and stop. Do not widen unasked.
* **1 to 2,000 rows per job.**
* **A person approves every spend before it runs.** Name them.
* **Nothing starts on its own.** You call the next verb or nothing moves.
* **Josh flips ACTIVE.** Never SG Nurture. Cold call campaigns (Gabe Calls,
  Cayden Calls, Cold Call, Post-call) are ignored: the service leaves them
  off `campaigns` and refuses `pull` on them.

## The loop (one campaign at a time)

1. `campaigns(client_tag)`. Keep `passes_reply_bar: true` and
   `never_top_up: false`. One line on the rest and why.
2. `campaign_record(client_tag, campaign_id)`. Find the receipt or build
   that fed most of the leads (`rows_imported`, and `leads_by_leg`). Its
   four legs and its `company_filters` are the method. Read
   `how_i_did_it` and `notes`. `sources` tells you what a leg value means
   and how to repeat it. A missing leg or empty filters: ask Josh.
   `leftovers(client_tag)` shows rows earlier pulls left in the stores
   (lane table, client schema, waterfall tables) as counts, and for each
   store the obvious gap: `need_domain`, `need_person`, `need_email`,
   `need_phone`, with `next` naming the step that fills it. If a store
   holds what the campaign needs, or is one step from it, name it to the
   person who approves instead of pulling again. Phones are kept
   everywhere (D56); Josh cold calls now, so say how many rows carry one.
3. `count(client_tag, source, filters)` with those filters. getleads is
   free; `ai_ark` needs `approved_by`. BCP records keep industries per
   campaign under `industries_by_campaign`; pass that campaign's list as
   `industries`. Every other key stays as stored. Maps keeps `plan_id`
   and the categories list (D57); it never scopes by ZIP or `client_tag`
   alone.    Companion `v_*_companies` ∪ `v_*_needs_domain` is the ICP pool
   when those exist. Companions that omit `plan_id` join `maps_raw`
   so the bind is `$1::text` (D59). On `v_lane_e_*` the receipt
   categories match `main_category` and preschool–high school are
   dropped (D68). Already used is the union of live
   `public.leads` on the receipt's campaigns, emails already in
   `lp.<tag>_ingested_leads`, and this-client prior contact /
   suppression (D64). `size(client_tag, campaign_id, source, filters)`
   is the free dry-run of that pool plus suppression by reason. It
   returns a `size_id` at once; poll `size(size_id)` (D65).
4. `held(client_tag, campaign_id, filters, tam)`. If `net_new` < 1,000:
   *the TAM for this campaign is exhausted.* Stop there. If Josh asks for
   options, give each option with its count.
5. Tell Cayden or Josh: campaign, source, filters, count, net new, rows
   you will pull, worst-case cost. Wait for the yes.
6. `pull(client_tag, campaign_id, source, filters, max_rows)`. It returns
   the `job_id` at once (`status` started). Poll `job(job_id)` until pull
   is done or failed. If it failed, read `last_error` and stop; do not
   wait on an empty running step. Then
   `suppress`, `icp`, `enrich`, `verify`, `normalize`, `qa`, `stage`, each
   with the `job_id`. `icp` is the website gate from `icp-website-gate`:
   it costs about $0.25 per 1,000 domains, needs a name, and reports the
   label counts; if one label swallows a big share, stop and say so. Each answer has `next`. `waiting_approval` means name the
   worst case to a person and call the same verb with
   `approved_by="Their name"`. `parked` means read `job(job_id)` and fix
   or `abort`. QA holds show in `holds`; clear them with `resolve`.
   A done normalize whose rules changed (or `force=true`) runs again
   so the Maps-name company fill can write. Do not pass a lead
   table with no `domain` column to Find Named Person — this service
   hands it `topup.<tag>_ingested_leads_ew` (apply migration 0021
   first; the service never CREATE VIEW).
7. `import(job_id)` only when `loads_paused` is off and a person said so.
8. `write_receipt(job_id, …)` with the four legs, the filters you used and
   one plain sentence. The next top-up reads it.
9. Post counts and ids: campaign, pulled, net new after suppression,
   sendable, staged, imported, spend by vendor, job id. Josh flips ACTIVE.

## What a good answer looks like

```
BCP #3921850 IT AirPods: 1.6 per 2,000 (passes). Record: getleads company,
already domain, getleads person, getleads email; filters as stored.
count getleads 18,776; held 3,200; net new 15,576. Pulling 2,000.
Worst case $0 pull, ~$18 verify. Need a yes.
```

Not: a walkthrough of the thirteen steps, a list of names, a CSV in chat.

## Allow list (you may call these)

On this service (`leadtopup`, no login): `canon`, `campaigns`,
`campaign_record`, `sources`, `count`, `held`, `size`, `jobs`, `job`, `spend`,
`leftovers`, `holds`, `loads_paused`, `pull`, `icp`, `suppress`, `enrich`, `verify`,
`normalize`, `qa`, `stage`, `import`, `write_receipt`, `abort`,
`resolve`, `note`.

On LeadPipe (Context Saver), for a CSV Josh hands you: `lp_plan`,
`lp_run`, `lp_status`, `lp_export` (a signed URL you do not open),
`lp_sample` (ten rows, masked), `lp_inventory`, `lp_ensure_client`,
`lp_list_clients`.

On Supabase: `COUNT`, `GROUP BY` over `topup.pull_receipts`,
`topup.campaign_builds`, `topup.campaign_registry`, `topup.lead_provenance`
by `build_label` and the four legs. Never SELECT `email`, `first_name`,
`last_name`, `phone`, `linkedin_url`.

## Ban list (you must not call these)

`export_contacts`, `search_contacts`, `getleads_enrich_person_batch`,
`getleads_get_emails_from_linkedin_batch`,
`get_decision_makers_batch_result`, `get_enrichment_result`,
`list_profile_monitoring_leads`, `list_website_visitor_leads`,
`export_website_visitor_leads`, `get-dataset-items`, `find_dms_by_title`
(~$0.10 a company; Josh only). Any Smartlead tool that starts, pauses,
stops, edits or deletes a campaign. Any child agent. Any routine that
re-reads a list.

## If you are stuck

* A leg or a filter is missing on the record: ask Josh for that line. Do
  not guess one.
* A count comes back far from the record's `tam_count`: say both numbers
  and stop.
* A verb says `refused`: read `why`. A job the service opened on its own
  cannot exist any more; if you see one, `abort` it and say so.
* `job(job_id)` shows pull `failed`: read `last_error`. Do not wait on a
  running step with empty counts.
* `loads_paused` is on: nothing imports. Say who can flip it.
* Anything else: `note(client_tag, lane, line)` what you did and what you
  meant to do next, and ask.
