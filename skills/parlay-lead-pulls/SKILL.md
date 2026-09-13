---
name: parlay-lead-pulls
description: Pull net-new leads for Randy at Parlay Tech. The live lane receipt is the filter book; the service recipe is what a top-up run executes. Use this skill whenever Josh asks for more Parlay leads, Parlay contacts, leads for Randy, or a Parlay list refresh, even if he only says "top off Parlay" or includes Parlay in a multi-client pull.
---

# Parlay Tech lead pulls

Client: Randy / Parlay Tech. Smartlead client_id 418274. LeadPipe client_tag `parlay`. Service lane `it_dm`. Receipt lane `it_dm_tickets`.

## Filter book

Do not copy titles or bands from this file. They drifted once (Aug 16 was 51–200 only; Sept 9 widened). The live **lane** receipt is the filter book:

```sql
select company_filters, campaign_ids, tam_count, rows_found, notes, owner_confirmed_at, written_by, written_at
from topup.pull_receipts
where client_tag = 'parlay'
  and lane = 'it_dm_tickets'
  and granularity = 'lane'
order by written_at desc
limit 1;
```

The service recipe `recipes/parlay/it_dm.json` is what a top-up run executes today (bands `11 to 50` and `51 to 200`, the recipe title list, `VALID`, US). The backfill receipt is wider (also `201 to 500` and extra titles) and is a **proposal** until Josh scales it — do not silently export the widened set.

If that receipt's `written_by` is `claude_backfill` or `claude_backfill_build`, **recount** with getleads `count_contacts` before proposing. `rows_found` on those rows is the old export, not the pool. `tam_count` is blank until someone recounts.

## Suppression

Use `global-suppression`: response-based only, this-client prior contact for life (any email in `public.leads` for this Smartlead client or in `leads_staging` for any of this client's campaigns, sent or not). Never delete against all of `public.leads`. That killed 87 percent of a good pull. The master-dedupe SQL that used to live in this skill is gone on purpose.

## Pipeline (context discipline: no lead rows in chat, ever)

1. `getleads:count_contacts` from the recipe or the receipt filters (free) to size the pool. This is the recount.
2. `getleads:export_contacts` (confirmed=true, free on unlimited plan). Poll `check_contact_export` until completed, take the S3 `export_url`.
3. `Context Saver:lp_run` job_kind `ingest_csv`, client_tag `parlay`, params `{urls:[export_url], dedupe_key:"email", source_label:"getleads_parlay_<desc>_<date>"}`. Poll `lp_status`.
4. Suppress with the scope in `global-suppression` (and the service step 5), not a delete against `public.leads`.
5. `Context Saver:lp_export` client_tag `parlay`, table `ingested_leads` for a signed CSV URL to hand to verification.

## Known failure modes

- The LeadPipe ingest importer silently drops columns outside its fixed schema. `state`, `industry`, `employee_range` land NULL. Do not build filters that depend on those columns post-ingest.
- Report success as net-new after response-based suppression, never rows exported.
- Verification: emails go to the verifier by file URL only. Never inline emails into verify tool args.

## Downstream

Before campaign import run the enrichment skills: name-city-normalization, conversational-location, company-name-normalization, sports-team-assignment if the campaign uses team merge fields. Randy's campaigns reference `{{location}}` in copy, blank locations send broken sentences, audit before upload. Verify merge fields against live sequences with `Smartlead:get_sequences` first. Write the pull receipt (`first-pull-receipt`) after import.
