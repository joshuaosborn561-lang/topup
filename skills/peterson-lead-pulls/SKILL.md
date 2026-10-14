---
name: peterson-lead-pulls
description: Pull or top up leads for Roofs by Peterson (Kyle Peterson and Dwight, DFW commercial roofing). Use whenever Josh asks for Peterson roofing leads, Kyle leads, building owner pulls, the PermitStack plus LLC unmasking push, roofing GCs, property managers or churches for Peterson. Not for Cornerstone Earthworks, which has its own skill and must never share write targets with this one.
---

# Roofs by Peterson lead pulls

Client: Kyle Peterson and Dwight, Roofs by Peterson (Rockwall TX, DFW commercial roofing). Smartlead client_id 548610. client_tag `peterson`. ICP source of truth: `topup.client_icp` where client_tag = 'peterson'. Peterson roofing and Cornerstone Earthworks (`peterson_earthworks`) never share Supabase write targets.

Kyle is churning as of Oct 2026. Josh is doing the current push as a favor and wants it cheap. Do not propose expensive tiers.

## Lanes

| Lane | Who | Geography |
|---|---|---|
| building_owners | owners of commercial buildings, the entity or person behind the LLC, reached directly | 30 percent DFW metro proper, 70 percent ring towns (Waxahachie, Royse City, Fate, Greenville, Lavon, Farmersville, Ennis, Red Oak, Maypearl, Italy) |
| c1 general_contractors | owner, project manager, estimator or preconstruction at commercial GCs who sub out roofing | DFW; Collin County cities added after Dallas and Tarrant ran dry |
| c2 property_managers | owner, GM, property manager at commercial and multifamily management firms | DFW, weighted to firms officing in higher end areas (Rockwall, Heath) |
| c3 churches | churches that own their building; pastor, executive pastor, business administrator | DFW plus the southern ring (Waxahachie alone has eight) |

Historical positives came from the GC lane (three on 800 emails, Aug 28).

## Current push (Oct 2026): building owners

- Find owners through PermitStack commercial permits, then unmask the shell LLCs (`unmask-shell-llc`). Goal about 25k leads.
- Email only. Landlords (single family LLC owners) are parked: "landlords are for the phone" and Josh is not running calling for Kyle.
- Josh cut DiscoLike for this run. Use AI Ark on the misses and AI Ark as the Email Finder Waterfall max tier. Estimate first.
- Cut companies over 500 employees.
- In: churches, property managers, owners. Out: real estate agents, nonprofits, schools (Josh, Oct 2026, stated in chat; not on a recorded Kyle call).

## Exclusions

- Realtors (Aug 28: they use bids as leverage).
- ICP gate cuts (tag peterson): government_or_public_school, no_physical_property, other_trade_contractor, residential_real_estate_or_homeowner, roofing_contractor. Suppliers and manufacturers that own big buildings are kept on purpose (never discussed on a call either way).
- Property managers of run down, low rent portfolios: screened behaviorally by Dwight from the website, not a hard list filter. Always attach the website.
- National homebuilders quarantined from the GC pool.

## How the Sept 2026 lanes were built

PermitStack commercial permits plus the Maps corpus (`client_peterson.leads`) plus getleads. GC adjudication on permit behavior, not name keywords. Domains from Domain Finder Waterfall (Maps strategy, min_confidence 0.25, area code, trade and sink gates; a reject regex that was too broad ate 485 Maps hits until loosened to roofing only). People via Find Named Person, emails via Email Finder Waterfall (free getleads and Smartlead tiers made 94 percent of contacts). SEG twins of C1, C2, C3 created by duplicate_campaign.

## Pipeline

Follow `lead-list-build`. PermitStack via Permits MCP (project kemvxzhcxvynmoutwdrh), `unmask-shell-llc`, `domain-waterfall` for names only rows, `icp-website-gate` variant `peterson`, people and email, Email Verifier Progression, `merge-field-qa`, import. End with `first-pull-receipt` and `record-list-build`.

## OPEN

- Several Kyle calls (Sept 11, 25, 28, Oct 9) have empty Fireflies records, so any ICP change made on them is not recoverable. The nonprofit and school exclusion rests on Josh's own word.
