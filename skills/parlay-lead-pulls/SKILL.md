---
name: parlay-lead-pulls
description: Pull net-new leads for Randy at Parlay Tech. The live lane receipt is the filter book; the service recipe is what a top-up run executes. Grok bot (D39) must not execute this pull in chat — start start_topup or hand a CSV URL to LeadPipe ingest_csv. Use this skill whenever Josh asks for more Parlay leads, Parlay contacts, leads for Randy, or a Parlay list refresh, even if he only says "top off Parlay" or includes Parlay in a multi-client pull.
---

# Parlay Tech lead pulls

**Grok bot (D39):** do not execute this pull in chat. `start_topup` or LeadPipe `ingest_csv`.

Client: Randy / Parlay Tech. Smartlead client_id 418274. LeadPipe client_tag `parlay`. Live lanes are `owner`, `ops_dm`, and `it_dm` on the Sept 29 refresh, campaigns 4049046–4049064. `it_dm_legacy_sports`, `it_dm_tickets`, `it_dm_airpods`, and `adjacent_dm` are retired. Do not top those up.

## Filter book

Do not copy titles or bands from this file. Top ups use the Sept 29 receipts (`getleads_parlay_{owner,ops,itdm}_finserv[_adj]_20260929` and the Architecture and Planning builds) on lanes `owner`, `ops_dm`, and `it_dm`. Ops and IT use getleads job function plus seniority. Owners use titles. Industries, company size 11 to 500, United States, VALID, max 3 per company, as the receipt recorded them.

`recipes/parlay/it_dm.json` no longer names campaigns. A file that only lists retired ids does not override those receipts.

If that receipt's `written_by` is `claude_backfill` or `claude_backfill_build`, **recount** with getleads `count_contacts` before proposing. `rows_found` on those rows is the old export, not the pool. `tam_count` is blank until someone recounts.

## Suppression

Use `global-suppression`: response-based only, this-client sends in the last 90 days (D35 item 2). Never delete against all of `public.leads`. That killed 87 percent of a good pull. The master-dedupe SQL that used to live in this skill is gone on purpose. Pull every email status; we verify anyway. Three contacts per company. Bands 11–50 and 51–200 in the recipe; 201–500 is a widening option until those cells have campaigns.

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
