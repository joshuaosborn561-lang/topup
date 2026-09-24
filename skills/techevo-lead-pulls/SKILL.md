---
name: techevo-lead-pulls
description: Pull net-new New England and Florida leads for TechEvo using getleads plus the LeadPipe ingest and global-suppression pipeline. Grok bot (D39) must not execute this pull in chat — start start_topup or hand a CSV URL to LeadPipe ingest_csv. Use this skill whenever Josh asks for TechEvo leads, New England IT leads, Florida IT leads, South Florida owners, or includes TechEvo in a multi-client pull. Encodes the geography rules (NE includes NY/NJ; Florida IT DM is statewide; SFL owners stay metro), the IT decision maker bias, and the small company COO fallback.
---

# TechEvo lead pulls

**Grok bot (D39):** do not execute this pull in chat. `start_topup` or LeadPipe `ingest_csv`.

Client: TechEvo. Smartlead client_id 521881 (campaign "TechEvo New England Red Sox"). LeadPipe client_tag `techevo`.

## Geography (D36 items 26, 27; item 28 still applies)

getleads `states` filters loosely (company or person), so the export WILL contain out-of-region contacts. Geography must be re-verified on the contact's own city and state before anything ships. Roughly half of a states-filtered NE export was out of region on Aug 16 2026.

**New England IT DM** includes New York and New Jersey (item 26). Filter and keep: MA, CT, RI, NH, VT, ME, NY, NJ.

**Florida IT DM** is statewide (item 27). Filter `states`: `["Florida"]`. Keep any Florida contact city after the export audit.

**South Florida owners** stays metro (item 27). Miami-Dade, Broward, Palm Beach only — Miami, Fort Lauderdale, West Palm Beach and their suburbs. Do not widen owners to the whole state.

## ICP

Primary: named IT decision makers.
- `job_titles`: ["IT Director", "Director of IT", "Director of Information Technology", "Director of Technology", "VP of IT", "CIO", "Chief Information Officer", "IT Manager", "Head of IT", "Head of Information Technology"]
- `company_size`: ["11 to 50", "51 to 200", "201 to 500"]
- NE states: ["Massachusetts", "Connecticut", "Rhode Island", "New Hampshire", "Vermont", "Maine", "New York", "New Jersey"]
- FL IT DM states: ["Florida"]
- `countries`: ["United States"], omit `email_status` (D35 item 15), `max_per_company`: 3

Fallback (Josh's rule: "a COO at a very small company" is acceptable where no named IT DM exists):
- Second export: `job_titles` ["COO", "Chief Operating Officer"], `company_size` ["11 to 50"] only, `max_per_company` 1, same geography as that lane.

No CTO in either segment. IT titles first. COO only at 11 to 50, one per company (item 29).

## Pipeline

Same as all clients: count_contacts → export_contacts → poll → `lp_run ingest_csv` (client_tag `techevo`, dedupe_key email) → `global-suppression` (90-day send window plus live-campaign exclude; do not delete against all of `public.leads`) → `lp_export` for the verification file URL.

## Geography enforcement, the part that has actually failed

The LeadPipe importer drops the location columns, `state` lands NULL on every ingested row, so you CANNOT filter geography in `lp.techevo_ingested_leads` after a default ingest. On Aug 16 2026 a state filter against NULL states deleted the entire table. Options in order of preference:

1. Export from getleads with explicit `columns` including the contact state field (check `get_available_columns` for the current label) and pass a `column_map` in `ingest_csv` params so state survives, then filter in SQL.
2. If the column map path fails, stage the raw CSV into Supabase via the supabase-csv-endpoint skill pattern and filter there before handing to LeadPipe.
3. Never filter on a column you have not first sampled with `lp_sample`. Confirm the values exist and their format before writing a delete.

NE keep: `upper(state)` in ('MA','CT','RI','NH','VT','ME','NY','NJ') or the full state names. Florida IT DM keep: Florida only. SFL owners keep: Miami-Dade / Broward / Palm Beach cities.

## Known failure modes

- Deleting on an unverified column format wipes tables. Sample first, delete second.
- Re-ingest re-adds already-held addresses. Run `global-suppression` after every ingest.
- Pool is small: ~1,300 net-new as of Aug 16 2026 before geography verification (that count was NE without NY/NJ). Set expectations accordingly; recount after adding NY/NJ.
