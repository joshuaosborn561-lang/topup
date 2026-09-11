---
name: people-waterfall
description: Turn a company into named decision makers with the titles a client actually wants, using the People Waterfall MCP. Use whenever you have companies (with or without a domain) and need the humans... after a Maps or permit or parcel pull, after domain-waterfall resolves, when a lead list has companies but no contacts, or when a vendor returned people with the wrong titles. Also use when Josh says find the DMs, who do we email there, get me the contacts, the titles are wrong, or asks why a pull came back with receptionists and retirees. Encodes the title-over-seniority rule, the company match check, and the name bank so no discovered person is ever thrown away.
---

# People Waterfall

Company in, named people with a target title out. It never finds an email. Title-matched people go to the Email Finder Waterfall, which is a separate service and stays that way.

MCP: `people-waterfall` on Railway. Tools: `resolve_people`, `receipt_test`, `get_profile`, `get_job_status`, `list_jobs`.

## When this is the right tool

You have companies and you need people. Works from a domain (better coverage) or from a company name plus city (the permit tail, trades, local operators, franchise locations, anyone whose buyer is a non-desk role).

Signals in Josh's words: "find the DMs", "who do we email there", "get me the contacts at these", "the titles are wrong", "we got receptionists".

**Not this tool** when the row has no domain and no city (nothing to search on), when you already have a person and need their address (Email Finder Waterfall), or when you need to find companies in the first place (Maps Scraper, getleads search, DiscoLike lookalikes).

## How to call it

One call. Source table in, counts out. Never inline rows, never rows in the response.

```
resolve_people(
  source_table  = 'client_peterson.gc_adjudication',
  where         = "wf_domain_status='resolved'",
  client_tag    = 'peterson_roof',
  estimate_only = true
)
```

Estimate, state the dollar figure, get approval, run with `approve_cost_usd`. Poll `get_job_status`. One job, not a fan-out.

## The title list is the whole game

Titles live in the profile, never in the call and never in code. Check `get_profile(client_tag)` before running and make sure the list matches what this client sells.

Measured: on 20 GCs, C-level and VP only returned 384 people. Adding Project Manager, Senior PM, Estimator, Chief Estimator, Superintendent, Preconstruction Manager, Purchasing Manager and Project Executive returned **1,677**. Those are the people who pick subcontractors.

Every vertical has its own version of that. The person who picks a roofing sub is a PM. The person who feels a Carbon Black renewal is a sysadmin, not the CIO. The person who books warranty work is a service manager. Goliath's profile carries a `title_exclude_regex` that drops the entire C suite, Parlay's drops COO and CTO. If a pull comes back with the wrong people, fix the profile, do not filter afterward.

## Before the first run for a new client

`receipt_test(client_tag, 15)` runs two tables: fifteen domains with known contacts, and fifteen companies with no domain. The second one is the number that matters, because it predicts the hard tail. It drops zero-yield tiers from the profile and records hit rates. Costs about $3.

Run it per client. A vendor strong on DFW GCs can be weak on New England IT.

## Reading the output

- `title_match=true` ... these go to the Email Finder Waterfall in name_company mode with the domain attached
- `source_confidence 0.5` ... person is outside the client geo, or came from a tier that may hallucinate. Hold for review, do not stage blind
- `people_unresolved` ... **not a dead end.** The row keeps company name, city, and any phone. That is a dialable record and it goes to Cayden's lane with the company as the opener

**Non-matching titles are not discarded.** They land in `public.name_bank` with the domain. A wrong title today is a name to call tomorrow, and the hardest-to-find people have the highest response rates. Never report a company as done with zero people unless it is verified closed.

## Three checks that decide whether a pull is good

**Title audit.** Never count a row before checking titles. AI Ark returns whoever appears first at a domain when `title` is omitted... on Peterson that produced 3 hits on 79 attempts. It is a good tier when called correctly and a waste when called lazily.

**Company match.** The vendor's returned company name must contain the first ten characters of the queried company, or its domain must equal the input domain. This one check held precision near 75 percent on the Goliath SERP build and is what kills surname collisions and wrong-company hits.

**Employment currency.** Stale profiles resolve to whoever the person works for now. Goliath produced replies from retired people because this was skipped. Prefer current employment wherever the vendor exposes it.

## Cost sense

Free tiers first, always: cache, getleads batch, Smartlead. Those three made 94 percent of every Peterson contact that exists.

Among paid tiers, LeadMagic `employee_finder` is 0.05 credits per employee, roughly 20x cheaper per person than any 1-credit lookup. Pull the whole roster, filter titles in SQL for free. AI Ark is 0.5 credits for a profile without contact info, which is all this resolver needs, and re-exporting a contact already owned is free forever.

The service sorts tiers on live rates at job start. Do not hand-order them and do not assume a remembered price.

## Hand off

`title_match=true` goes to the Email Finder Waterfall. `people_unresolved` goes to the phone lane. Name-bank rows wait for the next resolution pass. Nothing stops here either.
