---
name: tam-sizing
description: Size the addressable universe before building any lead list, so the build is scoped to a real number instead of running until a vendor stops returning rows. Use whenever Josh asks how many are out there, how big is the TAM, how many can we get, whether a pool is exhausted, or asks to build or extend a list for any client or lane. Runs first, before getleads, AI Ark, LeadMagic, Prospeo, DiscoLike, Maps, PermitStack or any DM or domain discovery. Covers the free and near-free count endpoints, the lookalike counters, the partition check that proves a filter actually binds, and the rule that two independent vendors must agree before a number is trusted.
---

# TAM sizing

Size the universe before you build the list. Every build is scoped to a number, and that number
comes from counting, not from running a pull until the vendor stops returning rows.

**This skill runs before `leadgen-mcp-routing`, not instead of it.** Sizing tells you how big the
lane is and whether it is worth building. Routing tells you which tools to use to build it.

## Why this exists

Three failures, all from skipping the count:

- A vendor returned 89,138 for an ICP whose real size was 16,940. The size filter was being
  silently ignored. Nobody checked, and the number sat in planning for a day.
- 62,752 names were harvested at real cost, then collapsed to ~11,000 usable companies once
  resolved. The universe was never counted first, so the harvest ran to the vendor's ceiling
  rather than to the ICP's actual size.
- A "the pool is exhausted" conclusion was reached from a pull returning fewer rows each run, when
  the true remaining universe had never been established at all.

A count is cheap or free. A wrong count is a day of work and a credit balance.

---

## The order

1. **Classify the ICP** ... LinkedIn-native or physical. See `leadgen-mcp-routing` step zero. The
   sizing method is completely different for each.
2. **Count the universe** with the cheapest endpoint that can express the ICP.
3. **Prove the filter binds** with the partition check below. A count from an ignored filter is
   worse than no count.
4. **Confirm with a second vendor.** One number is a guess. Two independent numbers within ~25%
   is a fact.
5. **Subtract what is already held** ... suppression, existing client lists, prior loads. The
   number that matters is net-new, never gross.
6. **Report the number and the method**, then route.

Never skip 3. Never skip 5.

---

## Sizing a LinkedIn-native ICP

### AI Ark People Preview ... 1 credit, the default

Flat **1 credit per page regardless of page size**, and `totalElements` is the count. This is the
cheapest population answer in the stack and it supports the full filter set including department
headcount.

```json
POST /api/developer-portal/v1/people/preview
{
  "size": 1, "page": 0,
  "account": {
    "employeeSize": { "type": "RANGE", "range": [ { "start": 201, "end": 2000 } ] },
    "location": { "any": { "include": ["United States"] } },
    "metric": { "employee": [ { "function": ["information_technology"], "start": 1, "end": 15 } ] }
  },
  "contact": {
    "departmentAndFunction": { "any": { "include": ["information_technology"] } },
    "seniority": { "any": { "include": ["c_suite","vp","head","director"] } }
  }
}
```

Header is `X-TOKEN`. Base is `https://api.ai-ark.com/api/developer-portal`. Read `totalElements`.

**Company-level count instead of people-level:** same body against `/v1/companies`, but that is
Company Search at 0.1 credits per returned result ... use `size: 1` so it costs 0.1. Preview has no
company equivalent.

### getleads `count_contacts` ... free, always run it

Zero credits, unlimited on the plan. Run it on every ICP even when another vendor is the primary,
because it is the free second opinion that satisfies step 4.

Band labels must be exact strings (`"201 to 500"`). Numeric `employees_min` / `employees_max`
causes silent band overlap. It cannot filter department size.

### DiscoLike `count-contacts` and `count-matching-domains`

DiscoLike ships two purpose-built pre-flight counters, and their own tool descriptions say to run
them **before** the paid search:

- **`count-contacts`** ... "how many contacts match X?", run before `search-contacts`.
- **`count-matching-domains`** ... "how many companies match X?", run before
  `discover-similar-companies`.

Use `list-industry-categories` first to map Josh's wording to the exact `category` /
`negate_category` / `filter_industry` values, otherwise the count is against the wrong taxonomy.

Where DiscoLike is the *right* counter rather than a second opinion:

- **Lookalike and similar-company universes.** No other vendor in the stack can answer "how many
  companies resemble these five seeds". getleads and AI Ark count against declared firmographics;
  DiscoLike counts against description, products, services and SEO content. For a niche ICP that
  does not map cleanly to an industry code, this is the only real count.
- **Sizing a `discover-similar-companies` run before paying for it.** DiscoLike bills roughly
  $0.00425 per record on Starter, so a 20,000-record discovery is real money. Count first.

**Verified free, 2026-09-08.** Measured with `usage-statistics` immediately before and after a
`count-contacts` call:

| | requests | records | spend |
|---|---|---|---|
| Before | 6 | 1,232 | $5.39 |
| After a count returning 5,776,287 | 6 | 1,232 | $5.39 |

Nothing moved ... not spend, not records, not even the request counter. DiscoLike bills on
`records` returned, and a count returns none, so counting is genuinely free. Count freely.

