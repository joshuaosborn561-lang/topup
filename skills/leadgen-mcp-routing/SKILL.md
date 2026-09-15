---
name: leadgen-mcp-routing
description: Decide which MCP or connector to use for a lead-gen job, based on measured hit rates and cost per useful output rather than guessing. Use whenever Josh asks to find companies, find decision makers, find or verify emails, size a TAM, or asks which tool to use for a lead-gen step. Starts by deciding whether the ICP is LinkedIn-native (route getleads, AI Ark, LeadMagic, Prospeo, FullEnrich) or physical (route Google Maps Scraper plus PermitStack), and says to ask Josh when it is neither. Covers Google Maps Scraper, PermitStack, getleads, AI Ark, LeadMagic, Prospeo, FullEnrich, Apify, LeadPipe, MillionVerifier, and No2Bounce. Especially important for hard ICPs where the buyer has little online presence, like contractors, dealership service departments, trades, and local operators.
---

# Lead-gen MCP routing

Pick the tool by what it actually returns for the ICP in front of you, not by what it is
advertised to do. Every number below is measured, not estimated.

## Before this skill: size the TAM

Run **`tam-sizing`** first. It establishes how big the universe actually is and how much of it is
net-new after suppression. Routing without a number means building with no stopping condition,
which is how a harvest runs to a vendor's ceiling instead of to the ICP's real size.

Sizing also answers the LinkedIn-native question below, so the two skills share step zero.

---

## Step zero: is this ICP LinkedIn-native?

**Answer this before anything else.** It decides the whole route, and getting it wrong is how
credits get burned on a database that structurally cannot hold the buyer.

**LinkedIn-native** means the buyer maintains a professional profile as a normal part of the job:
IT and security leadership, staffing and PE, MSP owners, SaaS and OEM sellers, CS and renewals,
corporate functions generally, and most desk roles at 50+ employee companies.
→ Route to **getleads → AI Ark → LeadMagic → Prospeo → FullEnrich**, and use AI Ark for TAM sizing
and department-size filtering. The rest of this skill describes that path.

**Not LinkedIn-native** means the buyer is an operator whose business exists physically rather than
on LinkedIn: contractors and trades (Peterson), dealership service departments, franchise and
multi-location rooftops, local operators, warranty and home services (Carlos / Vasco), property
owners. These people are often not in any B2B contact database at all, and running one against them
returns zero or returns the wrong person.
→ Route to the **physical-footprint path**: whichever of these the ICP actually appears in.
  - **Google Maps Scraper** if they have a storefront, service address, or listing. Every brand and
    subtype as its own category (see Stage 1).
  - **PermitStack** if they pull permits ... contractors, roofers, solar, GC, earthworks. Permits give
    you the company, the jurisdiction, and often the licence holder's name, which Maps does not.
  - **Both together** when the ICP does both: permits establish who is actually working, Maps
    establishes the rooftop and the phone. This is the Peterson pattern.
  - Then `domain-waterfall` for the website, `people-waterfall` or SERP DM discovery for the human,
    and `hard-to-find-dm-discovery` when the vendors come back empty.

**If the ICP appears in neither Maps nor permits, stop and ask Josh.** Do not improvise a third
route and do not fall back to the LinkedIn-native stack hoping it works. An ICP with no physical
footprint and no LinkedIn presence needs a source decision from him ... a licensing roll, an
association roster, a trade directory, a scraped registry. Ask before spending anything.

Mixed ICPs exist. A client can have a LinkedIn-native lane and a physical lane at once (Peterson's
GC-partner lane versus vacant-land owners). Route each lane separately rather than picking one
stack for the client.

---

## The four stages

Every lead build is the same four stages. Never skip to stage 3 without stage 2.

1. **Find companies** — the rooftop, site, or location list
2. **Find the person** — name plus title at that company
3. **Find the email** — convert name plus company into an address
4. **Verify** — confirm it is safe to send

Stages 2 and 3 are different problems with different winners. Conflating them is the single most
common mistake. A tool that is excellent at stage 3 can be useless at stage 2.

---

## Stage 1: find companies

**Google Maps Scraper `run_leads`.** Free against the ultra plan quota.

Pass **every brand or subtype as its own category**, not one generic term. A single-category
dealership scrape returned 755 rows; the same geography with 23 brand categories returned 5,913.
That is an 8x difference and it silently understates the TAM.

