---
name: goliath-lead-pulls
description: Pull net-new leads for Goliath (Goliath360 / Goliath Solutions Group, Dave Ackley, cybersecurity MSSP) using getleads plus the LeadPipe pipeline. Use this skill whenever Josh asks for Goliath leads, Goliath lanes, or includes Goliath in a multi-client pull. Encodes the Aug 2026 correction that every Goliath lane targets the IT decision maker, not the C suite, and the pending Mfg/Defense lookalike rule.
---

# Goliath lead pulls

Client: Dave Ackley, Goliath360 / Goliath Solutions Group (goliathsec.com), cybersecurity for SMB/SME: endpoint protection, MDR/XDR, pen testing, advisory, compliance, tiered $12 to $65 per endpoint. Smartlead client_id 548611. LeadPipe client_tag `goliath`.

## The Aug 16 2026 correction that overrides everything earlier

Every Goliath lane goes to the IT DECISION MAKER. The original campaigns targeted CFO/CEO/COO; Josh explicitly redid all of it. Do not pull C suite for Goliath again.

Standard IT DM title set (no CTO, no COO):
["IT Director", "Director of IT", "Director of Information Technology", "Director of Technology", "VP of IT", "VP of Information Technology", "Vice President of Information Technology", "CIO", "Chief Information Officer", "IT Manager", "Head of IT", "Head of Information Technology"]
Education lane also adds: "Assistant Director of Technology", "Director of Technology Services".

## Four lanes

All: `countries` ["United States"], omit `email_status` (D35 item 15), `max_per_company` 3, `company_size` ["51 to 200", "201 to 500", "501 to 1000"] except Education which runs unsized. Josh rejected widening bands past 1000.

- L1 FinServ: `industries` ["Banking", "Financial Services", "Insurance", "Investment Management"]
- L2 Healthcare: `industries` ["Hospitals and Health Care", "Medical Practices", "Physicians", "Outpatient Care Centers"]
- L3 Mfg/Defense: DO NOT pull by broad industry lists. Josh's rule: this lane is companies similar to the ones Goliath has actually worked with. Requires the seed customer list (lives outside this project, ask Josh to paste it or pull from his Goliath materials). Build lookalikes from seeds: profile the seed domains, then filter getleads on the matching industries/specialties, or use a lookalike tool with approval since those are paid.
- L4 Education: `industries` ["Primary and Secondary Education", "Higher Education", "Education Administration Programs", "Education"]

## Pool reality (Aug 16 2026, IT-only titles)

FinServ 2,720 exported, Healthcare 1,842, Education 6,335, Mfg 1,475 (old broad-industry file, superseded by the seed rule). IT DMs in these verticals are a thin population at these bands; C suite counts from older sessions are not comparable. Net-new after master dedupe was 6,441 across all four. Do not promise Goliath volume the pool cannot deliver.

## Pipeline

count_contacts → export_contacts per lane → poll → `lp_run ingest_csv` client_tag `goliath` (dedupe_key email, one source_label per lane, e.g. `getleads_goliath_finserv_it_<date>`) → master dedupe SQL on `lp.goliath_ingested_leads` against `public.leads` union `public.suppression` in project `azpapwtnrbzywlnxxecz` → `lp_export` for the verification file URL. No lead rows in chat at any step. Re-run master dedupe after every ingest.

## Known failure modes

- getleads industry labels are exact enum values ("Hospitals and Health Care", not "Hospital & Health Care"). A wrong label 400s with the full valid list; correct and retry.
- Importer drops state/industry/employee_range columns to NULL.
- Sports team and remaining enrichment skills for Goliath live in the Goliath chat sandbox; do not recreate them elsewhere.
