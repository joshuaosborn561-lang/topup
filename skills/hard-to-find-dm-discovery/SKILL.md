---
name: hard-to-find-dm-discovery
description: Find named decision makers and their emails for ICPs whose buyers are largely absent from B2B contact databases... dealership service departments, trades, local operators, franchise multi-location businesses, and similar. Use whenever getleads, LeadMagic, AI Ark, or FullEnrich return zero or wrong-title people at a company, when a client's buyer is a non-desk role, or when Josh says the prospects are not on LinkedIn. Covers the Google-indexed SERP discovery method, the two-stage email resolution that follows it, and the catch-all problem. Every number here was measured on a real 604-rooftop dealership build.
---

# Finding DMs who are not in B2B databases

Standard enrichment assumes the buyer maintains a professional profile. For a Service Director,
a shop foreman, a plant supervisor, or a franchise operator, that assumption fails, and every
LinkedIn-derived vendor fails with it in the same way.

This is the method that works instead. It is slower to set up and far cheaper to run.

---

## First: diagnose which failure you have

When a vendor returns nothing at a company, there are two very different causes and they need
different responses. Run `find_company_employees` with **no title filter**:

- **Zero employees returned** → no coverage at all. No title list will help. Go to SERP discovery.
- **Full roster, no managers** → the company is covered but the buyer is not in that database.
  Measured example: a BMW store returned 28 employees, all client advisors, valets, lot attendants
  and BDC reps, with zero service management. Also go to SERP discovery.

Do not keep widening the title list. That was the wrong instinct and it wastes calls.

---

## Stage 1: discovery via Google-indexed profiles

Public profiles are indexed by Google even when the paid databases have not crawled them. That gap
is the whole opportunity.

**Actor:** `apify/google-search-scraper`, $0.0045 per query, ~90 seconds for 110 queries.

**Query per company:**
```
site:linkedin.com/in "{Company Name}" ("Service Director" OR "Service Manager" OR "Fixed Operations" OR "Warranty Administrator")
```

Swap the title clause for the client's ICP. Also worth running: `site:facebook.com "{Company}" "{title}"`,
and unquoted `"{Company}" "{title}"` which surfaces aggregator pages (Prospeo, ZoomInfo, Datanyze)
that publish key contacts **and per-company email format patterns**.

**Batch 90 to 110 queries per actor run.** Larger payloads become unwieldy in an agent context.

**The output already contains what you need.** Each result carries:
- `organicResults.url` — the profile URL (always present, since the query is `site:` scoped)
- `personalInfo.jobTitle`, `personalInfo.companyName`, `personalInfo.location`
- `description` — the profile snippet including work history

**Filtering is mandatory.** Raw precision is 20 to 30%, because Google matches past employers and
unrelated profiles. A Connecticut dealership query returned a bookkeeper in Georgia. Keep a row only
when the parsed `companyName` matches the queried company **and** `jobTitle` contains a target term.
Filtered properly, hit rate on the queries measured was roughly 75%.

**Clean the company list before querying.** Strip parts departments, service-only listings, EV
charging stations, and other non-rooftop entries, or you burn queries on things that are not
companies.

---

## Stage 2: name to email, in two steps that fail on opposite cases

This is the part that took a full day to learn. **Run both, in this order.**

### Step 1 — Name to Email Finder, now Hunter-first

As of 2026-08-14 the finder runs Hunter.io before any guessing. Per person: **pattern cache →
Hunter domain-search → pattern candidate → verification**. Hunter-sighted addresses are promoted
to top candidate; accept-all domains skip SMTP and tag the candidate `catchall_pattern`.

Statuses, and the distinction matters:
- `valid` — confirmed on a non-catch-all domain, often from a Hunter sighting. Trustworthy.
- `catchall_pattern` — accept-all domain, candidate built from Hunter or cached pattern evidence
  at medium confidence. **This is the money class**: route it to No2Bounce, which confirmed 56%
  of them deliverable on the dealership build.
- `catchall` — accept-all domain, inference-only pattern, low confidence. Same routing, lower odds.
- `not_found` — **not a real verdict on a patterned domain.** The Hunter build barely runs SMTP
  (2 attempts across 365 rows measured), and M365 and Proofpoint swallow probes anyway. Treat these
  as unverified candidates for the verifier stack, not as dead ends.

Mechanics that prevent misdiagnosis: the pattern cache lives in **Railway Postgres on the finder
service, not Supabase**; `run.stats` is empty until completion so mid-run `hunter_calls: 0` means
nothing; every Hunter call is logged as `Hunter call endpoint=... domain=...` in deploy logs.
Hunter bills per domain with a 180-day cache, cap `MAX_HUNTER_CALLS=300`.

Measured on 302 dealership people across ~220 domains: 237 Hunter calls, 174 patterns cached,
4 valid plus 65 catchall_pattern for **$0.004** server cost. The pre-Hunter permutation build spent
$3.05 on the same list for 2 valids. Dominant dealership patterns: `{f}{last}` and
`{first}.{last}`, with a minority of `{first}@` shops.

### Step 2 — vendor waterfall on everything that was not `valid`

Email Finder Waterfall, `need='email'`, `max_tier='fullenrich'`.

**This is not redundancy. It recovers exactly the cases permutation structurally cannot.**
Measured: 4 rows that permutation had returned `not_found` or `catchall` on, **4 of 4 resolved**.
getleads 0/4, LeadMagic 0/4, FullEnrich 4/4 in a single call.

Why permutation missed all four:

| Person | Permutation guess | Actual | Reason |
|---|---|---|---|
| Greg Howell | `garavelchryslerjeepdodgeram.com` | `<first>@garavel.com` | group mail domain |
| Jeff Shankman | `gengrascdjrfairfield.com` | `<initial+last>@gengras.net` | group mail domain |
| Douglas Dente | `douglas@…` | `<nickname>@devanacura.com` | nickname |
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
3. **Public sighting.** A SERP query for `"@domain.com"` costs half a cent and a hit is confirmation.

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
- **LeadMagic `find_people_by_role`** — 0 of 7. Matcher too strict, use `search_people` with
  `titles[]` instead, which hit ~35%.

---

## Cost, measured

| Step | Cost |
|---|---|
| SERP discovery | $0.0045 per company |
| Permutation hit | ~$0.005 |
| Permutation miss | ~$0.02 |
| Vendor waterfall | ~1 credit per email found, free on miss |
| Blended, real mix | ~$0.013 per contact |

Roughly 650 companies cost about $3 to search. That is the cheapest discovery method tested by a
wide margin, and it reaches people no database has.

---

## Rules

- Filter SERP results on company **and** title. Unfiltered output is 70 to 80% noise.
- Never present a catch-all guess as a verified address.
- Always pass a real company name to FullEnrich.
- Suppress the client's existing accounts before anything loads into a sending tool.
- When a vendor returns zero, diagnose coverage versus title gap before spending more.
- Success is contactable people with correct titles, never rows returned.
