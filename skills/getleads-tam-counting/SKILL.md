---
name: getleads-tam-counting
description: How to count a TAM or size a lane on getleads correctly, so the number reflects the real universe instead of a filter accident. Use this whenever getleads count_contacts, search_contacts, or export_contacts is about to be called for any client or lane, whenever Josh asks how many are out there, how big is the TAM, why a getleads number is so low, or whether a pool is exhausted, and before any getleads export feeds a campaign build. Also use it to sanity check any getleads number already in a plan. Supersedes the ad hoc job_titles lists in older client skills (parlay-lead-pulls, culture-fits-lead-pulls, techevo-lead-pulls, goliath-lead-pulls, salesglider-lead-pulls) for the sizing step. Measured Sept 29 2026 on the Parlay refresh, where seven exact title strings returned 1,334 and the correct query returned 5,751 on the same ICP.
---

# getleads TAM counting

getleads is on an unlimited plan, so `count_contacts` is free and there is never a reason not to
run it. The problem is not cost, it is that four of its filters silently do something other than
what a reasonable person expects. This skill exists because the Parlay IT × Financial Services lane
was reported at 1,334 when the real number was 5,751 with a valid email and roughly 10,000 gross.
Same ICP, same day. The difference was which role filter was used.

The public docs are not indexed anywhere useful. The real documentation is
`get_available_columns` (free): every field carries a `description` that says exactly how it
matches and what it drops. Read it before trusting any filter you have not used in this session.

---

## 1. The role filter is job_functions + seniority, not job_titles

`job_titles` matches "fuzzy but literal title strings". C-suite and VP acronyms expand (CTO also
catches Chief Technology Officer), but a real title inserts qualifiers that no contiguous string
spans: "Director, Information Technology & Security" does not match "Director of IT". The catalog
says this outright. A seven-string title list is a floor, never a TAM.

**Primary role filter, always:**

```json
"job_functions": ["Information Technology"],
"seniority": ["C-Team", "VP", "Director", "Manager"]
```

Both are exact enums. Get them from `get_available_values` (`job_functions` has 22 values,
`seniority` is C-Team / VP / Director / Manager / Staff / Other). Unknown values 400.

Measured on Parlay IT × Financial Services, US, 11 to 500, VALID email:

| Role filter | Count |
|---|---|
| 7 exact title strings | 1,334 |
| job_functions IT + seniority C/VP/Dir/Mgr | 5,751 |
| same, no VALID filter | 10,171 |

**Then clean with `exclude_job_titles`**, which is the correct use of the title matcher (removing
a known noise pattern, not defining the target). The IT function tag catches software engineering
managers and principal engineers. A 10-row audit mid-pool was 6 real IT DMs and 4 engineers.

```json
"exclude_job_titles": ["Engineer", "Developer", "Software", "Data", "Analytics", "QA", "Product", "Architect"]
```

Drop "Architect" from the exclusion when the vertical is architecture firms. Think before pasting.

**For Ops lanes** use `job_functions: ["Operations"]` with `seniority: ["C-Team","VP","Director"]`
(no Manager, it pulls office and facilities managers). Exclude "Assistant", "Lending",
"Mortgage", "Loan", "Sales", "Marketing" in financial verticals.

**For owner lanes** `job_titles` is fine because owner titles are short and unqualified:
`["Owner", "President", "CEO", "Chief Executive Officer", "Managing Partner", "Principal"]`.
"Principal" is correct for architecture and engineering firms and wrong nearly everywhere else.

**`personas`** is a curated title + function + seniority rule set (73 values: CIO, CTO, Director of
IT, COO, VP Operations, Director of Operations, CEO / Founder, Small Business Owner, Architect,
Financial Advisor, and so on). It runs tighter than function + seniority (1,203 vs ~1,700 on Arch
IT) and is a useful cross-check when a function count looks noisy. It is not a substitute for the
function filter as the primary because it under-counts.

---

## 2. Every enum must be exact, and the catalog tells you which ones are enums

