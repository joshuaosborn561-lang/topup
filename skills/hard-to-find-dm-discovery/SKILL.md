---
name: "hard-to-find-dm-discovery"
description: "Find named decision makers and their emails for ICPs whose buyers are largely absent from B2B contact databases (dealership service, trades, local operators, franchises). Use when vendors return zero or wrong-title people, or Josh says the prospects are not on LinkedIn."
---

# Finding DMs who are not in B2B databases

Standard enrichment assumes the buyer maintains a professional profile. For a Service Director,
a shop foreman, a plant supervisor, or a franchise operator, that assumption fails, and every
LinkedIn-derived vendor fails with it in the same way.

This is the method that works instead. It is slower to set up and far cheaper to run.

---

## First: diagnose which failure you have

When a vendor returns nothing at a company, there are two very different causes and they need
different responses. Run an AI Ark people preview by domain with **no title filter** (1 credit per
page; this replaced LeadMagic `find_company_employees` when LeadMagic left the stack Oct 8 2026):

- **Zero employees returned** → no coverage at all. No title list will help. Go to SERP discovery.
- **Full roster, no managers** → the company is covered but the buyer is not in that database.
  Measured example: a BMW store returned 28 employees, all client advisors, valets, lot attendants
  and BDC reps, with zero service management. Also go to SERP discovery.

Do not keep widening the title list. That was the wrong instinct and it wastes calls.

---

## Stage 1: discovery via Google-indexed profiles

Public profiles are indexed by Google even when the paid databases have not crawled them. That gap
is the whole opportunity.

**Tool:** Serper via `public.serper_search(run_label, client_tag, queries[])` on campaignintelligence
(`azpapwtnrbzywlnxxecz`), key `serper_api_key` in the Supabase vault, results in `public.serp_results`.
Roughly $0.001 per query (verify at call time). Switched from the Apify google-search-scraper actor
on Oct 12 2026; SERP work uses Serper, never SerpApi. Call pattern and filters live in serp-dm-discovery.

**Query per company:**
```
site:linkedin.com/in "{Company Name}" ("Service Director" OR "Service Manager" OR "Fixed Operations" OR "Warranty Administrator")
```

Swap the title clause for the client's ICP. Also worth running: `site:facebook.com "{Company}" "{title}"`,
and unquoted `"{Company}" "{title}"` which surfaces aggregator pages (Prospeo, ZoomInfo, Datanyze)
that publish key contacts **and per-company email format patterns**.

**Build the query array in SQL and keep each call to about 1,000 queries.** The function batches 100 per request and returns counts only, so no rows pass through chat.

**What comes back.** Serper returns raw `link`, `title` and `snippet` per organic result. LinkedIn
titles read `First Last - Title - Company | LinkedIn`, and the snippet often carries `Experience: ...`
and `Location: ...`. Parse company and title out of those in SQL (see serp-dm-discovery).

**Filtering is mandatory.** Raw precision is 20 to 30%, because Google matches past employers and
unrelated profiles. A Connecticut dealership query returned a bookkeeper in Georgia. Keep a row only
when the parsed company matches the queried company **and** the parsed title contains a target term.
Filtered properly, hit rate on the queries measured was roughly 75%.

**Clean the company list before querying.** Strip parts departments, service-only listings, EV
charging stations, and other non-rooftop entries, or you burn queries on things that are not
companies.

---

## Stage 2: name to email

Name to Email Finder is retired (Sept 30 2026). With a name plus a domain, go straight to the
Email Finder Waterfall in person-to-email mode. Accept-all domains still go to No2Bounce through
Email Verifier Progression.

### Email Finder Waterfall on every named person

Email Finder Waterfall, `need='email'`, `max_tier='fullenrich'`, `skip_tiers='leadmagic'` (LeadMagic
was removed from the stack Oct 8 2026; skip it until the service default drops it).

**This is not redundancy. It recovers exactly the cases permutation structurally cannot.**
Measured: 4 rows that permutation had returned `not_found` or `catchall` on, **4 of 4 resolved**.
getleads 0/4, LeadMagic 0/4 (since removed), FullEnrich 4/4 in a single call.

