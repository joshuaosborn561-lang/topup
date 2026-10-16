---
name: "domain-waterfall"
description: "Turn a company name plus a location into a domain using the Domain Waterfall MCP. Use whenever a table has company names but no domains: permit contractors, parcel owners, name only lists, or when Josh says resolve the domains or find their websites. Encodes tier order (Maps, Serper, DiscoLike), the gate gap, and the sink check."
---

# Domain Waterfall

Company name plus location in, domain out. It never finds a person and never finds an email. Finding a domain does not need a site crawl. Reading the site for people is the next step (`site-people-dm`, then `people-waterfall`).

MCP: `domain-waterfall` on Railway. Repo: joshuaosborn561-lang/domain-finder-waterfall. Tools: `resolve_domain`, `receipt_test`, `ensure_profile`, `get_profile`, `get_job_status`, `list_jobs`.

## When this is the right tool

You have a table with `company_name` and a city and state, and the thing you actually want needs a domain: getleads batch, the site-people edge function, Email Finder Waterfall, anything.

Signals in Josh's words: "we have names but no domains", "resolve the domains", "find their websites", "getleads returned nothing on these", "the permit contractors".

**Not this tool** on Maps lanes at all (decided 2026-09-29: a Maps listing with no website is cut at the scrape, so nothing reaches this service from Maps), when the row already has a domain (go straight to people finding), when you have a person's name and need their address (that is the Email Finder Waterfall), or when you need to discover companies in the first place (that is Google Maps Scraper or getleads search).

## Tier order: Maps, then Serper, then DiscoLike

Standard order for every profile (Josh, Oct 15 2026):

1. `maps`: free, always first.
2. `serp`: Serper Google search, about $0.001 per row. Query is always `{company_name} {city} {state}`, never the name alone.
3. `discolike`: about $0.00425 per row, only on what Serper missed. Sent with name, city, state, zip and phone at 80 match confidence.

The cheap tier goes first so the expensive one only bills on misses. Set it in the profile's `tier_order` and `enabled_tiers` with `ensure_profile`. `sg_subs` (SalesGlider PermitStack specialty subs) was switched to this order Oct 15 2026; it had DiscoLike before Serper.

The serp tier calls Serper since PR #11 (Oct 14 2026), not the Apify actor, so the old `skip_tiers='serp'` rule is retired. Confirm the estimate's `price_meta.serp.billing` reads "serper google search" at unit 0.001. Never SerpApi, never Apify.

AI Ark, Prospeo and LeadMagic are not domain tiers for local ICPs. LeadMagic was removed from the stack Oct 8 2026. If a profile's `tier_order` still lists `leadmagic`, remove it before running (peterson_roof carried it as of that date), or pass `skip_tiers='leadmagic'`.

## How to call it

One call. Source table in, counts out. Never inline rows, never rows in the response.

```
resolve_domain(
  source_table = 'public.sg_ps_nodomain_20261015',
  where        = "wf_domain_status is null",
  client_tag   = 'sg_subs',
  estimate_only = true
)
```

The source table must be on azpapwtnrbzywlnxxecz and needs `company_name`, `city`, `state`, and a key column named `id`. The tool refuses a table without one (add `id bigint generated always as identity`). `zip`, `phone` and `address` are picked up automatically and help DiscoLike match. Writeback columns are wf_domain, wf_domain_source, wf_domain_confidence, wf_domain_agreement, wf_domain_candidates, wf_phone, wf_domain_status.

The estimate counts every row at every tier, so it is a ceiling, not a forecast. Read `estimated_usd`, `rows` and `live_units`, state the ceiling to Josh, get approval, then run the same call with `estimate_only=false` and `approve_cost_usd` at the ceiling. Poll `get_job_status`. Do not fire parallel jobs; one job pages 500 at a time server side, and a fan out is what tripped the Smartlead throttle on Sept 9.

Free tiers run without a ceiling check. Paid tiers stop cleanly at the ceiling and mark rows `deferred`.

Writeback flushes per tier since PR #11, so a mid job failure no longer loses every tier. Still run big lists in slices with a `where` on id ranges, and never deploy the service while a job is running; jobs do not survive a redeploy.

## Before the first run for a new client