| Filter | Type | Rule |
|---|---|---|
| `company_size` | enum | Exact band labels: `"11 to 50"`, `"51 to 200"`, `"201 to 500"`. Never `employees_min`/`max` or `company_size_min`/`max`: those select every band that overlaps the bound, so a max of 9 returns the whole 1 to 10 band. This has already pulled ~2,700 wrong-band rows once. |
| `seniority` | enum | C-Team, VP, Director, Manager, Staff, Other |
| `job_functions` | enum | 22 values, see `get_available_values` |
| `industries` | enum | 441 flat LinkedIn values. Parent names do not expand. Enumerate every sibling you mean. |
| `email_status` | enum | Only `["VALID"]`. CATCH_ALL and INVALID are rejected. |
| `countries` | enum, aliases ok | Full English names. "USA" expands. |
| `personas`, `entity_types`, `revenue`, `regions`, `continents` | enum | get_available_values |

Free-text filters (`job_titles`, `states`, `cities`, `company_name`, `technologies`) are substring
matches: "Strip" catches "Stripe", "CA" catches half the states. Never use them to identify, only
to narrow or exclude.

---

## 3. Location: person OR company, never both

`countries` is where the person lives. `office_countries` is where the company has an office. The
catalog is explicit: each alone returns ~105M for the US, combined they return 77.3M, and 28
million people vanish with no warning. Pick one. `countries` is the default and what a cold email
brief almost always means.

`job_location_*` fields are sparsely populated and silently drop most of the market. Do not use
them.

---

## 4. Industry: the LinkedIn tag is thin, NAICS fills the gap

`industries` is the company's self-selected LinkedIn industry. It is thin outside white-collar
sectors, and a company with no tag at all is silently excluded. Two fixes:

**Enumerate siblings.** "Financial Services" alone is one value. Randy-style financial services
clients live under Financial Services, Investment Management, Investment Advice, Capital Markets,
Investment Banking, Funds and Trusts, Banking, Insurance, Insurance Agencies and Brokerages,
Venture Capital and Private Equity Principals, Accounting. Passing the single value returned
5,751; the sibling set returned 11,853 (IT lane) and 17,780 (Ops lane).

**Add NAICS through `where_sql`** for verticals the LinkedIn taxonomy misses (trades, local
services, physical goods, and any company that never set a tag). NAICS is a semicolon list on the
row, so anchor it: `org_industry_naics_code ILIKE '54131%'` for primary architectural services.
Unanchored ILIKE matches any code the company carries. Measured on Architecture IT DMs, US, 11 to
500, gross: LinkedIn tag alone ~1,700; tag OR NAICS 54131/54132 = 1,927; tag OR NAICS 5413 (which
adds engineering firms) = 5,381. The broad prefix is a different ICP, so decide which one Josh
actually asked for before reporting it.

24 LinkedIn industry values contain a `;` and `where_sql` rejects them. Match a distinctive
fragment with `ILIKE '%Architecture%'` instead of the whole value with `=`.

---

## 5. where_sql is the only way to OR, and it works

Named filters can only AND. To union two role definitions (function + level OR a title pattern),
write the OR in `where_sql`. It is AND-combined with whatever named filters you also pass.

Column names are the ClickHouse columns from `get_available_columns`: `job_function`, `job_level`,
`job_title`, `org_industry_linkedin`, `org_industry_naics_code`, `email_status`,
`employee_count_range`, `person_country_name`.

Verified working, Architecture, US, 11 to 500, gross:

```sql
(job_function = 'Information Technology' AND job_level IN ('C-Team','VP','Director','Manager'))
OR job_title ILIKE '%information technology%'
OR job_title ILIKE '%IT director%'
OR job_title ILIKE '%IT manager%'
OR job_title ILIKE '%head of IT%'
OR job_title ILIKE '%BIM manager%'
OR job_title ILIKE '%design technology%'
```

returned 2,387 against ~1,700 for the function filter alone. The union is worth 20 to 40% on
lanes where the target title is domain-specific (BIM Manager, Design Technology, Practice
Manager) and the function tag misses it.

Keep the OR small. Every branch is a scan.

---

## 6. Timeouts are a splitting problem, not a filtering problem