Why permutation missed all four:

| Person | Permutation guess | Actual | Reason |
|---|---|---|---|
| Greg Howell | `garavelchryslerjeepdodgeram.com` | `greg@garavel.com` | group mail domain |
| Jeff Shankman | `gengrascdjrfairfield.com` | `jshankman@gengras.net` | group mail domain |
| Douglas Dente | `douglas@…` | `doug@devanacura.com` | nickname |
| Robert Clement | `robert.clement@…` (catch-all guess) | `robertc@…` | wrong pattern, unverifiable |

**Two structural traps this exposes.** Multi-location groups consolidate mail onto a parent domain
that differs from the rooftop's web domain, and no permutation tool can infer that. And people in
these roles use shortened first names. Both are invisible to pattern generation and both are
captured in vendor data.

**FullEnrich requires a real `company_name`.** The same 84 contacts returned **0 emails** without it
and **68 with it**. It matches on person plus company, so a domain string in the company field gives
it nothing to anchor to. Check this before spending.

---

## The catch-all ceiling, now with a measured answer

A catch-all server accepts every address, so SMTP verification proves nothing there. It also cuts
the other way: on M365 and Proofpoint domains a **correct** guess comes back not_found, so SMTP
failure proves nothing either. Never merge unresolved catch-alls into a main campaign, and never
treat SMTP not_found as disproof on these domains.

**The pipeline that resolves them, measured 2026-08-14:** Hunter pattern evidence in the finder
(`catchall_pattern` candidates) fed into **Email Verifier Progression**, whose No2Bounce stage
confirmed **103 of 185 dealership catch-alls deliverable, 56%**. Full waterfall on 554 addresses:
**437 sendable, 79%**. This replaces the theoretical resolution list below as the default path.

Fallbacks when the pipeline leaves residue, best first:

1. **Pattern inference from a known-good address at that domain.** One confirmed address settles
   the pattern for everyone else there. Seed from existing verified lists; free.
2. **Cross-vendor agreement.** Two vendors independently returning the same address is real
   evidence, since they derive from data rather than SMTP.
3. **Public sighting.** A Serper query for `"@domain.com"` costs about a tenth of a cent and a hit is confirmation.

Segment output always: **valid**, **catchall_pattern**, **catchall**, **unresolved**. Everything
except valid goes through the verifier before any campaign. Unresolved after No2Bounce go to a
phone list.

---

## What does not work, so nobody re-tests it

Measured on 368 dealership rooftops:

- **Company website team pages** — 0 of 368. Staff pages are gutted or the names sit behind JS.
  Do crawl deeper than 3 pages and hint `/staff`, `/about`, `/our-team` before concluding this,
  since a shallow crawl produces a false negative.
- **Review sites like DealerRater** — 14 staff scraped across 9 companies, all sales. Customers
  review whoever sold them the product, never the operations manager, so the roster is sales by
  construction. Same logic applies to any review-driven directory.
- **getleads by rooftop domain** — 0 of 8. Matches group domains only.
- **LeadMagic `find_people_by_role`** — 0 of 7; `search_people` with `titles[]` hit ~35%. LeadMagic
  was removed from the stack Oct 8 2026; AI Ark preview with titles is the replacement, unmeasured here.

---

## Cost, measured

| Step | Cost |
|---|---|
| SERP discovery (Serper) | ~$0.001 per company |
| Permutation hit | ~$0.005 |
| Permutation miss | ~$0.02 |
| Vendor waterfall | ~1 credit per email found, free on miss |
| Blended, real mix | ~$0.013 per contact |

Roughly 650 companies cost under $1 to search on Serper (about $3 on the old Apify actor). That is the cheapest discovery method tested by a
wide margin, and it reaches people no database has.

---

## Rules

- Filter SERP results on company **and** title. Unfiltered output is 70 to 80% noise.
- Never present a catch-all guess as a verified address.
- Always pass a real company name to FullEnrich.
- Suppress the client's existing accounts before anything loads into a sending tool.
- When a vendor returns zero, diagnose coverage versus title gap before spending more.
- Success is contactable people with correct titles, never rows returned.