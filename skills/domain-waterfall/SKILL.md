---
name: domain-waterfall
description: Turn a company name plus a location into a domain using the Domain Waterfall MCP. Use whenever a table has company names but no domains and the next step needs one... permit contractors, Maps businesses with no website, parcel owners, CRM rows missing a website, a client list that arrived as names only. Also use whenever Josh says resolve the domains, find their websites, we have names but no domains, or asks why a getleads or enrichment run returned nothing on a company list. Encodes the acceptance gate, the sink check, and the vendor inputs that were missing when name-to-domain was written off as impossible.
---

# Domain Waterfall

Company name plus location in, domain out. It never finds a person and never finds an email. If you need those, this is step one and `people-waterfall` is step two.

MCP: `domain-waterfall` on Railway. Tools: `resolve_domain`, `receipt_test`, `ensure_profile`, `get_profile`, `get_job_status`, `list_jobs`.

## When this is the right tool

You have a table with `company_name` and a city, and the thing you actually want needs a domain: getleads batch, LeadMagic employee_finder, Smartlead lookup, an email finder, anything.

Signals in Josh's words: "we have names but no domains", "resolve the domains", "find their websites", "getleads returned nothing on these", "the permit contractors".

**Not this tool** when the row already has a domain (go straight to `people-waterfall`), when you have a person's name and need their address (that is the Email Finder Waterfall), or when you need to discover companies in the first place (that is Google Maps Scraper or getleads search).

## How to call it

One call. Source table in, counts out. Never inline rows, never rows in the response.

```
resolve_domain(
  source_table = 'client_peterson.gc_adjudication',
  where        = "lane='commercial_gc' and domain is null and city is not null",
  client_tag   = 'peterson_roof',
  estimate_only = true
)
```

Read the estimate, state the dollar figure to Josh, get approval, then run the same call with `estimate_only=false` and `approve_cost_usd` set to the ceiling. Poll `get_job_status`. Do not fire ten parallel jobs... one job pages 500 at a time server side and a fan-out is what tripped the Smartlead throttle on Sept 9.

Free tiers run without a ceiling check. Paid tiers stop cleanly at the ceiling and mark rows `deferred`.

## Before the first run for a new client

`get_profile(client_tag)`. If there is no profile, build one with `ensure_profile` before anything else. The profile is where all the industry and geography logic lives, and a wrong profile is the single biggest source of bad domains.

The fields that matter most:

- `geo.area_codes` and `geo.states`. On Peterson this gate alone removed 44 percent of otherwise-clean matches that were in the wrong metro.
- `industry_reject_regex`. What a wrong-industry domain looks like for this client. A GC lane rejects roofing and HVAC domains. An IT lane rejects nothing, because an IT buyer can be in any industry.
- `name_strip_tokens`. The generic words to remove before token matching. Construction words for GCs, dental words for dentists, staffing words for staffing.
- `ground_truth`. The table used by `receipt_test`.

Then run `receipt_test(client_tag, 25)` once per client before spending on that client at volume. It scores every tier against known-correct domains, drops zero-yield tiers from the profile, and records hit rates. Costs about $2. A vendor strong on DFW trades can be weak on national B2B, so the receipt is per client, not once ever.

## Reading the output

`wf_domain_status` is what matters:

- `resolved` ... use it
- `review` ... one geo signal missing, or two tiers disagreed and both candidates are in `wf_domain_candidates`. Do not stage these without a look
- `deferred` ... hit the cost ceiling, re-run with a higher one
- `domain_unresolved` ... **not a dead end.** The row still carries company name, city, and any phone a tier returned. Hand it to `people-waterfall`, which has tiers that take a company name with no domain, and hand any phone to Cayden's lane

`wf_domain_agreement=true` means two independent tiers returned the same domain. That is the strongest signal available and those rows can be staged with the least review.

## What this fixes, and why the old answer was wrong

Name to domain was written off in Aug 2026 after DiscoLike returned 12 of 12 wrong and FullEnrich returned a Kenyan pension fund for a Dallas GC. Both were called with the company name only. DiscoLike accepts city, state, zip and phone. AI Ark accepts a phone and a geo circle. None of that was passed.

Maps `resolve_places` was written off for a broken confidence score. The score is real but pinned at 0.35 for right and wrong alike. The ranking underneath is sound. At `min_confidence=0.25` with an area code gate behind it, the top match was correct 8 of 10 times.

So when a tool "does not work" for this job, check what inputs it was given before believing it.

## Two failure modes to watch

**Sinks.** A vendor that cannot match a name will hand back a generic business, and the same domain then appears for dozens of different companies. On Sept 9, 51 domains absorbed 1,827 companies, the worst taking 135. The service nulls these before writeback, but if you ever see a domain count far below the row count, check for sinks before trusting anything.

**One-to-one does not mean correct.** A domain matched by exactly one company can still be the wrong company in the wrong state. The geo gate is what catches that, not uniqueness. Do not report a resolve rate before the gate has run.

## Hand off

Resolved domains go to `people-waterfall`. Unresolved rows go to `people-waterfall` too, in company-plus-city mode. Nothing stops here.