**Parameter gotcha:** `count-contacts` rejects unknown filter keys with a hard pydantic
`extra_forbidden` error rather than ignoring them. `country` is not valid on this tool. That strict
behavior is the opposite of AI Ark and it is a feature ... a bad filter fails loudly instead of
silently returning an unfiltered count.

**Known quality caveat:** a raw DiscoLike pull was **37% not real buyers** ... umbrella brands,
personal vanity pages, channel companies. A DiscoLike count is a count of the *index*, not of the
buyable universe. Discount it before reporting, or report it as "N raw, expect ~60 to 65% usable
after dedupe" rather than as a clean TAM.

### Prospeo counts ... 1 credit per query

Useful as a third opinion and the only other vendor that can filter department size. Costs ~4
credits per 100 domains for per-domain flags, so prefer AI Ark for population questions and
Prospeo for flagging domains you already hold.

### What cannot size a TAM

- **Apollo** ... People Search, Company Search and the department filter are all paywalled off the
  free plan. Organization Lookup is free but returns candidate records with no count and rejects
  the department filter. Not usable for sizing without a paid seat.
- **LinkedIn Sales Navigator** ... has the best department filter in existence, UI only, no export.
  Fine if Josh wants to eyeball a number himself; useless for automation.
- **LeadMagic** ... `search_people` is 1 credit per person. Never use it to count. `search_companies`
  advertises TAM building but bills per company returned, so it is a builder, not a counter.

---

## Sizing a physical ICP

There is no count endpoint. The universe is the physical footprint, so size it by enumerating
cheaply rather than by querying a total.

- **PermitStack** ... count permits in the jurisdictions and trade over a trailing window. This is
  the truest measure of who is actually working, not just who exists. Free reads.
- **Google Maps Scraper** ... `estimate_cost` before any scrape. Then remember the category rule:
  every brand and subtype as its own category. A single-category dealership scrape returned 755
  rows where 23 brand categories returned 5,913. **A single-category count understates TAM by up
  to 8x**, so a "TAM" from one category is not a TAM.
- **Property Owners / parcels** ... free reads, count by county and use code.

Report a physical TAM as a range with the enumeration method attached, never as a single hard
number. "21,427 vacant land owners, 10,353 of them person-named with mailing addresses" is a TAM.
"21,427" alone is not.

---

## The partition check ... mandatory

**A filter that returns HTTP 200 has not been proven to work.** AI Ark silently drops filter keys
it does not recognize and returns a full unfiltered result set with no error. Other vendors do the
same in other ways.

Prove any new or unfamiliar filter by partition:

```
count(filter)  +  count(inverse of filter)  ==  count(no filter)
```

Worked example, Insight IT DM ICP:

| Query | Total |
|---|---|
| No IT department filter | 89,138 |
| IT department 1 to 15 | 16,940 |
| IT department 16+ | 72,162 |

16,940 + 72,162 = 89,102, within 36 of 89,138. The filter binds.

If the two halves each return the unfiltered total, the filter is being ignored and every number
downstream is wrong. If they sum to well under the total, the filter is dropping records with no
value for that field, which is a different problem worth naming in the report.

Cost of the check: **3 credits.** Always worth it.

---

## Two-vendor agreement

One vendor's count is a guess. Two independent counts within roughly 25% is a fact.

Measured on the Insight IT DM ICP:

| Source | Count | Verdict |
|---|---|---|
| getleads | ~21,000 | agrees |
| Prospeo | 19,218 | agrees |
| AI Ark, unfiltered | 89,138 | outlier, filter was not binding |
| AI Ark, filter proven | 16,940 | agrees |

When two vendors agree and a third is 4x higher, the outlier is wrong ... it is not finding a
universe the others missed. Check its filters before believing it.

---

## Net-new, never gross

The number that scopes a build is what remains after subtraction:

1. Global suppression (`global-suppression` skill) ... response-based only.
2. Contacts already held for this client in `lp.<tag>_ingested_leads`.
3. Anything already loaded into a live campaign.
4. SLED and other structural exclusions for the client.

Report both figures and the gap. "89,138 gross, 16,940 in ICP, 20,314 already loaded" tells Josh
the lane is built out. "89,138" tells him to go build something that does not exist.

---

## What to report

Always these five, in this order:

1. **The number** and the exact filter that produced it
2. **Whether the filter was partition-verified**, and the arithmetic if so
3. **The second vendor's number** and whether they agree
4. **Net-new after suppression**
5. **Cost of the sizing run**, even when it is zero

Then route via `leadgen-mcp-routing`.

---

## Rules

- Size before building. Always. A build with no number is a build with no stopping condition.
- Never trust a 200. Partition-check any filter you have not personally verified in this session.
- Never report gross when net-new is what scopes the work.
- A count that disagrees with two other vendors by more than 2x is a broken filter until proven
  otherwise, not a discovery.
- getleads `count_contacts` is free ... there is never a reason not to run it as the second opinion.
- Physical ICPs get a range plus a method, never a single number.
- If sizing shows the lane is already built out, say so plainly and do not build. That is a
  successful sizing run, not a failed one.
- Sizing is cheap enough that "I'll just run the pull and see" is never the right call. The Insight
  build cost roughly 19,000 credits on a harvest that a 1-credit count would have scoped correctly.
