---
name: first-pull-receipt
description: After you build a first lead list for a SalesGlider campaign in Claude, insert one receipt row to campaignintelligence so leadtopup can get more of those same people automatically. Use after a first pull, first import, or when Josh says write the receipt. Never update an old row. Never write lead rows or emails.
---

# First-pull receipt (for leadtopup)

You are the agent that builds the **first** list. **leadtopup** refills a campaign that is still working. It cannot see this chat.

Write **one new insert** after the pull. Latest row wins. Never `update` a receipt.

## Two kinds of row

- **`granularity = lane`** — what the lane *is*. Full `company_filters`, `segment` (band / mail_class / gift / offer_key), one stack. A client with two ICPs (Peterson GC vs vacant-land, staffing owners vs CROs) gets two lane rows.
- **`granularity = build`** — one actual build: a LeadPipe `source_label`, a Peterson batch name, a Vasco `source_tool`. `build_label` is that name. `rows_found` / `rows_imported` are this build's size. Empty `campaign_ids` is allowed when the build never loaded.

The lane row is the filter book. The build rows are the yield. When proposing a top-up, pick the **build with the best measured imported count**, not the method on the lane row.

Until Josh confirms a backfill row (`owner_confirmed_at` set, or the notes no longer say "Josh to confirm"), **propose it, do not scale**.

## Where

Only project `azpapwtnrbzywlnxxecz` (campaignintelligence), table `topup.pull_receipts`. Confirm the project. A trigger rejects campaign ids that are not in `public.campaigns.smartlead_campaign_id` — register the campaign before the receipt. Clone flow: `public.campaigns` first.

## Never

No emails, names, phones, or lead objects. No mixing two ICPs in one lane row. No FullEnrich `email_max_tier` unless Josh stamped it. No in-place updates.

## Counts (this is how the format stays honest)

| Column | Means |
|---|---|
| `tam_count` | What `count_contacts` (desk) or the Maps/permit **company** count (physical) said **right now**. Required on getleads lane rows. |
| `rows_found` | What this pull/export actually produced. **Not** TAM. |
| `rows_imported` | What landed in Smartlead. |
| `yield_by_step` | `{companies, with_domain, with_person, with_email, verified_sendable, imported}` plus any named cascade counts (e.g. `email_name_to_email`). |
| `spend_cents` | This build, from our price table. |

If you only have the export size, put it in `rows_found` and leave `tam_count` null — do not pretend they are the same. A later count_contacts that is 3× `rows_found` is expected when `tam_count` was never written; that is a format miss, not a pool explosion.

## Puzzle + source

Same enums as before: `company_source`, `domain_source`, `person_source`, `email_source`, `email_max_tier`.

**getleads `company_filters`:** titles, exact band labels, countries, industries (no commas), `email_status: ["VALID"]`, and `export_caps.max_per_company` if you capped the export. Do not put `max_per_company` in the count filters.

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
  '{"job_titles":["IT Director","CIO"],"company_size":["11 to 50","51 to 200"],"countries":["United States"],"email_status":["VALID"],"export_caps":{"max_per_company":3}}'::jsonb,
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
