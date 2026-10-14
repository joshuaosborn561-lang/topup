---
name: parlay-lead-pulls
description: Pull net-new leads for Randy at Parlay Tech using getleads plus the LeadPipe ingest and master dedupe pipeline. Use this skill whenever Josh asks for more Parlay leads, Parlay contacts, leads for Randy, or a Parlay list refresh, even if he only says "top off Parlay" or includes Parlay in a multi-client pull. Encodes the corrected Aug 2026 ICP (IT decision makers only, no COO, no CTO) and the true remaining pool size.
---

# Parlay Tech lead pulls

Client: Randy / Parlay Tech. Smartlead client_id 418274. LeadPipe client_tag `parlay`.

## ICP (corrected Aug 16 2026, supersedes all earlier versions)

Named IT decision makers ONLY. Josh explicitly removed COO and CTO from this lane.

- `job_titles`: ["IT Director", "Director of IT", "Director of Information Technology", "Director of Technology", "VP of IT", "VP of Information Technology", "Vice President of Information Technology", "CIO", "Chief Information Officer", "IT Manager", "Head of IT", "Head of Information Technology"]
- `company_size`: ["51 to 200"]  (exact band label, NEVER employees_min/max, band overlap bug)
- `countries`: ["United States"]
- `email_status`: ["VALID"]  (CATCH_ALL is no longer a valid getleads value)
- `max_per_company`: 3

## Pool reality check

As of Aug 16 2026 the full IT-only pool at this band was 14,585 exported and 11,333 of those were already in the master (prior Parlay campaigns targeted the same people). Net-new was 2,891. This lane is nearly exhausted. If Josh asks for volume beyond ~2k, tell him the pool is tapped and the options are widening bands, adding titles, or a second source, rather than silently re-pulling dupes.

## Pipeline (context discipline: no lead rows in chat, ever)

1. `getleads:count_contacts` with the filters above (free) to size the pool.
2. `getleads:export_contacts` (confirmed=true, free on unlimited plan). Poll `check_contact_export` until completed, take the S3 `export_url`.
3. `Context Saver:lp_run` job_kind `ingest_csv`, client_tag `parlay`, params `{urls:[export_url], dedupe_key:"email", source_label:"getleads_parlay_<desc>_<date>"}`. Poll `lp_status`.
4. Master dedupe in Supabase project `azpapwtnrbzywlnxxecz` (campaignintelligence). The master is `public.leads` (hourly Smartlead sync, all clients) plus `public.suppression`:

```sql
with master as (
  select lower(email) e from public.leads where email is not null
  union
  select lower(email) from public.suppression where email is not null
)
delete from lp.parlay_ingested_leads t using master m where lower(t.email)=m.e;
```

5. `Context Saver:lp_export` client_tag `parlay`, table `ingested_leads` for a signed CSV URL to hand to verification.

## Known failure modes

- The LeadPipe ingest importer silently drops columns outside its fixed schema. `state`, `industry`, `employee_range` land NULL. Do not build filters that depend on those columns post-ingest.
- Re-ingesting a file re-adds rows previously deleted by the master dedupe. Always re-run the master dedupe SQL after any ingest.
- Report success as net-new rows after master dedupe, never rows exported.
- Verification: emails go to the verifier by file URL only. Never inline emails into verify tool args.

## Downstream

Before campaign import run the enrichment skills: name-city-normalization, conversational-location, company-name-normalization, sports-team-assignment if the campaign uses team merge fields. Randy's campaigns reference `{{location}}` in copy, blank locations send broken sentences, audit before upload. Verify merge fields against live sequences with `Smartlead:get_sequences` first.
