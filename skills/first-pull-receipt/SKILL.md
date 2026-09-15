---
name: first-pull-receipt
description: Write the one row receipt in topup.pull_receipts after any first pull or top up for a SalesGlider campaign, so the leadtopup service can repeat the pull without guessing. Use whenever a list has just been imported into Smartlead, whenever Josh says write the receipt, log the pull, or record how we found these, and at the end of any lead build before declaring it done. This is step 11.5 of lead-list-build; read that skill for the full procedure. Counts and campaign ids only, never lead rows.
---

# First pull receipt

You are the agent that just built or topped up a list for a SalesGlider campaign. A Railway service called leadtopup exists to get more of the same people when a campaign performs. It cannot see this chat. Smartlead knows who landed; it does not know how you found them. The receipt is how it finds out.

Write **one new insert** after the pull. Latest row wins. Never update an old row.

Write only on Supabase project `azpapwtnrbzywlnxxecz` (campaignintelligence), table `topup.pull_receipts`. Confirm the project first. Never the parcels project, never the CRM project. Never put emails, names, phones, or lead objects in the receipt or in chat. A trigger rejects campaign ids that are not in `public.campaigns.smartlead_campaign_id` — register the campaign before the receipt.

## Two kinds of row

- **`granularity = lane`** — what the lane *is*. Full `company_filters`, `segment` (band / mail_class / gift / offer_key), one stack. A client with two ICPs (Peterson GC vs vacant-land, staffing owners vs CROs) gets two lane rows.
- **`granularity = build`** — one actual build: a LeadPipe `source_label`, a Peterson batch name, a Vasco `source_tool`. `build_label` is that name. `rows_found` / `rows_imported` are this build's size. Empty `campaign_ids` is allowed when the build never loaded.

The lane row is the filter book. The build rows are the yield. When proposing a top-up, pick the **build with the best measured imported count**, not the method on the lane row.

Until Josh confirms a backfill row (`owner_confirmed_at` set, or the notes no longer say "Josh to confirm"), **propose it, do not scale**.

If the latest receipt on the lane is `claude_backfill` or `claude_backfill_build`, **recount** (`count_contacts` or the Maps/permit company count) before proposing. Those rows have `tam_count` null and `rows_found` equal to the original export, not the pool. A blank `tam_count` is not TAM.

## Vocabulary (the table rejects anything else)

Classify the typical row you produced. There is no `other`. A receipt that would have needed `other` is a bug to raise, not a value to write.

1. Companies: `getleads` | `maps` | `permits` | `maps_and_permits` | `parcels` | `ai_ark` | `table` | `serp_tool_mention` | `theirstack_tech_signal` | `linkedin_engagers` | `linkedin_import` | `web_visitor_pixel` | `job_posting_signal` | `public_records`. If the companies came from a signal, name the signal and put the query shape, vendor or technology list, creator roster, or job title terms in `company_filters` so the service can rerun it.
2. Domain: `already` | `getleads` | `maps` | `domain_waterfall` | `theirstack` | `none`
3. Person: `already` | `getleads` | `ai_ark` | `people_waterfall` | `serp` | `hard_to_find` | `leadmagic_employee_finder` | `none`
4. Email: `already` | `getleads` | `name_to_email` | `email_waterfall` | `none`. If a waterfall ran, `email_max_tier` is the last tier allowed (`aiark`, `leadmagic`, `fullenrich`). Do not list a waterfall you did not run. No FullEnrich `email_max_tier` unless Josh stamped it.

getleads exports are usually person plus email from getleads, domain already there. Peterson style physical lanes are usually Maps plus permits, then Domain Waterfall, then Find Named Person, then Name to Email or the email waterfall.

`icp_kind` is `linkedin_native` or `physical`. `persona` and `lane` are snake_case. Headcount bands are labels like `"51 to 200"`, never min or max integers.

## Counts (this is how the format stays honest)

| Column | Means |
|---|---|
| `tam_count` | What `count_contacts` (desk) or the Maps/permit **company** count (physical) said **right now**. Required on getleads lane rows. |
| `rows_found` | What this pull/export actually produced. **Not** TAM. |
| `rows_imported` | What landed in Smartlead. |
| `yield_by_step` | `{companies, with_domain, with_person, with_email, verified_sendable, imported}` plus any named cascade counts (e.g. `email_name_to_email`). |
| `spend_cents` | This build, from our price table. |
| `suppression_scope` | Default `response_based_v1`. |

If you only have the export size, put it in `rows_found` and leave `tam_count` null — do not pretend they are the same. A later count_contacts that is 3× `rows_found` is expected when `tam_count` was never written; that is a format miss, not a pool explosion.

## getleads and physical filters

**getleads `company_filters`:** titles, exact band labels, countries, industries (no commas), every email status (omit `email_status`; D35 item 15), and `export_caps.max_per_company` if you capped the export. Do not put `max_per_company` in the count filters.

**physical `company_filters`:** store the scrape recipe and the ICP slice separately.

```json
{
  "maps_runs": [{"run_label": "peterson", "zips": 832, "categories": 72, "businesses": 76830, "first_seen": "2026-08-10"}],
  "maps": {"categories": ["general contractor"], "geo": "DFW grid"},
  "permits": {"source": "PermitStack", "categories_used": "ROOFING, NEW_CONSTRUCTION", "jurisdictions": 17}
}
```

Read Maps provenance from `client_<tag>.leads` (`run_label`, `plan_id`, `source_category`, `source_zip`), not the Maps job log (it only keeps ~50 jobs).

## Insert (lane example)

```sql
insert into topup.pull_receipts (
  written_by, granularity, build_label, client_tag, smartlead_client_id, lane, campaign_ids,
  icp_kind, persona, company_source, company_filters,
  domain_source, person_source, email_source, email_max_tier,
  rows_found, rows_imported, tam_count, yield_by_step, spend_cents, segment, suppression_scope,
  how_i_did_it, notes
) values (
  'claude',
  'lane',
  null,
  'parlay',
  418274,
  'it_dm_tickets',
  '{3847839,3847846}',
  'linkedin_native',
  'it_dm',
  'getleads',
  '{"job_titles":["IT Director","CIO"],"company_size":["11 to 50","51 to 200"],"countries":["United States"],"export_caps":{"max_per_company":3}}'::jsonb,
  'already', 'getleads', 'getleads', null,
  400, 380, 16000,
  '{"imported":380}'::jsonb,
  0,
  '{"band":["11_50","51_200"],"mail_class":["SEG","OTHER"],"gift":"tickets"}'::jsonb,
  'response_based_v1',
  'getleads count_contacts then export. tam_count is the count; rows_found is the export.',
  null
);
```

Then tell Josh: client, lane, granularity, build_label, source, campaign ids, tam / found / imported. No rows.
