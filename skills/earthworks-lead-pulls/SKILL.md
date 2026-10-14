---
name: earthworks-lead-pulls
description: Pull or top up leads for Cornerstone Earthworks (Kyle Peterson and Dwight, DFW site work, irrigation, drainage, grading). Use whenever Josh asks for earthworks leads, Cornerstone leads, the irrigation and drainage relaunch, nonprofit or landowner lanes for Kyle, or the earthworks missing piece groups. Separate from Roofs by Peterson; the two never share write targets.
---

# Cornerstone Earthworks lead pulls

Client: Kyle Peterson and Dwight, Cornerstone Earthworks. Smartlead client_id 574088. client_tag `peterson_earthworks` (never `peterson`). ICP source of truth: `topup.client_icp` where client_tag = 'peterson_earthworks'.

Kyle is churning as of Oct 2026; keep spend low.

## Lanes

| Lane | Who | Status |
|---|---|---|
| irrigation_drainage_relaunch | churches, nonprofits, property managers and building owners who need irrigation, drainage, gutters, concrete, fencing; roofing in the PS | current (Sept 30 decision); runs under the Roofing and Construction by Peterson brand until Cornerstone has its own Google presence |
| nonprofits_and_faith_based | executive director or facilities at nonprofits and churches that own property and fund improvements from donors | kept, zero hits by Sept 30 |
| land_parcel_owners | anyone who owns land or parcels in the area | seasonal: send late spring through summer, fall sends got "already done" replies |
| gc_preconstruction_and_public | preconstruction and estimating inside GCs; school districts and public entities paying net 30 | stale, from Aug 28 summary only, not confirmed Sept 30 |

Geography: DFW metro plus ring towns (Waxahachie, Ennis, Red Oak, Maypearl, Italy, Royse City, Fate, Greenville, Lavon, Farmersville). The Sept build gated sendable rows to 180 miles of Dallas.

## Exclusions

- The general_business persona (lane F) was dropped as out of ICP (Sept 14).
- getleads is excluded as a source for this client: 0 useful for 104 plus companies (Sept 14). Do not run it again here.
- ICP gate cuts (tag peterson_earthworks): excavation_or_sitework_contractor (competitor), no_physical_property, other_trade_contractor, residential_real_estate_or_homeowner (realtors out), supplier_manufacturer_or_rental. Schools and government are kept on purpose.

## How the Sept 2026 build was pulled

- Google Maps scrape of DFW churches and nonprofits (about 29,647 businesses).
- The three county commercial parcel roll (155,791 parcels, 72,570 owners) on project kemvxzhcxvynmoutwdrh. Shell LLC owners unmasked by matching parcel mailing addresses to operator offices.
- PermitStack commercial permits.
- Named leaders from team and about pages, emails via Email Finder Waterfall; role inboxes scraped from the business website for the role inbox lanes.
- Email Verifier Progression on everything (run ac2dbf47): 9,208 sendable of 10,060; No2Bounce recovered 1,894 catch alls; 1,477 SEG split into their own campaigns.

## Missing piece groups (pointers, counts move)

- Unmasked shell LLCs still needing a domain: kemvxzhcxvynmoutwdrh `public.ew_maps_addr_queue` where business_name is not null and domain is null.
- Waterfall exhausted rows still needing an email: azpapwtnrbzywlnxxecz `client_peterson.email_resolution` where dl_status = 'not_found'.
- 990 and Texas Comptroller officers with a name but no domain: kemvxzhcxvynmoutwdrh `public.ew_names_ready`.
- Verifier queue: azpapwtnrbzywlnxxecz `client_peterson.ew_verify_queue` (lane column marks source).

## Pipeline

Follow `lead-list-build`. Maps or parcels or PermitStack, `unmask-shell-llc`, `domain-waterfall` (names only rows), `icp-website-gate` variant `earthworks`, `site-people-dm` for named leaders, Email Finder Waterfall (estimate first), Email Verifier Progression, `merge-field-qa`, import. End with `first-pull-receipt` and `record-list-build`.
