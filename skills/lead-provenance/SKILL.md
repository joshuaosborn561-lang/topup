---
name: "lead-provenance"
description: Make every lead traceable to where its company, domain, person, and email came from, so the leadtopup service and the Grokbot can repeat any pull. Use whenever a list is built, topped up, staged, or imported into Smartlead for any client, whenever a new build or staging table is created, whenever Josh asks where leads came from, how a campaign was pulled, why the bot says there are no tags, or what source filled a lead, and before setting any campaign ACTIVE. Also use when onboarding a new Smartlead client. Runs on campaignintelligence (azpapwtnrbzywlnxxecz) only, is free, and never moves lead rows through chat.
---

# Lead provenance

Every lead in a live campaign must answer four questions: where did the company come from, how did the domain get there, how did the person get there, how did the email get there (and which waterfall tier hit). The answers live in Supabase, not in chats. Built Sept 23 2026 after the Grokbot found no tags while topping up Cornerstone.

Project: `azpapwtnrbzywlnxxecz` (campaignintelligence) only. Confirm the project id before every write. Never the parcels project, never the CRM project. Counts only in chat.

## The pieces

| Object | What it is |
|---|---|
| `topup.campaign_recipe` | View. One row per Smartlead campaign: source mix at each step, confidence mix, builds that fed it, interested replies per build, receipt ids. **This is what the bot reads before a top up.** |
| `topup.lead_provenance` | One row per `client_tag` plus lowercased email. Sources, email tier, build_label, receipt_id, evidence table, confidence. |
| `topup.provenance_sources` | Registry of build tables. Each row is a SELECT the stamper runs. Registering a table is what makes its leads traceable. |
| `topup.stamp_provenance(client_tag)` | Stamps every lead in `public.leads` that has no row. pg_cron runs it at 20 past every hour. Weak stamps are retried each run. |
| `topup.provenance_gaps` | View. Live campaigns with untraced leads (`fix`), lane receipt only (`weak`), and Smartlead clients missing from `topup.client_map`. |
| `topup.client_map` | Smartlead client id to client_tag. |
| `topup.source_vocab` | The allowed values and what each means. |

Confidence: `traced` (build table plus a receipt or per lead vendor evidence), `label_inferred` (build table, sources guessed from its label), `from_receipt` (only the lane receipt covering the campaign), `unknown`.

## Vocabulary

- Company: `getleads`, `maps`, `permits`, `maps_and_permits`, `parcels`, `parcel_operators`, `llc_unmask`, `officer_records`, `ai_ark`, `table`, `serp_tool_mention`, `theirstack_tech_signal`, `linkedin_engagers`, `linkedin_import`, `web_visitor_pixel`, `job_posting_signal`, `public_records`
- Domain: `already`, `getleads`, `maps`, `maps_address`, `domain_waterfall`, `theirstack`, `none`
- Person: `already`, `getleads`, `ai_ark`, `people_waterfall`, `serp`, `hard_to_find`, `leadmagic_employee_finder`, `officer_records`, `prospeo`, `role_inbox`, `none`
- Email: `already`, `getleads`, `email_waterfall`, `site_scrape`, `none`
- Email tier (when the waterfall ran): `getleads`, `smartlead`, `aiark`, `leadmagic`, `prospeo`, `fullenrich`

There is no `other`. If a new method appears, add it to `topup.source_vocab` and to the check constraints on both `topup.pull_receipts` and `topup.lead_provenance` in one migration, then use it.

## The rule for every build

A build is not done until its leads are traceable. Do these in order, inside the lead-list-build flow.