Then `classify_leads` with an explicit ICP. Gemini Flash Lite, roughly $0.27 per 6,000 rows.
Write disqualifiers into the ICP text explicitly, and still audit the output: a classify run that
was told to exclude repair shops still passed 429 of them.

**Known bug:** `export_csv` with `client_tag` does not reliably scope. A Basco-tagged export
returned California, Florida, Texas and Louisiana rows. Always re-filter on state and city after
export.

**DiscoLike lookalike expansion.** When the client has a customer list, seed
`discover-similar-companies` with up to 10 customer domains instead of guessing filters. Measured
on the Goliath mortgage build (2026-08-13): 230 results at similarity 93 to 95 from 10 seeds.
Two caveats that both bit:
- **Starter plan has no `exclude_domain`**, so customer and campaign suppression happens post hoc
  in SQL, not in the call. Pad `max_records` above target to absorb the strip.
- **37% of raw results were not companies.** Umbrella vanity pages (68 rows named "Loan Factory"
  or NEXA), personal loan-officer pages (15 rows whose company name was a person's name), and
  duplicate companies on second domains. Dedupe by name pattern before anyone sources DMs, or the
  list is one third phantom buyers. Full method in the customer-lookalike-expansion skill.

**Vendor-mention harvest for displacement campaigns.** getleads `job_description` keyword search
on a competitor's product name is a free stage 1 and stage 2 in one shot: it returns the people
who run that tool and their companies. Exact phrases are honored (an "Arctic Wolf" query returned
312, not the 50k token-OR pool the count preview implied). **Expect roughly two thirds channel
contamination**: measured 3,862 of 5,839 harvest rows were MSSPs, resellers, and IT services
firms, not in-house buyers. Strip by company name pattern and vendor domain at ingest
(LeadPipe `ingest_csv` exclude filters do this server side). The surviving third is the actual
displacement audience.

---

## Stage 2: find the person

This is the hard stage for any ICP whose buyer does not maintain a profile. Measured on 368
dealership rooftops:

| Source | Result |
|---|---|
| Team page / site crawl | 0 of 368. Staff pages are gutted or JS-rendered |
| getleads by domain | 0 of 8. Matches group domains only, never individual rooftops |
| getleads by domain, LinkedIn-native ICP | 23 of 144 mortgage shops at owner titles, free. See below |
| LeadMagic `find_people_by_role` | 0 of 7. Matcher too strict, do not use |
| LeadMagic `search_people` with `titles[]` | ~35%, 1 to 3 credits, free on miss. **Best paid option** |
| AI Ark via waterfall | 80% found a body, but only 12 to 20% had the right title |
| FullEnrich `search_people` by domain | ~5% |
| FullEnrich `search_people` by title plus geography | **Best free option.** Discovery costs 0 credits |
| Apify `apify/google-search-scraper` | **Best coverage.** $0.0045 per query |

**getleads stage 2 performance is entirely ICP-dependent.** On dealership rooftops it is
structurally zero. On LinkedIn-native ICPs it is the correct free first pass: the Goliath
mortgage build (2026-08-14) got owner-level DMs at 23 of 144 companies for zero credits, and the
same query showed 340 total contacts across those domains, meaning most misses were title gaps
(getleads knows the loan officers, not the owner), which is exactly the case the paid waterfall
converts. Run the free domain pass first whenever the buyer plausibly maintains a profile:
finance, SaaS, agencies, professional services. Skip it only for the non-desk ICPs in the
hard-to-find-dm-discovery skill.

**Two things that actually work.**

**FullEnrich people-first search.** Instead of asking "who is the service manager at this company,"
ask "who holds this title in this metro." Search is free; `export_contacts` is 0.25 credit per row.
That flip matters because a domain-keyed query fails when the company has no coverage, while a
title-keyed query only ever returns people who do exist. It surfaced 1,236 service-side people
across a tri-state area for 309 credits.

**Apify Google SERP.** Query pattern:
```
site:linkedin.com/in "{Company Name}" ("Service Director" OR "Service Manager" OR "Fixed Operations Director" OR "Warranty Administrator")
```
This found a Service & Parts Director at a store where getleads, LeadMagic and FullEnrich all
returned zero. Google indexes public profiles that the paid databases have not crawled.

The actor returns `personalInfo.jobTitle` and `personalInfo.companyName` parsed out. **You must
filter on both.** Raw precision is 20 to 30% because Google matches past employers and unrelated
profiles: a query for a Connecticut dealership returned a bookkeeper in Georgia. Keep a row only
when the parsed company matches the queried company and the parsed title is a target title.

Also worth querying: `site:facebook.com`, and aggregator pages like Prospeo and ZoomInfo, which
Google indexes and which publish key contacts plus per-company email format patterns.

**Do not use DealerRater or equivalent review sites for staff discovery.** 14 staff scraped across
9 dealerships were all sales. Customers review the person who sold them the car, never the fixed
operations director, so the roster is sales by construction.

---

## Stage 3: find the email

**First stop is DiscoLike find emails** (D36 item 71). Name to Email is paused — it now
runs Hunter.io internally, and Hunter is banned (item 14). DiscoLike is the cheap first
rung. It is not a leadtopup client yet; leftover names go to Email Waterfall.

Historical note, Name to Email Finder, which ran Hunter.io internally as of
2026-08-14 (do not turn it back on without Josh):

- Flow per person: **pattern cache → Hunter domain-search (limit 10) → pattern candidate →
  SMTP or verifier**. A Hunter-sighted address is promoted to top candidate. An accept-all
  domain skips SMTP entirely and the candidate is tagged `catchall_pattern` for No2Bounce.
- **The pattern cache lives in Railway Postgres on the finder service, NOT in Supabase.**
  `public.domain_email_patterns` in Supabase exists but is empty unless dual-write is turned on
  (needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the finder service). A Hunter-is-dead
  diagnosis based on the Supabase table is wrong. This mistake cost a full re-run once.
- Hunter **bills per domain, not per contact**, and the cache is 180-day permanent, so territory
  cost is one-time. Cap is `MAX_HUNTER_CALLS` on the finder service (set to 300).
- **`run.stats` is empty until the run finishes.** A mid-run `get_run` showing `hunter_calls: 0`
  means nothing. Post-fix builds write `hunter_calls` live and log every call as
  `Hunter call endpoint=... domain=... result=...`, so grep deploy logs before diagnosing.
- **`not_found` is not a verdict on a patterned domain.** The SMTP stage barely runs in the
  Hunter build (2 attempts across 365 rows measured); M365 and Proofpoint swallow probes anyway,
  so a correct guess and a wrong guess look identical. The verifier stack is the judge.

Measured on the same 302-person dealership list: pre-Hunter build spent **$3.05 for 2 valids**
(8 SMTP attempts per row). Hunter build made **237 Hunter calls, cached 174 domain patterns, and
produced 4 valids plus 65 catchall_pattern candidates for $0.004** in server cost. No2Bounce then
confirmed over half of that candidate class deliverable (see stage 4).

**Escalation for what the finder misses: Email Waterfall.** Tier order is now
**getleads → AI Ark → LeadMagic → Prospeo → FullEnrich last**. Prospeo was added 2026-08-14.
LeadMagic's email tier is demoted; keep the LeadMagic MCP connected for discovery tooling
(`search_people`, `employee_finder`, account intel), and cut its email tier only if measured
incremental yield behind Prospeo collapses.

**The waterfall service is client-generic as of 2026-08-14.** `enrich_waterfall` auto-ensures any
snake_case `client_tag` and writes to isolated `public.{tag}_wf_companies` /
`{tag}_wf_contacts`. `ensure_client` and `list_clients` exist for explicit setup. The default
title profile is owner-ranked (Owner → Founder → ... → GM); pass `target_titles` to override, and
`require_title_match=true` drops wrong-title bodies instead of counting them. Pass
`company_name` on every row (the FullEnrich requirement below applies to every tier).
**Deploy warning:** the 2026-08-14 genericization went to Railway via `railway up` because the
GitHub push 403'd, so production is ahead of the repo. A source redeploy erases it until the repo
is pushed.

**FullEnrich critical requirement: pass a real `company_name`.** The identical 84 contacts
returned **0 emails** without it and **68** with it. FullEnrich matches on person plus company, so
a domain string in the company field gives it nothing to anchor to. Check before spending.

---

## Stage 4: verify

**Email Verifier Progression** runs the whole waterfall in one call: MillionVerifier classifies,
catch-all and unknown route to No2Bounce automatically, final merge produces SENDABLE and REJECTED
files. Nothing enters a campaign without this.

Measured on 554 dealership addresses (2026-08-14): **437 sendable, 79%**. MV passed 334 clean and
flagged 185 catch-alls; **No2Bounce confirmed 103 of the 185 deliverable (56%)**. Hunter
`catchall_pattern` candidates are exactly what No2Bounce converts, so the finder-to-verifier pipe
is the catch-all answer, not SMTP.

`start_verification` needs a **publicly reachable CSV file_url with an Email column**. For data
sitting in Supabase, use the supabase-csv-endpoint skill (RPC plus edge function) to mint that URL
without pulling rows into chat, and ingest the results CSVs back server-side the same way.

---

## LeadPipe

LeadPipe is the **store and job runner**, not a discovery method. It holds companies and contacts
per client and keeps row data out of chat. Response discipline is counts only, never row
payloads; inspect via `lp_sample` (max 10 rows).

**Clients are self-service as of 2026-08-14.** `lp_ensure_client({client_tag})` creates
`client_<tag>` schemas plus `{tag}_ingested_leads` and registers the tag; `lp_run` auto-ensures,
so a brand-new snake_case tag works with no setup step. `lp_list_clients` shows what exists. The
old rule that a new client needs its source registered first is dead for ingestion; it still
applies to `backfill` sources.

**`ingest_csv` is the universal downloadable-file intake** (added 2026-08-14). Any presigned or
public CSV/XLSX URL goes server side into `{tag}_ingested_leads` without touching chat:
- `params`: `urls[]` (required), `source_label`, `dedupe_key` (`email` default or
  `company_domain`), `exclude_name_patterns[]` (case-insensitive substring on company name),
  `exclude_domain_list[]`, optional `column_map`.
- Header dialects auto-detect (getleads, AI Ark, Smartlead, generic snake_case). Content hashing
  makes re-runs idempotent. Response returns per-file rows_read, filtered_out, dupes_dropped,
  rows_inserted, unique_company_domains.
- First measured run: three getleads harvest CSVs, 5,839 rows in, 1,809 clean contacts at 1,485
  companies out, vendor strip applied at ingest.
- Presigned getleads URLs live 24 hours; ingest promptly or re-export free.

For the reverse direction (Supabase table out to a public CSV URL, and result CSVs back in), use
the supabase-csv-endpoint skill. The two together mean rows never pass through chat in either
direction.

`find_dms_by_title` routes to **paid vendor enrichment at roughly $0.10 per company**. On 4,284
companies that is $428. It silently ignores `sources`, `queries`, `limit` and `icp_only` params, so
passing SERP sources does nothing. Check the estimate before approving, and scope the company set
before running rather than trying to scope inside the job.

---

## Cost per useful output, ranked

| Method | Cost per useful contact |
|---|---|
| Maps scrape | free against quota |
| FullEnrich title search | free, export 0.25 credit per row |
| Apify Google SERP | ~$0.02 at 25% precision |
| Name to Email Finder with Hunter | pennies per run plus 1 Hunter credit per new domain, cached forever |
| LeadMagic `search_people` | ~2 credits per rooftop |
| FullEnrich email enrichment | ~1 credit per email found |
| LeadPipe `find_dms_by_title` | ~$0.10 |
| Full verification waterfall | ~$0.02 to $0.03 per head, 79% sendable measured |

---

## Rules

- Never run a paid job without an estimate and an explicit dollar figure stated first.
- Success is useful output, never rows processed. A job returning 3,000 rows at 5% correct titles is
  a failed job. Say so.
- Audit titles before declaring a pull good. AI Ark returns whoever is first at a domain, which has
  produced a service porter and an accounting clerk counted as decision makers.
- **AI Ark silently drops filter keys it does not recognize.** No error, HTTP 200, and the result set
  comes back as if the filter were never sent. A 200 therefore proves nothing. Verify every new AI Ark
  filter by partition: run the query with the filter, then with its inverse, and confirm the two totals
  sum to the unfiltered total. If they do not, the filter is being ignored. This has caused two wrong
  conclusions: the Accenture incident (`companyEmployeeSize` ignored through the MCP wrapper, a 676k
  employee company returned inside a 201 to 2,000 band) and a same-day claim that AI Ark had no
  department-size filter, when in fact five guessed field names had all been silently dropped.
- **Read the AI Ark docs before guessing a field name.** `https://docs.ai-ark.com/llms.txt` is the
  index; append `.md` to any reference page for the full OpenAPI schema. Field names are not
  guessable and the silent-drop behavior makes guessing look like a definitive negative result.
- When a vendor returns zero, check whether it is a coverage gap or a title gap. `find_company_employees`
  with no title filter answers this: zero employees means no coverage, a full roster with no managers
  means the person is not in that database at all.
- Suppress the client's existing accounts before anything loads into a sending tool.
- Re-filter geography after any export. Client tagging is not reliably scoping.
- getleads is structurally 0 for ~1,400 lifetime on dealership rooftops. Never run it on rooftop
  lists; it only costs latency. Per-client tier disable is the fix. On LinkedIn-native ICPs the
  opposite holds: run the free getleads domain pass before any paid tier (23 of 144 mortgage
  shops at owner titles, zero credits).
- Lookalike and harvest lists are dirty by default: dedupe umbrella brands, personal vanity
  pages, and channel companies before counting the list or sourcing DMs against it. 37% of a raw
  DiscoLike pull and 66% of a vendor-mention harvest were not real buyers.
- Before declaring an integration dead, verify the deploy actually shipped: check the latest
  SUCCESS deployment timestamp against the merge time, and check the database the code actually
  writes to. Stale mid-run stats plus the wrong database produced two wrong diagnoses in one night.
- A run that spends dollars against the OLD build after a merge is a diagnostic, not a failure of
  the new code. Confirm which build served the run before judging the integration.

---

## AI Ark: department-size filtering (the only vendor in the stack that does it via API)

**LinkedIn-native ICPs only.** Department headcount is derived from profile counts, so it is
meaningful for IT, sales, engineering and other desk functions at companies whose staff are on
LinkedIn. It is worthless on contractors, rooftops and local operators ... those ICPs have no
department data to filter and route through Maps plus PermitStack instead (see Step zero).

Measured 2026-09-08. This is the filter that defines a small-IT ICP, and it lives in a place nobody
would guess: `account.metric`, not any spelling of "department".

```json
"account": {
  "employeeSize": { "type": "RANGE", "range": [ { "start": 201, "end": 2000 } ] },
  "location":     { "any": { "include": ["United States"] } },
  "metric": {
    "employee": [ { "function": ["information_technology"], "start": 1, "end": 15 } ]
  }
}
```

- `metric.employee` is the **current absolute headcount** of a department, `start` to `end`.
- `metric.growth` is the **percentage change** of that department over `timeFrame`:
  `ONE`, `THREE`, `SIX`, `TWELVE`, `TWENTY_FOUR` (months). A department that is growing is one of
  the strongest intent signals available ... a growing IT team is buying IT.
- `function` takes one of **27** values: `sales`, `marketing`, `engineering`, `finance`,
  `human_resources`, `information_technology`, `operations`, `business_development`,
  `customer_success_and_support`, `product_management`, `accounting`, `legal`, `consulting`,
  `education`, `research`, `purchasing`, `real_estate`, `media_and_communication`,
  `quality_assurance`, `arts_and_design`, `healthcare_services`, `entrepreneurship`,
  `community_and_social_services`, `administrative`, `military_and_protective_services`,
  `program_and_project_management`, `support`.
  Note these are the **department-metric** values, a different and much shorter list than the 592
  `contact.departmentAndFunction` values.
- Works on both People Search / Preview and Company Search. Company Search also has
  `account.employee` (title / seniority / departmentAndFunction) for "which companies even employ
  a Head of Data", which People Search does not have.

**Verified partition, Insight ICP:**

| Query | Total |
|---|---|
| IT DMs, US, 201 to 2,000, director+ | 89,138 |
| ... with IT dept 1 to 15 | **16,940** |
| ... with IT dept 16+ | 72,162 |

16,940 + 72,162 = 89,102, within 36 of the unfiltered total. That sum is the proof the filter binds.
Always run this partition check on a new filter rather than trusting a 200.

**Cost of the answer: 3 credits.** People Preview is a flat 1 credit per page regardless of page size,
so a TAM count is 1 credit. Prospeo can also filter department size but costs roughly 4 credits per
100 domains and only flags domains you already hold. AI Ark answers the population question directly.

**Vendors that can filter department headcount:** AI Ark (API, cheapest), Prospeo (API, per-domain),
Apollo (API, but paywalled off the free plan entirely), LinkedIn Sales Navigator (UI only).
getleads and LeadMagic cannot do it at all.
