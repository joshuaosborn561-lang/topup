---
name: emcor-lead-pulls
description: Pull or top up leads for EMCOR Services / Mesa Energy Systems (Myles McAntosh, commercial HVAC, mechanical and plumbing, Sacramento branch). Use whenever Josh asks for EMCOR leads, Mesa leads, Myles lanes, the commercial plumbing or backflow lane, or includes EMCOR in a multi client pull. Encodes the lane ICPs from Myles's calls, the territory rule, the offer split by size and title, and which lanes must not use LinkedIn databases.
---

# EMCOR / Mesa Energy lead pulls

Client: Myles McAntosh, Director of Sales, EMCOR Services Mesa Energy Systems (West Sacramento, CA). Smartlead client_id 574020. client_tag `emcor`. ICP source of truth: `topup.client_icp` where client_tag = 'emcor' (quotes from Myles's Fireflies calls in `evidence`). Read it before any pull.

## Territory (applies to every lane)

The Sacramento branch county list Myles emailed. Not a radius. Sister EMCOR branches sit east, west and south of Sacramento and the Bay Area belongs to the Bay Area office (a San Ramon lead was handed off), so the list runs north. On calls describe Mesa as Northern California, not West Sacramento.

OPEN: the Sept 28 receipts for lanes A to E describe the pulls as "Bay Area" in three city chunks. That contradicts the territory rule above. Confirm with Josh which counties the next pull uses before running it.

## Lanes

| Lane | Buyer | Source |
|---|---|---|
| A property_facilities | property, asset and facilities managers, chief engineers, building engineers; owner operators and NNN tenants responsible for the building; property management groups; GCs picking mechanical subs | getleads |
| B plants_labs | chief engineer, facility director or manager, maintenance manager, plant operations at manufacturing process plants and biopharma labs | getleads |
| C hospitals_and_healthcare | chief engineer, facility director or manager; property manager for medical office buildings | getleads |
| D education | MOT director, facility director, facilities or maintenance manager at K12 districts and colleges | getleads |
| E small_operations | the owner operator of a small business that runs out of its own building (churches, wineries, vets, self storage, event venues, small property managers) | Google Maps, never LinkedIn databases |
| commercial_plumbing (Oct 2026) | facilities or operations decision maker at any building on a commercial meter | Google Maps across the 12 county footprint |

Size: no employee ceiling on any lane. Myles said facility size predicts fit, not headcount. Enterprise sites inside the territory stay in; very large national accounts route to EMCOR national accounts, so chain locations with no local decision maker are low yield.

## Lane rules Josh set

- Lane E and the plumbing lane: these people are not on LinkedIn based databases. Decision makers come from Maps plus `hard-to-find-dm-discovery` or `site-people-dm`, not getleads or AI Ark.
- Lanes A to D (LinkedIn native): getleads and AI Ark must agree on the TAM before building (size all three of getleads, AI Ark, Prospeo per `tam-sizing`).
- Commercial plumbing: the unit is the building, every building on a commercial meter within about two hours of Sacramento, sized by valve count. Be as inclusive as possible on single facility types. A few thousand is too small for this footprint; size it physically. Copy cannot say "free" or use dollar signs.
- Offer split (D106, confirmed in build records): AirPods when the company is 11 to 200 employees (getleads bands 11 to 50 and 51 to 200) and the title is not junior (assistant, coordinator, admin, intern, associate, technician, specialist); everyone else gets the Scope offer (preventive maintenance scope of work). No giveaways on blast to 1 to 10 person shops. Healthcare and education lanes run Scope only.
- SEG addresses go to the SEG twin campaign of the same offer.
- Rows without a usable first name are held at QA, never sent.
- Additional contacts at a company are fine; route each by the split above.

## Exclusions

- Existing EMCOR / Mesa clients: Myles's Dynamics 365 customer export (Aug 25 2026), suppressed by domain. Kaiser, Dignity Health, Blue Shield are existing MSAs.
- Prospects EMCOR already hit that replied or declined (silent ones are fair game).
- Ground up new construction (they only service existing systems).
- ICP gate cuts (`topup.gate_cut_rules` tag emcor): homeowner_or_home_based, hvac_or_building_services_contractor (competitor), no_physical_facility. Chains and GCs are kept on purpose.

## Pipeline

Follow `lead-list-build`. getleads lanes: `getleads-tam-counting` then count, export, `lp_run ingest_csv` client_tag `emcor`, master dedupe. Maps lanes: Google Maps Scraper outcome mode, estimate_only first, cut listings with no website at the scrape, then `icp-website-gate`, then `site-people-dm` or `hard-to-find-dm-discovery`, then Email Finder Waterfall (estimate first). Everything through Email Verifier Progression before Smartlead. Finish with `first-pull-receipt` and `record-list-build`.

## Stale methods in old receipts

The Sept 28 and 29 lane E receipts used Name to Email Finder (retired Sept 30) and a LeadMagic email tier (removed Oct 8). Do not repeat those. Use Email Finder Waterfall for name plus domain, and Serper for SERP discovery.