1. **Stage with source columns.** The staging table for the build (any schema on campaignintelligence) must carry, per row: `email`, and enough to say the four sources. Best is explicit columns (`company_source`, `domain_source`, `person_source`, `email_source`, `email_tier`). Acceptable is a vendor or lane column that maps cleanly (`wf_vendor`, `source_tool`, `lane`, `src`). A `source_label` alone is acceptable only if the build receipt with that exact `build_label` is written in step 3.
2. **Register the table** in `topup.provenance_sources`, once per table, before import. The SELECT must return exactly these columns: `email, build_label, lane, company_source, company_detail, domain_source, person_source, email_source, email_tier`. A null inherits from the build receipt whose `build_label` matches. Set `explicit = true` when the columns come from per lead evidence, `false` when guessed. Lower `priority` wins when a lead is in two tables; use 10 to 40 for per lead vendor tables, 50 for ingest labels, 90 and up for guesses.

   ```sql
   insert into topup.provenance_sources(name, client_tag, priority, explicit, source_sql, notes) values
   ('parlay_ops_dm_20261001', 'parlay', 20, true, $s$
     select email, 'parlay_ops_dm_20261001' build_label, 'ops_dm' lane,
       'getleads' company_source, 'getleads company search, 51 to 200' company_detail,
       'already' domain_source, 'getleads' person_source,
       case when wf_vendor is null then 'getleads' else 'email_waterfall' end email_source,
       wf_vendor email_tier
     from lp.parlay_ops_dm_20261001 where email is not null
   $s$, 'Ops DM pull, emails missing from getleads went through the waterfall')
   on conflict (name) do update set source_sql = excluded.source_sql;
   ```

   Test it before import: `select count(*), count(company_source) from (<the SELECT>) x;` Zero rows or null sources means it is wrong.
3. **Write the receipt** per the first-pull-receipt skill, with `build_label` equal to the label your SELECT emits. That is what links a lead to its rerun recipe.
4. **Import to Smartlead** as usual.
5. **Stamp now, do not wait for cron:** `select * from topup.stamp_provenance('<client_tag>');`
6. **Gate:** `select * from topup.provenance_gaps where smartlead_campaign_id = any('{<campaign ids>}') and verdict like 'fix%';` must return zero rows before the campaign goes ACTIVE. Then read the campaign's row in `topup.campaign_recipe` and confirm the source mix matches what you actually did.

Report to Josh: client, campaign ids, leads stamped, traced versus other confidence. Counts only.

## New Smartlead client

Add it to `topup.client_map` the same day the client is created, or its leads never get stamped. `provenance_gaps` lists any client id with leads and no mapping.

## When the source table is on another project

Physical builds often start on `kemvxzhcxvynmoutwdrh` (parcels, operators, shell LLC resolves, 990 and Comptroller names). Do not register a table there; the stamper cannot see it. Whatever gets verified and loaded passes through a staging or verify queue on campaignintelligence (for Earthworks, `client_peterson.ew_verify_queue`). Put the origin on that row when it is written: company `parcel_operators`, `llc_unmask`, or `officer_records`, with the parcels table named in `company_detail`. Then register the queue as usual.

## Fixing gaps after the fact

1. `select * from topup.provenance_gaps where verdict like 'fix%';`
2. Find where the untraced emails live, counts only: loop the tables that have an `email` column and count matches against `topup.lead_provenance where confidence = 'unknown'` for that client. The table with the most matches is the build.
3. Register it (explicit if it has vendor columns, otherwise `explicit = false`), run the stamper for that client, re-check.
4. If no table holds them, the build predates labeling. Write a lane receipt covering those campaign ids with notes starting `RECONSTRUCTED`, which tells the service to treat the next pull as a first pull. Never invent a per lead source.

## Do not

- Do not add provenance columns to `public.leads`. The hourly Smartlead sync rewrites it.
- Do not hand insert rows into `topup.lead_provenance` for whole builds; register the source so the stamp is reproducible. Hand corrections of a few rows are allowed with `stamped_by` set to something other than `stamp_provenance`, which protects them from restamps.
- Do not stamp a guess as `traced`. If the method is guessed, `explicit = false`.
- Do not put emails or names in chat, receipts, or notes.
