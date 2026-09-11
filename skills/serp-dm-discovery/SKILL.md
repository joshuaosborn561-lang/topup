---
name: serp-dm-discovery
description: Find decision makers at companies invisible to B2B databases (getleads, AI Ark, LeadMagic) using Google-indexed LinkedIn profiles via the Apify MCP google-search-scraper actor, then resolve emails. Use whenever vendor discovery has been exhausted on a company list, when Josh says serp it, run the serp lanes, or find the people on Google, or when a tool-mention search is wanted (people whose profiles name the vendor, e.g. Carbon Black or SentinelOne). Encodes the fire-all-batches-in-parallel rule so runs never execute one at a time, the two query styles, the strict company-match filter, and the current-employer audit that catches stale profiles. Measured Aug 2026 on the Goliath displacement build.
---

# SERP DM discovery

Finds the humans B2B databases can't see: Google indexes LinkedIn profiles that vendor
indexes miss or misfile. Two query styles, both cheap (~$0.0045 per company via
apify/google-search-scraper), both measured on the Goliath displacement build Aug 2026.

## When to reach for this

- Vendor waterfall (getleads, AI Ark, LeadMagic) already ran on the list and coverage is
  still short. SERP recovered 15 to 30 percent of companies the entire vendor stack missed.
- The buyer is identifiable by a TOOL, not a title... "whose profile says Carbon Black"
  finds the admin who feels the renewal regardless of what their card reads.

## The two query styles

Style A, title search (one query per company):
    site:linkedin.com/in "{Company Name}" ("IT Director" OR "CIO" OR "CISO" OR "VP of IT" OR "Director of Information Technology" OR "Head of IT")

Style B, tool mention (one query per company, vendor from the tech tag):
    site:linkedin.com/in "{Company Name}" "{Vendor}"

Use the conversational company name (company-name-normalization output), never the legal
name. Both styles per company when budget allows... they surface different people.

## Execution rules (this is the part that used to take forever)

1. **Fire ALL batches as parallel Apify runs.** Call the actor with waitSecs=0 per batch
   and move immediately to the next call. Runs execute simultaneously on Apify's side...
   ten batches finish in ~3 minutes total, not 30. NEVER wait for one run before starting
   the next. The actor is already internally concurrent (110 queries in ~150s).
2. Batch 90 to 110 queries per run (newline-joined string in `queries`), resultsPerPage 10,
   maxPagesPerQuery 1, countryCode us.
3. Collect every runId + default datasetId as each call returns, THEN poll and fetch after
   all are fired. Fetch with get-dataset-items, clean=true, omit heavy fields
   (htmlSnapshotUrl, relatedQueries, customData, paidResults, suggestedResults). Big
   results auto-store to /mnt/user-data/tool_results/... parse the file in bash, never in chat.
4. MCP: Apify (mcp.apify.com), actor apify/google-search-scraper. Cost ~$0.0045/query,
   verify at call time.

## Filtering (mandatory, in bash, no rows in chat)

Keep a result row ONLY when both hold:
- organicResults.personalInfo.companyName contains the queried company (first ~10 chars,
  case-insensitive). Short or ambiguous company names ("Ashby", "ATC", "Loop") pollute
  SERPs with surname and wrong-company matches... the companyName field check is what
  kills them. Expect roughly 75 percent precision after this filter.
- For style A: jobTitle matches a target title. For style B: the vendor term appears in
  personalInfo.rawText or description.

Parse first and last name from the profile URL slug (linkedin.com/in/first-last-...),
title-cased, skipping numeric tokens. Drop rows where the slug yields fewer than two
name tokens.

## Email resolution, two lanes in parallel

1. Name to Email Finder start_run with {first_name, last_name, domain} objects... cheapest,
   run first, $1 max_cost per ~50 people.
2. LeadMagic linkedin_to_email bulk (submit_detected_bulk_job, enrichment linkedin_to_email,
   rows of {profile_url, company_name}) on ALL kept profiles including borderline ones...
   1 credit per hit, free on miss, and it rescues real people the strict filter dropped.

## The current-employer audit (non-negotiable)

LeadMagic resolves the PERSON, and stale profiles resolve to their CURRENT employer
somewhere else. On the Goliath build, 26 raw hits contained 12 fakes: a Strava query
returned @docusign.com, a Nexxen query returned @bioreference.com, one hit was literally
retired, plus wrong-company name collisions (Brazilian Arteris, wrong Loop, wrong ATC).
KEEP ONLY hits whose email domain matches the target company domain. Cross-vendor
agreement (Name to Email and LeadMagic returning the same address) is high-confidence
catch-all evidence.

## Measured yields (Goliath, Aug 2026)

- Style A: 94 companies searched, 14 confirmed emails at 13 companies after full audit.
- Style B: 110 companies, 24 vendor-mention profiles at 19 companies pre-resolution.
- Cost: ~$0.42 per 94-company batch plus ~130 LeadMagic credits per 54 profiles.
- Everything the SERP lanes still miss goes to phone outreach with names as openers,
  per hard-to-find-dm-discovery.
