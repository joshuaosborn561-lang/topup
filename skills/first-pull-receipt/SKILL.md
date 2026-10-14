---
name: "first-pull-receipt"
description: Write the one row receipt in topup.pull_receipts after any first pull or top up for a SalesGlider campaign, so the Grok Bot babysitter (skills/grok-bot-babysitter) can link the leads to how they were pulled. The leadtopup / Top_Up service is retired (D110); the bot writes this receipt on every top up, alongside the build record in topup.list_build_records (record-list-build). Use whenever a list has just been imported into Smartlead, whenever Josh says write the receipt, log the pull, or record how we found these, and at the end of any lead build before declaring it done. This is step 11.5 of lead-list-build; read that skill for the full procedure. Counts and campaign ids only, never lead rows.
---

# First pull receipt

You are the agent that just built or topped up a list for a SalesGlider campaign: the Grok Bot babysitter (`grok-bot-babysitter`) on a top up, or Claude on a first build. The leadtopup / Top_Up service that used to replay receipts is retired (D110). A top up now replays the build from its row in `topup.list_build_records` and the transcript behind it (`record-list-build`). Smartlead knows who landed; it does not know how you found them. The receipt is the short machine summary of the pull, and `build_label` on it is what ties each lead to its build through `lead-provenance`. The bot writes it; it is not optional.

Write only on Supabase project `azpapwtnrbzywlnxxecz` (campaignintelligence), table `topup.pull_receipts`. Confirm the project first. Never the parcels project, never the CRM project. Never put emails, names, phones, or lead objects in the receipt or in chat. One row per ICP; two ICPs in one session means two rows. Latest row per lane wins if you redo a pull.

Classify the typical row you produced:

1. Companies: `getleads` | `maps` | `permits` | `maps_and_permits` | `parcels` | `parcel_operators` | `llc_unmask` | `officer_records` | `ai_ark` | `table` | `serp_tool_mention` | `theirstack_tech_signal` | `linkedin_engagers` | `linkedin_import` | `web_visitor_pixel` | `job_posting_signal` | `public_records`. There is no `other`. If the companies came from a signal, name the signal and put the query shape, vendor or technology list, creator roster, or job title terms in `company_filters` so the bot can replay it.
2. Domain: `already` | `getleads` | `maps` | `maps_address` | `domain_waterfall` | `theirstack` | `none`
3. Person: `already` | `getleads` | `ai_ark` | `people_waterfall` | `serp` | `hard_to_find` | `leadmagic_employee_finder` | `officer_records` | `prospeo` | `role_inbox` | `none`
4. Email: `already` | `getleads` | `email_waterfall` | `site_scrape` | `none`. If a waterfall ran, `email_max_tier` is the last tier allowed (`smartlead`, `aiark`, `leadmagic`, `prospeo`, `fullenrich`). Do not list a waterfall you did not run.

getleads VALID exports are usually person plus email from getleads, domain already there. Peterson style physical lanes are usually Maps plus permits, then Domain Waterfall, then Find Named Person, then the email waterfall.

Also fill: `segment` jsonb (band, mail_class SEG or OTHER, gift, offer_key), `yield_by_step` jsonb (companies, with_domain, with_person, with_email, verified_sendable, imported), `spend_cents`, `suppression_scope` (default `response_based_v1 plus same_offer`). `icp_kind` is `linkedin_native` or `physical`. `persona` and `lane` are snake_case. Headcount bands are labels like `"51 to 200"`, never min or max integers.

```sql
insert into topup.pull_receipts (
  written_by, client_tag, smartlead_client_id, lane, campaign_ids,
  icp_kind, persona, company_source, company_filters,
  domain_source, person_source, email_source, email_max_tier,
  rows_found, rows_imported, tam_count, how_i_did_it, notes,
  segment, yield_by_step, spend_cents, suppression_scope
) values (
  'claude', 'parlay', 418274, 'it_dm_tickets', '{3847839,3847846}',
  'linkedin_native', 'it_dm', 'getleads',
  '{"job_titles":["IT Director","CIO"],"company_size":["11 to 50","51 to 200"],"countries":["United States"],"email_status":["VALID"],"max_per_company":3}'::jsonb,
  'already', 'getleads', 'getleads', null,
  400, 380, 16000,
  'getleads count then export on IT DM titles, those two bands, VALID only. Person and email came on the export. Loaded the two team campaigns.',
  null,
  '{"band":["11_50","51_200"],"mail_class":["OTHER"],"gift":"tickets","offer_key":["eos"]}'::jsonb,
  '{"companies":null,"with_domain":400,"with_person":400,"with_email":400,"verified_sendable":385,"imported":380}'::jsonb,
  650, 'response_based_v1 plus same_offer'
);
```

A trigger rejects the row if any campaign id is not in `public.campaigns`, and a check rejects any project other than campaignintelligence. Set `build_label` on the receipt to the exact label your staging table's provenance SELECT emits, then follow the lead-provenance skill (register, stamp, gate). The receipt says how to rerun the pull; `topup.lead_provenance` says which leads it produced.

Reply to Josh with client, lane, source, campaign ids, and counts. Then you are done.
