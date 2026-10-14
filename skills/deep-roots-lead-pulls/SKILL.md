---
name: deep-roots-lead-pulls
description: Pull or top up leads for Deep Roots Capital (Tyler Leverington, PE deal origination buying owner run manufacturers in the Northern Plains). Use whenever Josh asks for Deep Roots leads, Tyler leads, Dakotas manufacturer owners, off market acquisition targets, or includes Deep Roots in a multi client pull or a caller list. Encodes Tyler's thesis, the four state Maps build, the manufacturer screen, and the owner only rule.
---

# Deep Roots Capital lead pulls

Client: Tyler Leverington, Deep Roots Capital. Smartlead client_id 597783. client_tag `deep_roots`. ICP source of truth: `topup.client_icp` where client_tag = 'deep_roots'. Gabe calls this list too, so caller lists follow `caller-list-numbers`.

## ICP

- Buyer: the owner or founder of an independent, privately held manufacturer who may be open to selling. CEO only when the CEO is the founder or owner. Never sales reps or other non owners.
- Target size: $1M to $10M EBITDA. Not filterable from data; it is a self qualifier in copy (every email states the range). Headcount proxy agreed on the call: drop 1 to 10 employee shops, keep 11 and up.
- Geography: North Dakota and South Dakota first, then Montana, maybe Minnesota; anywhere Northern Plains or upper Midwest only for a standout deal.
- Industries: manufacturing is primary. Ag processing, food manufacturing, concrete and printing were in the Sept 29 scrape and Tyler did not object.

## Exclusions

- Oil field equipment and anything oil field related (Tyler, explicit: boom and bust).
- Businesses already listed publicly with a broker such as BizBuySell.
- Chains (10 or more locations) and franchises; public companies.
- Non manufacturing owner run B2B is cut from the TAM: dealers, distributors, wholesalers, contractors, trucking.
- ICP gate cuts (tag deep_roots): contractor_or_trade, dealer_distributor_wholesaler, farm_or_consumer_service, other, subsidiary_chain_or_franchise, trucking_logistics.

## How the main build was pulled (Sept 30 to Oct 2 2026)

1. Google Maps Scraper per state (ND, SD, MT, MN), run_label `deep_roots_dakotas` into `lp.deep_roots_maps`, with owner, website and phone requirements OFF so small off market shops with only an info@ stay in. Categories: about 90 core manufacturing and industrial descriptors plus a 26 category add on list per state (full lists in the build transcript in `topup.list_build_records`). No employee sizing on Maps.
2. Screen in `lp.deep_roots_maps_screen`: keep tier A manufacturing and tier B adjacent production, cut tier C.
3. getleads owner arm merged in: owner titles, 86 manufacturing industry tags, many company_description keywords rather than NAICS codes.
4. People: DiscoLike generate-contacts (via Find Named Person). Email: Email Finder Waterfall to max_tier prospeo. Both paid, estimate first. On the next run people follow the current `people-waterfall` order: `site-people-dm`, then `serp-dm-discovery`, then `resolve_people` with DiscoLike optional (`skip_tiers=discolike` unless Josh asks for it).
5. Email Verifier Progression; SEG mail class split into its own campaign (main campaign 4084613 plus the SEG twin).

Session spend was about $90.

## OPEN items to confirm with Josh before the next pull

- The Maps category list included oilfield equipment, which Tyler explicitly excluded. Drop it on the next run unless Josh says otherwise.
- getleads size: memory records Josh saying 1 to 50 employees only; the call agreement drops 1 to 10. Likely the right band is 11 to 50 on getleads, but confirm.

## Pipeline

Follow `lead-list-build`. Maps: outcome mode, estimate_only first, state the dollar figure, get approval. Then `icp-website-gate` with variant `deeproots`, people, email, verification, `merge-field-qa`, import. For caller lists, DiscoLike website check before any paid phone lookup, Veriphone mobiles, dedupe against Cayden's lists, then hand off to SG Team and Calling. End with `first-pull-receipt` and `record-list-build`.

## Copy and call notes that affect the list

- Callers may name Deep Roots Capital but should not name drop Tyler right away.
- Every email, including Gabe's call follow ups, states the $1M to $10M EBITDA range.
