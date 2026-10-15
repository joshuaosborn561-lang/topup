---
name: "people-waterfall"
description: "Turn a company into named decision makers with the titles a client actually wants, using the People Waterfall MCP. Use whenever you have companies (with or without a domain) and need the humans... after a Maps or permit or parcel pull, after domain-waterfall resolves, when a lead list has companies but no contacts, or when a vendor returned people with the wrong titles. Also use when Josh says find the DMs, who do we email there, get me the contacts, the titles are wrong, or asks why a pull came back with receptionists and retirees. Encodes the title-over-seniority rule, the company match check, and the name bank so no discovered person is ever thrown away."
---

# People Waterfall

Company in, named people with a target title out. It never finds an email (email is Email Finder Waterfall, then Email Verifier Progression). Title-matched people go to the Email Finder Waterfall, which is a separate service and stays that way.

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
  skip_tiers    = 'discolike',
  estimate_only = true
)
```

Estimate, state the dollar figure, get approval, run with `approve_cost_usd`. Poll `get_job_status`. One job, not a fan-out.

## Order, revised 2026-10-14

1. **`site-people-dm` first.** The company's own people pages, read server side. Free apart from the model call, and it finds the buyers who are not in any B2B database (churches, local owners, owner operated shops). Run that skill's standard name-pick filters every time (old-year / history-page founders, franchise HQ, plain real estate agents, names not in site text, then the cheap current-local-DM check) before handing anyone to email.
2. **`serp-dm-discovery` second.** Google indexed LinkedIn profiles via Serper, on the companies step 1 left empty.
3. **`resolve_people` on what is still empty**, with DiscoLike skipped by default: pass `skip_tiers=discolike`. That leaves `cache` → `aiark`. Run DiscoLike only when Josh asks for that tier on this pull; it is optional, not part of the default.

SERP, getleads, Smartlead and Prospeo stay in the code behind `skip_tiers` / `min_tier` / `max_tier` and a profile can opt one back in, but no client runs them unless its `people_tier_order` names them. Check `get_profile(client_tag)` before running so the order you expect is the order that runs.

Measured on the same EMCOR ICP (CA churches, schools, funeral homes, practices, office and facilities managers), companies with a title matched person:

| Tier | Hit rate | Cost per company |
|---|---|---|
| serp (site:linkedin.com/in only), 4,600 companies | 14 percent | $0.008 |
| discolike generate contacts, 50 SERP misses, native, 5 queries a domain | about 60 percent | $0.0085 ($0.25 Serper plus $0.175 DiscoLike per 50) |

DiscoLike hit well on that pilot because it reads the company's own site and directories, which is what `site-people-dm` now does first. That is why DiscoLike is optional rather than default. AI Ark sits behind to catch LinkedIn native people the site and SERP passes missed. On trades it is measured at about a 94 percent owner title rate at roughly half a cent; on the EMCOR style office and facilities ICP it has not been measured, so run `receipt_test` per client before trusting it there.

`discolike` tier rules, when it is asked for: needs a domain (no domain rows skip it, reason `no_domain`); one task per job, never chunked into concurrent tasks; `integration_id=native`, `search_context_size=low`, `max_contacts_per_domain=5`, `find_emails=false`; icp_text built from the profile's `target_titles`. Every gate below applies to its output, because the pilot returned surname collisions, a same name business, and one name hallucinated from the domain. Rows never pass through chat: the pilot did that once by calling the MCP tool directly, which is why the tier lives inside this service. `email_pattern` and `email_pattern_confidence` are written to the company row for the Email Finder Waterfall to seed from.

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

Free tiers first on LinkedIn native lists: cache, getleads batch, Smartlead made 94 percent of every Peterson GC contact. On Maps native lists they are structurally near zero, which is why the 2026-09-29 default order drops them.

The cheap roster pattern now runs on AI Ark. `/people/preview` is a flat 1 credit per page of up to 100 results, so a title filtered roster pull costs far less per person than any per result lookup. Use preview for discovery, then filter titles in SQL for free. AI Ark `/people` search is 0.5 credits per result, so never use it for bulk. A profile without contact info is all this resolver needs, and re-exporting a contact already owned is free forever. Always pass titles to AI Ark: without a title it returns whoever appears first at a domain.

The service sorts tiers on live rates at job start. Do not hand-order them and do not assume a remembered price.

## Hand off

`title_match=true` goes to the Email Finder Waterfall. `people_unresolved` goes to the phone lane. Name-bank rows wait for the next resolution pass. Nothing stops here either.