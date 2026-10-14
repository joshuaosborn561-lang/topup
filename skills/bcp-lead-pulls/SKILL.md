---
name: bcp-lead-pulls
description: Pull or top up leads for Bolder Cyber Partners (Mike Trpkosh, fractional CISO and security program builds). Use whenever Josh asks for BCP leads, Bolder Cyber leads, Mike's lanes, PE firm or portfolio company pulls for Mike, or includes BCP in a multi client pull. Encodes the lane ICPs from Mike's calls, the VC and junior title cuts, and how each lane splits into campaigns.
---

# Bolder Cyber Partners lead pulls

Client: Mike Trpkosh, Bolder Cyber Partners (vCISO, security program builds, tabletop exercises). Smartlead client_id 542838. client_tag `bcp`. ICP source of truth: `topup.client_icp` where client_tag = 'bcp'. Read it before any pull. Note that titles and headcount were never stated by Mike on any call; the title sets below are what the builds used and are marked inferred in client_icp.

## Global rules for every BCP lane

- Venture capital firms are out of every BCP campaign (Mike, Oct 5: VC firms take the call but will not push founders to use anyone). Private equity is in.
- No one person companies (Oct 5).
- Must be high ticket enough to pay $5k to $20k a month. Josh's example of a no: a five person tire shop.
- Accelerators are a gray area. Flag to Josh for Mike, do not auto include.
- Nationwide. Mike is rural DFW but one booked meeting was a Utah hospital.
- MSPs are a referral channel only (Right of Boom), never a cold lane.

## Lanes

| Lane | Who | Source used |
|---|---|---|
| pe_firms | partners and operating partners at PE firms whose portfolio companies need security work | getleads, description match on private equity plus partner and operating titles |
| healthcare_exec | owners and second seats at HIPAA regulated healthcare companies and hospitals; IT leader where one exists | getleads |
| logistics_exec | owners and executives at logistics and trucking companies, including established family owned carriers | getleads |
| it_dm_airpods | IT decision makers at 51 to 1,000 employee healthcare and logistics companies | getleads |
| generic_owner | owners and second seats at under 1,000 employee companies, the SMB exit or acquisition angle | getleads |

PE lane title cut (`topup.lane_exclusions`, Sept 3): never Associate, Analyst, Vice President, Fellow or Student. 385 junior rows were purged after loading on Sept 3; keep that purged set out of future pulls.

## How each lane splits into campaigns (D106 records, Oct 13)

- healthcare_exec: Under 1k (getleads bands 1 to 10 through 501 to 1000) vs Over 1k; With Team when `sports-team-assignment` finds a local MLB or NFL team (or NHL city override), else No Team which gets AirPods (a college team does not count); SEG twin when the verifier flags a security email gateway. Over 1k No Team (#3763802) is COMPLETED and Over 1k SEG campaigns are drafts, so those rows wait for Josh.
- it_dm_airpods: Healthcare when the industry mentions hospital, medical or health, otherwise Logistics; all AirPods Max, no team split; SEG twin as above.
- Run `sports-offer-season` before any ticket lane top up.

## ICP gate cuts (`topup.gate_cut_rules`)

- PE lanes (tag bcp): investment_bank_or_advisor, other_investor_or_asset_manager (hedge funds, REITs, wealth managers), venture_capital_firm. Operating companies are kept in the PE lanes on purpose.
- Healthcare, logistics and IT lanes (tag bcp_ops): government_or_public_body, it_or_security_services_provider (competitor), other_industry_operating_company (copy is vertical specific), software_or_technology_vendor, solo_or_too_thin, staffing_or_recruiting.

## Pipeline

Follow `lead-list-build`. Size with `getleads-tam-counting` (job_functions plus seniority, not short title lists). Export, `lp_run ingest_csv` client_tag `bcp` with one source_label per lane, master dedupe, `icp-website-gate` with variant `bcp` for PE lanes and `bcp_ops` for the rest, Email Verifier Progression, then `merge-field-qa` and import. End with `first-pull-receipt` and `record-list-build`.

## Known failure modes

- PE description matches pull in juniors and non PE investors. Audit titles and run the gate before verification.
- Engagers sourced for SG PE lanes sit at portfolio companies; that is a judgment call, not a BCP rule.