`get_profile(client_tag)`. If there is no profile, build one with `ensure_profile` before anything else. The profile is where all the industry and geography logic lives, and a wrong profile is the single biggest source of bad domains.

The fields that matter most:

- `tier_order` and `enabled_tiers`: maps, serp, discolike as above.
- `geo.area_codes` and `geo.states`, with `geo_required`. On Peterson the area code gate alone removed 44 percent of otherwise clean matches that were in the wrong metro.
- `industry_reject_regex`. What a wrong industry domain looks like for this client. A GC lane rejects roofing and HVAC domains. An IT lane rejects nothing.
- `name_strip_tokens`. Generic words removed before token matching: construction words for GCs, dental words for dentists, staffing words for staffing.
- `aggregator_blocklist`. Directories (yelp, bbb, buildzoom, manta and similar) are never accepted.
- `ground_truth`. The table used by `receipt_test`.

Then run `receipt_test(client_tag, 25)` once per client before spending at volume. It scores every tier against known correct domains, drops zero yield tiers, and records hit rates. Costs about $2. A vendor strong on DFW trades can be weak on national B2B, so the receipt is per client.

## Known gap in the acceptance gate (until Cursor fixes it)

The gate rejects any site whose domain does not contain a word from the company name, and the serp tier pre filters the same way before the gate sees it. Page titles are ignored. That throws away real sites like ph-ac.com (Prather & Harlan) and jfconstfl.com (John Farrell Construction). In the Oct 13 2026 PermitStack pilot about a third of the "no website" companies actually had one; 8 were recovered by hand. A Cursor prompt (cursor_prompt_domain_waterfall_title_gate.md, Oct 15 2026) asks to accept on page title plus geo, accept company initials plus title, stop the serp pre filter, and save rejected candidates.

Until it ships:
- Expect the resolve rate to undercount real sites.
- Before calling a large unresolved set "no website", hand check 20 on Google. If several have real sites, hold the full run for the fix.
- `review` rows with a candidate in `wf_domain_candidates` are often right; look before discarding.

Once the fix ships, remove this section and rerun `receipt_test`.

## Reading the output

`wf_domain_status` is what matters:

- `resolved` ... use it
- `review` ... one geo signal missing, or two tiers disagreed and both candidates are in `wf_domain_candidates`. Do not stage these without a look
- `deferred` ... hit the cost ceiling, rerun with a higher one
- `domain_unresolved` ... **not a dead end.** The row still carries company name, city, and any phone a tier returned. Hand it to people finding in company plus city mode, and hand any phone to the calling lane

`wf_domain_agreement=true` means two independent tiers returned the same domain. That is the strongest signal available and those rows can be staged with the least review.

## What this fixes, and why the old answer was wrong

Name to domain was written off in Aug 2026 after DiscoLike returned 12 of 12 wrong and FullEnrich returned a Kenyan pension fund for a Dallas GC. Both were called with the company name only. DiscoLike accepts city, state, zip and phone. None of that was passed.

Maps `resolve_places` was written off for a broken confidence score. The score is real but pinned at 0.35 for right and wrong alike. The ranking underneath is sound. At `min_confidence=0.25` with an area code gate behind it, the top match was correct 8 of 10 times.

So when a tool "does not work" for this job, check what inputs it was given before believing it.

## Three failure modes to watch

**Sinks.** A vendor that cannot match a name will hand back a generic business, and the same domain then appears for dozens of different companies. On Sept 9, 51 domains absorbed 1,827 companies, the worst taking 135. The service nulls these before writeback, but if you ever see a domain count far below the row count, check for sinks before trusting anything.

**One to one does not mean correct.** A domain matched by exactly one company can still be the wrong company in the wrong state. The geo gate is what catches that, not uniqueness. Do not report a resolve rate before the gate has run.

**Junk domain values.** A placeholder like `n`, `na`, `https` or `httpps` in a domain column is not a domain. On the Nutter build (Oct 2026) 86 hospitals carried `n`, and the email finder then returned @netflix.com addresses for 101 leads, 49 of which reached a live campaign before being paused. Before handing domains downstream, null any value without a dot and re-resolve it here.

## Hand off

Resolved domains go to `site-people-dm` (free site capture and SQL pick), then DiscoLike on the misses, then Email Finder Waterfall. Unresolved rows go to people finding in company plus city mode. Nothing stops here.