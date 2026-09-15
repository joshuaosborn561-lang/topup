---
name: culture-fits-lead-pulls
description: Pull net-new leads for TJ at Culture Fits (MSP owner and C suite ICP) using getleads plus the LeadPipe ingest and master dedupe pipeline. Use this skill whenever Josh asks for Culture Fits leads, TJ leads, MSP leads for TJ, or includes Culture Fits in a multi-client pull. Replaces the retired getleads-msp-pipeline skill. Encodes the pool exhaustion reality and the corrected getleads parameters.
---

# Culture Fits (TJ) lead pulls

Client: TJ / Culture Fits. Smartlead client_id 418275. LeadPipe client_tag `culture_fits` (run `lp_ensure_client` on first use).

## ICP

MSP owners and C suite at small MSPs.

- `company_description`: "managed service provider, managed IT services, MSP, IT support, IT services and consulting"
- `job_titles`: ["Owner", "CEO", "President", "Founder", "Co-Founder", "CIO", "CTO", "VP of IT", "Director of IT"]
- `company_size`: ["11 to 50"]  (exact band label, NEVER employees_min/max, band overlap bug pulled ~2,700 wrong band rows once)
- `countries`: ["United States"]
- `email_status`: omit (D35 item 15 — pull every status; we verify anyway)
- `max_per_company`: 3
- Note: revenue caps barely filter MSP searches, the description match is the binding constraint. Skip revenue_max.

## Pool reality, do not skip this

TJ's strict ICP was nearly exhausted at ~527 net-new survivors as of mid Aug 2026. Before promising volume, run `count_contacts`, ingest, `global-suppression`, and report the honest net-new number. If it is small, show widening options with counts — do not widen until TJ says so (item 25). Do not silently re-pull duplicates to hit a number.

## Pipeline (no lead rows in chat, ever)

1. `getleads:count_contacts` with the filters above (free).
2. `getleads:export_contacts` confirmed=true, poll `check_contact_export`, take the S3 export_url.
3. `Context Saver:lp_run` job_kind `ingest_csv`, client_tag `culture_fits`, params `{urls:[export_url], dedupe_key:"email", source_label:"getleads_culturefits_<date>"}`.
4. Suppress with `global-suppression` (90-day send window for this client; forever only for positive / DNC / wrong person). Do **not** delete against all of `public.leads` — that is the Aug contact-history scope that killed 87 percent of a good pull.
5. `lp_export` client_tag `culture_fits`, table `ingested_leads` for a signed CSV URL into verification. Verification intake is by file URL only, never inline emails into tool args.

## Downstream

TJ's live campaigns (3429357, 3701207) use `{{Team_Nickname}}` and `{{game}}` merge tags plus `{{location}}` in copy. Blank merge fields send broken emails. Before any upload: pull the live sequences with `Smartlead:get_sequences`, confirm every merge field is populated, and run name-city-normalization, conversational-location, company-name-normalization, and the sports team assignment. Importer NULLs state/industry/employee_range columns on ingest, so enrichment happens on the exported CSV, not the lp table.

## Retirement note

This skill replaces `getleads-msp-pipeline`. If that skill is still installed, delete it, its CATCH_ALL and employees_min/max guidance is now known-bad.
