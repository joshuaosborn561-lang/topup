---
name: salesglider-lead-pulls
description: Pull net-new leads for SalesGlider Growth's own outbound lanes (trades, staffing, deal origination / private equity) using getleads plus the LeadPipe pipeline. Use this skill whenever Josh asks for SalesGlider leads, SG leads, "my own lanes", trades leads, staffing leads, PE leads, or deal origination leads, even if he only names one lane. Encodes the hard 11 plus employee minimum on all SG lanes, the 5 plus exception for the PE lane, the staffing decision maker segmentation, and the dead lanes.
---

# SalesGlider Growth internal lead pulls

Josh's own agency outbound. Smartlead client_id 345263. LeadPipe client_tag `salesglider`.

## Hard rules (Aug 16 2026, override everything earlier)

1. **Minimum 11 employees on every SG lane.** Never include the "2 to 10" band. The one exception: the PE / deal origination lane may go down to 5 employees. Bands cannot express 5 plus, so use `employee_profiles_on_linkedin_min: 5` (hard cutoff, does not band-overlap) instead of `employees_min` which silently pulls the whole 2 to 10 band.
2. **Financial advisors lane is DEAD.** Josh: "I don't wanna work with financial advisers anymore." Do not pull, do not suggest.
3. All lanes: `countries` ["United States"], `email_status` ["VALID"], `max_per_company` 3, exact `company_size` band labels only.

## Lane: Trades

- `industries`: ["Construction"]
- `job_titles`: ["Owner", "President", "CEO", "Founder", "Co-Founder", "Vice President"]
- `company_size`: ["11 to 50", "51 to 200"]
- Deepest SG pool (~32k gross). The default lane for filling volume.

## Lane: Staffing (SEGMENTED, this was an explicit correction)

Range is 11 to 500, but the decision maker changes with size. Josh: "I'm not gonna email the CEO of a five hundred person staffing company." Never run one flat title set across the whole range.

- Segment A, `company_size` ["11 to 50"]: owners. `job_titles` ["CEO", "Founder", "Co-Founder", "Owner", "President", "Managing Partner"]
- Segment B, `company_size` ["51 to 200"]: execs plus sales leadership. `job_titles` ["CEO", "President", "Managing Partner", "Managing Director", "VP of Sales", "Vice President of Sales", "Head of Sales", "Director of Sales", "VP of Business Development", "Director of Business Development", "Chief Revenue Officer", "Chief Growth Officer"]
- Segment C, `company_size` ["201 to 500"]: revenue leadership only, no owners. `job_titles` ["VP of Sales", "Vice President of Sales", "Head of Sales", "Director of Sales", "VP of Business Development", "Vice President of Business Development", "Director of Business Development", "Chief Revenue Officer", "Chief Growth Officer", "VP of Marketing", "Chief Marketing Officer", "Head of Growth"]
- `industries`: ["Staffing and Recruiting"] on all three. Segment C is tiny in getleads (~150), that is the data, not a filter error.

## Lane: Deal origination (the PE angle)

The offer: SalesGlider originates off market deals, finds businesses for buyers to acquire. Target is anyone who would be interested in deal origination, not portfolio ops.

- `company_description`: "private equity" for the core pull, plus a second pull on "search fund, independent sponsor, family office, acquisition, buyout"
- `job_titles`: ["Partner", "Managing Partner", "Managing Director", "Principal", "Founder", "Co-Founder", "Vice President", "Head of Business Development", "Director of Business Development", "VP of Business Development", "Head of Deal Origination", "Head of Deal Sourcing", "Director of Corporate Development", "Head of M&A", "Director of Acquisitions", "VP of Acquisitions"]
- Size floor: 5 plus employees via `employee_profiles_on_linkedin_min: 5`. No band filter.
- Combined pool ~28k as of Aug 16 2026, the biggest volume lever SG has.

## Pipeline

count_contacts → export_contacts per lane/segment → poll `check_contact_export` → `lp_run ingest_csv` client_tag `salesglider` (dedupe_key email, one source_label per segment) → master dedupe SQL on `lp.salesglider_ingested_leads` against `public.leads` union `public.suppression` in Supabase project `azpapwtnrbzywlnxxecz` → `lp_export` table `ingested_leads` for the verification file URL. Re-run the master dedupe after every ingest, ingests re-add previously deleted dupes. No lead rows in chat at any step. Success is net-new after dedupe, never rows exported.

## Known failure modes

- Importer NULLs state/industry/employee_range. Do not post-filter on them.
- getleads industry and band labels are exact enums; wrong values 400 with the valid list.
- Verification intake is by file URL only; never inline emails into verify tool args.
