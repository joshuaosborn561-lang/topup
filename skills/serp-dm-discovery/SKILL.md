---
name: "serp-dm-discovery"
description: "Find decision makers at companies invisible to B2B databases using Google-indexed LinkedIn profiles via Serper (public.serper_search), then resolve emails. Use when vendor discovery is exhausted, Josh says serp it, or you need a named person's own employer."
---

# SERP DM discovery

Finds the humans B2B databases can't see: Google indexes LinkedIn profiles that vendor
indexes miss or misfile. SERP work runs on **Serper**, never SerpApi, and no longer on the
Apify google-search-scraper actor (switched Oct 12 2026, roughly 4 to 5 times cheaper).

## When to reach for this

- Vendor waterfall (getleads, AI Ark, Prospeo) already ran on the list and coverage is
  still short. SERP recovered 15 to 30 percent of companies the entire vendor stack missed.
- The buyer is identifiable by a TOOL, not a title... "whose profile says Carbon Black"
  finds the admin who feels the renewal regardless of what their card reads.
- You have a person's name and an organization they are tied to (a hospital board, a
  nonprofit, a licence), and need where they actually work.

## The tool: Serper, server side

Function `public.serper_search(run_label, client_tag, queries text[], num default 10)` on
campaignintelligence (`azpapwtnrbzywlnxxecz`). It reads `serper_api_key` from the Supabase
vault, sends queries to google.serper.dev in batches of 100, and writes every organic result
to `public.serp_results` (run_label, client_tag, query, position, url, title, snippet).
`public.serp_runs` logs queries and credits per run_label. Returns the result count only.

- Build the query array in SQL from the source table, never in chat:
  `select public.serper_search('nutter_board_li_2026_10_12', 'nutter', array_agg(q)) from ...`
- About 1,000 queries per SQL statement keeps it under the statement timeout. Loop in
  chunks by offset for bigger lists; the calls are synchronous, so there are no runs to poll.
- Cost: 1 credit per query at num 10 (2 credits above 10). Roughly $0.001 per query on the
  base pack, cheaper on bigger packs. Verify the current price and state the dollar figure
  before running, per the approval rule.
- If the function raises `serper_api_key missing from vault`, stop and ask Josh to add the
  key to the vault. Do not fall back to Apify or SerpApi without his say so.

## The three query styles

Style A, title search (one query per company):
    site:linkedin.com/in "{Company Name}" ("IT Director" OR "CIO" OR "CISO" OR "VP of IT" OR "Director of Information Technology" OR "Head of IT")

Style B, tool mention (one query per company, vendor from the tech tag):
    site:linkedin.com/in "{Company Name}" "{Vendor}"

Style C, person search (one query per known person):
    site:linkedin.com/in "{First}" "{Last}" {Organization they are tied to}

Use the conversational company name (company-name-normalization output), never the legal
name. Run A and B together per company when budget allows... they surface different people.
For style C, do NOT add a state code: people often live out of state, and the organization
name anchors the match better than geography.

## Filtering (mandatory, in SQL, no rows in chat)

Serper returns raw `title`, `link` and `snippet`, not parsed profile fields. LinkedIn result
titles read `First Last - Title - Company | LinkedIn` (sometimes only one middle field).
Parse in SQL: `split_part(title, ' | ', 1)` then split on ` - `. The snippet often carries
`Experience: {Company}` and `Location: ...`.

Keep a result row ONLY when:
- the url contains `linkedin.com/in/`, and
- the parsed company (title or `Experience:` in the snippet) contains the queried company
  (first ~10 chars, case insensitive). Short or ambiguous names ("Ashby", "ATC", "Loop")
  pollute results with surname and wrong-company matches; this check kills them.
- Style A: the parsed title matches a target title. Style B: the vendor term appears in the
  title or snippet. Style C: both first and last name appear in the result title.

Parse first and last name from the profile URL slug (linkedin.com/in/first-last-...),
title cased, skipping numeric tokens, when the title is truncated. Drop rows with fewer than
two name tokens. When the employer is ambiguous, an LLM pass over title plus snippet (Gemini
from the vault, server side) extracts `{employer, title}`, and must return empty for retired
people or for the organization the person was searched by.

## Email resolution

1. **Resolve the employer's domain first** (domain-waterfall, company name plus city and
   state), then run the Email Finder Waterfall with {first_name, last_name, domain},
   `need='email'`, `max_tier='prospeo'`. Name plus company mode with no domain is far weaker
   on small local employers: measured Oct 12 2026 on Nutter board members, 12% by name and
   company versus 51% after resolving the domain first.
2. LinkedIn URL to email on ALL kept profiles, including borderline ones, since it rescues real
   people the strict filter dropped. getleads `getleads_get_emails_from_linkedin_batch` first
   (one plan credit per success, covered by the unlimited plan), then AI Ark `export_single` by
   `url` for the misses (paid, estimate first, 404 when no email). Run both server side,
   never with profile rows in chat. LeadMagic filled this lane until Oct 8 2026, when it was
   removed from the stack.

## The current-employer audit (non-negotiable)

URL to email lookups resolve the PERSON, and stale profiles resolve to their CURRENT employer
somewhere else. On the Goliath build, 26 raw hits contained 12 fakes: a Strava query
returned @docusign.com, a Nexxen query returned @bioreference.com, one hit was literally
retired, plus wrong-company name collisions (Brazilian Arteris, wrong Loop, wrong ATC).
For company lanes (styles A and B), KEEP ONLY hits whose email domain matches the target
company domain. For person lanes (style C) the target is the person's own employer, so the
email domain must match the employer domain resolved in step 1. Cross-vendor agreement is
high-confidence catch-all evidence.

## Measured yields

Goliath, Aug 2026 (measured on the Apify actor; re-measure on Serper):
- Style A: 94 companies searched, 14 confirmed emails at 13 companies after full audit.
- Style B: 110 companies, 24 vendor-mention profiles at 19 companies pre-resolution.

Nutter hospital board members with no LinkedIn hit on name plus state, Oct 12 2026, 200 people:
- Style C with the hospital name: 42 profiles matched (21%), 29 with an own employer.
- Open web `"{First}" "{Last}" {hospital} {city}`: 58 own employers extracted from snippets.
- Domain first, then waterfall: 38 emails total from the 200 (19%), pre-verification.

Everything the SERP lanes still miss goes to phone outreach with names as openers,
per hard-to-find-dm-discovery.