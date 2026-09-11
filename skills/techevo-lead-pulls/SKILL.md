---
name: techevo-lead-pulls
description: Pull net-new New England leads for TechEvo using getleads plus the LeadPipe ingest and master dedupe pipeline. Use this skill whenever Josh asks for TechEvo leads, New England IT leads, or includes TechEvo in a multi-client pull, even casually. Encodes the hard New England geography rule, the IT decision maker bias, and the small company COO fallback.
---

# TechEvo lead pulls

Client: TechEvo. Smartlead client_id 521881 (campaign "TechEvo New England Red Sox"). LeadPipe client_tag `techevo`.

## Hard rule: New England only, enforced at CONTACT level

MA, CT, RI, NH, VT, ME. getleads `states` filters loosely (company or person), so the export WILL contain out-of-region contacts. Geography must be re-verified on the contact's own location before anything ships. Roughly half of a states-filtered NE export was out of region on Aug 16 2026.

## ICP

Primary: named IT decision makers.
- `job_titles`: ["IT Director", "Director of IT", "Director of Information Technology", "Director of Technology", "VP of IT", "CIO", "Chief Information Officer", "IT Manager", "Head of IT", "Head of Information Technology"]
- `company_size`: ["11 to 50", "51 to 200", "201 to 500"]
- `states`: ["Massachusetts", "Connecticut", "Rhode Island", "New Hampshire", "Vermont", "Maine"]
- `countries`: ["United States"], `email_status`: ["VALID"], `max_per_company`: 3

Fallback (Josh's rule: "a COO at a very small company" is acceptable where no named IT DM exists):
- Second export: `job_titles` ["COO", "Chief Operating Officer"], `company_size` ["11 to 50"] only, `max_per_company` 1, same states.

No CTO in either segment.

## Pipeline

Same as all clients: count_contacts → export_contacts → poll → `lp_run ingest_csv` (client_tag `techevo`, dedupe_key email) → master dedupe SQL against `public.leads` union `public.suppression` in project `azpapwtnrbzywlnxxecz` on table `lp.techevo_ingested_leads` → `lp_export` for the verification file URL.

## Geography enforcement, the part that has actually failed

The LeadPipe importer drops the location columns, `state` lands NULL on every ingested row, so you CANNOT filter geography in `lp.techevo_ingested_leads` after a default ingest. On Aug 16 2026 a state filter against NULL states deleted the entire table. Options in order of preference:

1. Export from getleads with explicit `columns` including the contact state field (check `get_available_columns` for the current label) and pass a `column_map` in `ingest_csv` params so state survives, then filter in SQL: keep only `upper(state)` in ('MA','CT','RI','NH','VT','ME') or the full state names.
2. If the column map path fails, stage the raw CSV into Supabase via the supabase-csv-endpoint skill pattern and filter there before handing to LeadPipe.
3. Never filter on a column you have not first sampled with `lp_sample`. Confirm the values exist and their format before writing a delete.

## Known failure modes

- Deleting on an unverified column format wipes tables. Sample first, delete second.
- Re-ingest re-adds master dupes. Re-run the master dedupe after every ingest.
- Pool is small: ~1,300 net-new as of Aug 16 2026 before geography verification. Set expectations accordingly.
