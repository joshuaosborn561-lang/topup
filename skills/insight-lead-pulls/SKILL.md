---
name: insight-lead-pulls
description: Pull or top up leads for Josh's own Insight book (IT decision makers at small IT departments, and OEM channel reps for the partner play). Use whenever Josh asks for Insight leads, IT DM pulls for his book, M365 or Okta offer lanes, OEM AE or CSM pulls, or includes Insight in a multi client pull. Encodes the SLED ban, the small IT department thresholds, the competitor and do not contact cuts, and the OEM title rules.
---

# Insight lead pulls

Josh's own book at Insight (full cycle B2B sales, SMB to emerging enterprise). Smartlead client "Insight", client_id 582890. Two LeadPipe tags: `insight` (schema client_insight, IT decision makers) and `insight_oem` (schema client_insight_oem, OEM channel reps). ICP source of truth: `topup.client_icp` rows for both tags; no recorded client call, these come from Josh's own rules.

## Lane 1: it_decision_makers (tag insight)

- Titles: IT Director, Director of IT, VP of IT, CIO, IT Manager, Head of IT. Managers only at companies under 500 employees (`topup.lane_exclusions`).
- Small internal IT department: IT dept under 15 at companies under 1k employees, under 25 at 1k to 2k, under 30 at 2k to 5k.
- US. Any private industry, nonprofits, healthcare.
- Offers: M365 license comparison tool (lead with the comparison, pricing second); E3 plus Okta overlap for confirmed Okta shops; for confirmed Okta plus M365 rows, "run Get-MgSubscribedSku and send me the output". Lanes were routed to offer campaigns by MX and technographic signals; SEG split by MX classification, not names.

## Lane 2: oem_channel_reps (tag insight_oem)

- AEs, AMs, CSMs and renewals managers at channel first vendors (Cisco, Fortinet, Okta, Palo Alto, Veeam and similar). New in seat reps are the priority segment.
- AEs get the territory TAM offer; CS and renewals reps get the Chipotle offer.
- Pulled by employer name and role in Josh's territory.

## Exclusions (both lanes)

- SLED and government accounts: never, Josh cannot work them.
- Accounts over $5k GP owned by other reps. Any account under $5k GP is workable.
- biomedrealty.com: do not contact (another rep owns it).
- Josh dedupes the domain list against his active Insight accounts before any send.
- Lane 1 gate cuts (tag insight): government_or_public_education, not_an_organization, solo_or_home_based, technology_vendor_or_oem (goes to lane 2), var_msp_or_it_reseller (competitor).
- Lane 2: never Druva; no SDR, BDR or channel titles; no resellers, distributors, MSPs or end customer companies.

## History worth knowing

- Sept 6 to 8 2026: getleads IT DM pulls (200 to 2,000 employees and a second title set), about 25k emailable, about 18k loaded.
- Sept 29 rebuild ("Partner Sucks"): five lanes had 2 interested on about 6,900 reached and a 9.7 percent bounce. Josh put the weak output on Microsoft senders hitting daily caps and declined re verification. Catch all verdicts on gateway domains proved unreliable; SEG lanes bounced 21 to 23 percent. Treat SEG catch alls with suspicion on the next pull.

## Pipeline

Follow `lead-list-build`. Size with `getleads-tam-counting` (job_functions Information Technology plus seniority, gross, no email_status filter), export, `lp_run ingest_csv` with the right tag, master dedupe, the domain dedupe against active accounts, `icp-website-gate` (variant `insight2` or `insight_oem`), Email Verifier Progression, `merge-field-qa`, import. End with `first-pull-receipt` and `record-list-build`.

## Copy notes that affect the list

IT DMs hate sales guys; copy is peer to peer in real IT language. Do not lean on price. The proof line is that nine of ten people who move to Josh do it because their current partner sucks.