Broad counts die at 45 seconds with `count_timeout` or `QUERY_WAS_CANCELLED`. The error text says
"narrow the query". Do not narrow the ICP to make the count return. Split it into pieces that
return and sum them:

- Split the `industries` list into groups of 1 to 5 and sum.
- Split `company_size` into single bands and sum (this doubles as the partition check).
- Run the `where_sql` OR on one industry at a time.

What timed out today: any count with no `industries` filter at all, and a `where_sql` OR across
the full Financial Services tag. What returned in under 10 seconds: every count with a single
industry or a sibling group of five plus a function or persona filter. Retry once on a
`QUERY_WAS_CANCELLED`, it is a queue kill, not a query problem.

Never drop `countries`, `company_size`, or the role filter to get a number back. A count that
returns because the ICP was loosened is a different ICP.

---

## 7. Gross first, VALID second, report both

`email_status: ["VALID"]` kept 56.5% on the one lane measured both ways (5,751 of 10,171). It is
the deliverability standard and every export runs with it, but the TAM is the gross figure and
the buildable list is the VALID figure. A vendor comparison (AI Ark, Prospeo) has no VALID
equivalent, so compare on gross or the numbers will never agree.

Report every lane as: gross, VALID, and the VALID ratio. If the ratio drifts far from 55 to 60%,
say so, it usually means a data-thin vertical.

---

## 8. Partition check before trusting a filter you have not proven

`count(filter) + count(inverse) == count(no filter)`. Three free calls. For `company_size` use the
five bands outside your range as the inverse. Measured today on Architecture IT: 268 inside 11 to
500, 61 outside, 329 with no size filter. Binds exactly.

Run this on `company_size`, `industries`, and any `where_sql` branch the first time each is used
in a session. Skip it for `countries` and `email_status`, they have been proven repeatedly.

---

## 9. Audit ten rows before calling a count good

`search_contacts` with `limit: 10` at an `offset` in the middle of the pool (not 0, the top rows
are the best-tagged) and `columns: ["Current Job Title", "Company Name", "Employee Count Range"]`.
Ten rows cost ten credits on fair use and are the only rows allowed into chat. Count how many are
actually the buyer. Under 6 of 10 means the function or industry filter is loose and needs an
`exclude_job_titles` pass or a `personas` cross-check before the number goes in a plan.

Column labels in `columns` must be the exact display labels from `get_available_columns`. "Job
Title" is wrong, "Current Job Title" is right. A bad label 400s with the valid list attached.

---

## 10. The procedure, in order

1. `get_available_values` for `industries`, `job_functions`, `seniority` if not already loaded
   this session. Enumerate the industry siblings the ICP actually spans.
2. Count gross, no `email_status`, with `countries`, exact `company_size` bands, `industries`
   (in groups if needed), `job_functions`, `seniority`.
3. Partition check on any filter new to this session.
4. Add `where_sql` NAICS or title-pattern branches if the vertical is thin on LinkedIn tags or
   the target title is domain-specific. Re-count.
5. Count again with `email_status: ["VALID"]`. Report gross, VALID, ratio.
6. Audit 10 rows mid-pool. Add `exclude_job_titles` for the noise you see. Re-count VALID.
7. Report the final number with the exact filter set that produced it, per lane.
8. Hand off to `tam-sizing` for the second-vendor agreement check and to `lead-list-build` for the
   export, ingest, and master dedupe. Net-new is computed after ingest, never from counts.

---

## Known failure modes (all measured)

- Seven title strings as the role filter: 4x under-count. Use function + seniority.
- Single industry value instead of siblings: 2x under-count on financial services.
- `employees_min`/`max` instead of band labels: band overlap, ~2,700 wrong-band rows shipped once.
- `countries` + `office_countries` together: 28M rows vanish silently.
- No `industries` filter at all: count times out, always, on the current cluster.
- `job_location_*`: sparse, drops most of the market.
- `CATCH_ALL` in `email_status`: rejected, not deprecated quietly. Only VALID.
- Sampling at offset 0: over-states quality. Sample mid-pool.
- Wrong column label in `columns`: 400. Use the display label exactly.
- `where_sql` `=` against an industry value containing `;`: rejected. Use ILIKE on a fragment.
