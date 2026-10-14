---
name: company-name-normalization
description: Normalize company names in a B2B lead CSV for SalesGlider Growth cold outreach so they read the way someone casually refers to the company, not the full legal name. Use whenever Josh asks to normalize company names, clean up company names, make company names conversational, or take the descriptor out. Strips legal suffixes, everything in parentheses or quotes, geography tails, and ONE trailing org descriptor (Church, Foundation, Properties, Management, Group, Ministries, Academy, Association and similar). Applies to any lead CSV (getleads, AI Ark, campaign exports). Adds company_name_normalized alongside the original, never overwrites.
---

# Company name normalization

The goal is the name a person says out loud. Not the name on the tax filing.

`First Baptist Church of Rockwall, Inc.` becomes `First Baptist`. `"I Have a Dream" Foundation` becomes `I Have a Dream`. `4Sight Property Management LLC` becomes `4Sight Property`.

## Order of operations

Order matters. Legal suffixes have to go before geography tails, because `Acme Roofing, Dallas, LLC` needs the LLC gone before the comma rule can see the geography.

1. **Fix casing** if the whole string is ALL CAPS or all lowercase. Preserve deliberate internal caps.
2. **Remove anything in parentheses or brackets.** `(Global) Holdings Group` becomes `Holdings Group`. This was added Sept 2026 after parentheticals shipped into a merge field.
3. **Remove quote characters, keep what is inside them.** `"I Have a Dream" Foundation` becomes `I Have a Dream Foundation`, not `Foundation`. Deleting the quoted content deletes the actual name.
4. **Strip subsidiary tails**: `, an Acme company`, `an employee owned company`, `, a Widget brand`.
5. **Strip legal suffixes**, repeatedly: LLC, L.L.C., LLP, LP, PLLC, PC, PA, Inc, Incorporated, Corp, Corporation, Ltd, Limited, Co, Company, NA, LC, DBA.
6. **Strip a spaced-dash tail**: `Acme Roofing - Dallas` becomes `Acme Roofing`. Requires whitespace around the dash so internal hyphens survive.
7. **Strip comma geography** and a trailing bare state code when three or more tokens remain.
8. **Strip ONE trailing descriptor.** See the guard below.
9. **Lowercase filler words** that are not first: of, the, and, for, a, an, at, in, on, by, to.
10. **Uppercase initialisms**: two to four letters, no vowels, no digits in the token. `Tsl Terminals` becomes `TSL Terminals`. Never touch a token containing a digit, or `8th & Main` becomes `8TH & Main`.
11. **Capitalize after an apostrophe**: `O'briens` becomes `O'Briens`.
12. Drop a dangling filler word left at the end, collapse whitespace.

## Descriptors, and the guard that keeps this from eating the name

Descriptor list: church, chapel, cathedral, parish, diocese, congregation, fellowship, temple, synagogue, mosque, ministries, ministry, assembly, foundation, charity, academy, school, schools, university, college, seminary, institute, association, society, council, coalition, alliance, federation, chapter, auxiliary, properties, property, realty, holdings, investments, ventures, enterprises, industries, services, service, solutions, group, partners, partnership, management, development.

**Strip exactly one, and only when two or more tokens survive, and never when that would leave a leading article.**

Both halves of that guard were learned the hard way:

| Input | Without the guard | With it |
|---|---|---|
| `Advanced Association Management` | `Advanced` | `Advanced Association` |
| `A Continuous Charity` | `A Continuous` | `A Continuous Charity` |
| `The Rockwall Foundation` | `The Rockwall` | `The Rockwall Foundation` |
| `A2K Realty LLC` | `A2K` | `A2K Realty` |

Stripping repeatedly walks the name down to an adjective. One pass only.

## ALLCAPS words versus acronyms

Source data is full of ALLCAPS. Some of it is a real acronym that must stay, some is an ordinary word that must be title-cased. There is no reliable heuristic: `YMCA`, `BNSF`, `IBEW`, `NISD`, `FUMC`, `CASA` and `DECA` all have vowels, and so do `CHURCH`, `CHRIST`, `GLOBAL` and `MINISTRIES`.

**Use an explicit list of ordinary words to fix, and leave everything else alone.** Current list: CHRIST, CHURCH, MINISTRIES, GLOBAL, GOOD, BOLD, BONE, CORE, HOPE, LARGE, LIFE, LIFT, LOFT, LOSS, LYNN, OWLS, PAWS, REAL, RESCUE, REVIVE, RISE, STAR, STARS, STORM, WORD, LEAGUE, CONTRACTOR, RELATE, SAFE, STEAM, STEM, TEST, MOMENTOUS, SYNERGY, INROADS, LIBRE, RENE, HERO, ANDRES, BYRD, LYNX, BERAKAH. Extend it when a new one shows up in a spot check.

**Abbreviation casing:** `ST` becomes `St.`, `MT` becomes `Mt.`, `FT` becomes `Ft.`. Watch the double period. If the source already reads `ST.` a naive replace produces `St..`, which shipped once. Normalize to a single period afterward.

**Known mixed-case brands need explicit handling.** `Exxonmobil` should be `ExxonMobil`. Title-case cannot infer internal capitals.

## Never

- Never overwrite the source column. Add `company_name_normalized` beside it.
- Never strip a descriptor that is the whole distinguishing name: `The Foundation` stays.
- Never expand abbreviations or guess at a fuller name.
- Never touch tokens with digits when uppercasing initialisms.

## Usage

```
python3 scripts/normalize_company.py in.csv out.csv \
    --company-col Company --first-name-col FirstName --state-col State
```

Reports how many changed. On a mixed DFW nonprofit and CRE list expect roughly 40 to 50% changed. Near zero means the column argument is wrong.

## Verify before shipping

- Zero parentheses or quote marks in the output column
- No single-token results that are bare adjectives: Advanced, Premier, Continuous, National
- Spot-read 100 rows, not 20. The defects that matter are rare enough to miss in a small sample: on a 2,500 row send, `St..` appeared twice and ALLCAPS words appeared in under 2% of rows. An automated defect scan will not catch these because the strings are individually well formed. Read them.
- Zero occurrences of `..`
- Zero ALLCAPS words that are ordinary English
- Mandatory QA (lead-list-build steps 7/8): after this step, a separate pass pulls 200 random rows, reports the error rate, and holds the batch if errors exceed 2 percent. Counts and up to 10 company names in chat only, never rows.
