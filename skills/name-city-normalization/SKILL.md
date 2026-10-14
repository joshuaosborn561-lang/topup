---
name: name-city-normalization
description: Normalize first names and city names in a B2B contact list CSV for SalesGlider Growth cold outreach personalization. Use this whenever Josh asks to normalize first names and city names, clean up names, or normalize names like we've done before, on any lead/contact CSV (getleads, AI Ark, ZoomInfo, Clay, or campaign exports). Applies the established rules -- strip titles/credentials/suffixes, strip parentheticals, prefer parenthetical nicknames, fix ALL CAPS/lowercase casing, consolidate only informal nickname variants (Jimmy to Jim, not James to Jim), REJECT initials and non-names outright so no row ever renders "Hey A.,", and clean up city strings (strip Metro Area/Region suffixes, fix casing). Always use this skill instead of improvising ad hoc regex when the request matches this pattern.
---

# First name and city normalization

## The rule that was added Sept 2026

**An initial is not a name. Reject it, do not clean it.**

A contact whose first name is `A`, `A.`, `R.` or `J` has no usable first name. Writing `Hey A.,` is worse than not sending. These rows must come back with an **empty** `FirstName_normalized` so they route to a role-inbox lane that does not use the merge tag, or get excluded from named lanes entirely.

### Reject

| Value | Why |
|---|---|
| `A`, `J`, `R.` | single letter, an initial |
| `Jr`, `Sr`, `II`, `III`, `IV` | suffix that landed in the wrong column |
| `info`, `admin`, `office`, `sales`, `team`, `owner`, `manager`, `contact`, `staff` | role words, not people |
| `N/A`, `none`, `unknown`, `test` | placeholder junk |
| anything containing digits | not a name |

### Keep

**Two-letter names are real.** Ed, Mo, Ty, Jo, Al, Bo, Cy, Lu. An earlier version of this rule rejected anything under three characters and silently dropped 32 real contacts. The floor is **two**, not three.

**Accented and non-ASCII letters are names.** Jürgen, Renée, Søren, José. The matcher must be Unicode aware. An ASCII-only character class dropped every accented name on the Cornerstone build.

**Hyphens and apostrophes belong in names.** O'Brien, Anne-Marie, D'Angelo. Capitalize after both: `o'brien` becomes `O'Brien`, `anne-marie` becomes `Anne-Marie`.

**The O' rule must require the apostrophe.** A pattern like `^(O|Mc|Mac)([a-z])` capitalizes the second letter of *every* name starting with O, producing `OScar`, `OLga`, `OLivier`, `OLen`, `OSagie`. Anchor it to `^O'` specifically. Mc and Mac are safe because no common first name starts with those letters followed by a lowercase run.

**Verify: zero values matching `^[A-Z][A-Z]` after normalizing.** That single check catches the whole class.

## Cleaning order for first names

1. Drop parentheticals and quoted asides. `Bob (Robert)` becomes `Bob`. `Robert "Bob"` becomes `Robert`.
2. Strip leading titles: Mr, Mrs, Ms, Miss, Dr, Prof, Rev, Fr, Capt, Sgt, Lt, Col, Gen.
3. Strip trailing credentials and suffixes: Jr, Sr, II, III, IV, PhD, MD, DDS, DVM, CPA, Esq, PE, RN, MBA, PMP, CFA, JD.
4. Strip digits and stray punctuation, keeping letters, apostrophes and hyphens.
5. Take the first token only.
6. **Apply the reject list above.** Return empty rather than a broken name.
7. Fix casing if ALL CAPS or all lowercase. Preserve deliberate internal caps like McDonald.
8. Capitalize after O', Mc, Mac and after a hyphen.

## Nickname consolidation

Only consolidate **informal variants of the same name**: Jimmy to Jim, Bobby to Bob, Mikey to Mike. Never consolidate a formal name to its nickname. James is not Jim. Robert is not Bob. Michael is not Mike. The person chose what to be called.

A parenthetical nickname wins over the formal name: `Robert (Bob) Smith` sends as Bob.

## City normalization

Strip `Metro Area`, `Metropolitan Area`, `Greater`, `Region`, `and Vicinity`, and trailing country names. Fix ALL CAPS and all lowercase casing. Leave the city itself alone; converting it to a conversational metro name is a **separate step**, see the conversational-location skill.

**Watch for state codes glued onto the city.** Exports frequently produce `Palo Pinto  TX` in a single column. Split the trailing two-letter code into its own state field before geocoding. On the Cornerstone build this went unnoticed and dropped the sports-team assignment rate from 78% to 21%.

## Usage

```
python3 scripts/normalize_first_names.py in.csv out.csv \
    --first-name-col FirstName --company-col Company --state-col State
```

Adds `FirstName_normalized`, `Company_normalized` and `State_full`. Never overwrites the source columns.

Run the city half first if the city needs cleaning, then this, then conversational-location.

## Verify before shipping

- Zero values of length under two in `FirstName_normalized`
- Zero values containing a period, digit or parenthesis
- Rejected count is reported and looks sane. On a 10,000 row DFW list expect roughly 15 to 50 rejects. Hundreds means the column is wrong.
- Any lane whose copy uses `{{first_name}}` filters to rows where the field is non-empty
