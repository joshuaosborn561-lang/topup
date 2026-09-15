---
name: name-city-normalization
description: "Normalize first names and city names in a B2B contact list CSV for SalesGlider Growth cold outreach personalization. Use this whenever Josh asks to normalize first names and city names, clean up names, or normalize names like we've done before, on any lead/contact CSV (getleads, AI Ark, ZoomInfo, Clay, or campaign exports). Applies the established rules -- strip titles/credentials/suffixes, prefer parenthetical nicknames, fix ALL CAPS/lowercase casing, consolidate only informal nickname variants (Jimmy to Jim, not James to Jim), and clean up city strings (strip Metro Area/Region suffixes, fix casing). Always use this skill instead of improvising ad hoc regex when the request matches this pattern."
---

# Name & City Normalization

Normalizes `first_name` and `city` columns in a contact CSV using SalesGlider Growth's established
cold-outreach personalization rules, refined over many past sessions. Adds new
`<column>_normalized` columns immediately after the originals — never overwrites source data.

## When to use this

Trigger whenever the user says things like:
- "normalize first names and city names"
- "normalize names like we've done in the past"
- "clean up first names / cities"
- "add a normalized name column"

This applies to any B2B contact CSV: getleads exports, AI Ark exports, ZoomInfo/Clay pulls,
verified campaign lists, etc. — regardless of exact column naming.

## How to run it

The script lives at `scripts/normalize_names_and_cities.py` and auto-detects common column-name
variants (`first_name` / `First Name` / `firstname`; `city` / `City` / `Contact City` / `Location`).

```bash
python3 scripts/normalize_names_and_cities.py <input.csv> <output.csv>
```

If column auto-detection fails or picks the wrong column, pass explicit names:

```bash
python3 scripts/normalize_names_and_cities.py <input.csv> <output.csv> \
    --first-name-col "First Name" --city-col "Contact City"
```

Always inspect the columns first (`head -1 file.csv`) if unsure, and after running, spot-check a
sample of changed rows before presenting the output — print `raw -> normalized` pairs for every row
where the value changed, since that's the fastest way to catch a bad edge case.

## Rules encoded (first names)

1. Strip stray non-name characters (emojis, odd unicode).
2. Strip leading titles: Dr., Mr., Mrs., Ms., Miss, Prof.
3. Strip trailing credentials: `, CPA`, `, PHR`, etc. (comma + 2+ caps at end).
4. **Parenthetical nickname is the preferred name** — "Anthony (Tony)" → `Tony`, not "Anthony".
   This is a deliberate, discussed tradeoff: it's right ~38/39 times in past audits (maiden names
   in parens being the rare miss).
5. Strip Jr/Sr/II/III/IV/V suffixes.
6. Initials handling:
   - All-initials names ("C J", "E J") — keep as-is, don't touch.
   - Leading initial(s) followed by a real name ("W. Allen") — drop the initial, use the real name
     ("Allen").
   - Trailing initial(s) ("Robert A.") — strip them ("Robert").
   - Multi-word non-initial names ("Alice Laura", "Anna Claire") — use the first word only
     ("Alice").
7. Fix casing only on ALL CAPS or all-lowercase input; leave already-mixed-case names untouched.
8. **Nickname consolidation is narrow on purpose**: only informal variants within the same
   nickname family collapse to the common casual form (Jimmy→Jim, Bobby→Bob, Billy→Bill, Tommy→Tom,
   Eddie/Eddy→Ed, Ronnie→Ron, Donnie→Don, Joey→Joe, Ricky→Rick). We do **not** convert formal given
   names to a nickname (James stays James, Robert stays Robert, Michael stays Michael) — that would
   presume a preference the data doesn't actually state. Do not expand this map without checking
   with Josh first; it grew out of specific audit corrections, not a generic name-nickname database.

## Rules encoded (cities)

1. Collapse duplicate whitespace.
2. Strip trailing descriptor suffixes: "Metropolitan Area", "Metro Area", "Metroplex", "Region",
   "Area", "Metro" (e.g. "Atlanta Metropolitan Area" → "Atlanta").
3. Fix casing only on ALL CAPS or all-lowercase city strings; leave mixed-case untouched.

Note: this is plain city-name cleanup, **not** the separate "conversational location" /
metro-nickname system (DFW, the Metroplex, Chicagoland, etc.) built in other sessions for cold
email personalization — that's a different, heavier pipeline (geocoding + MLB/college-team-style
distance logic) and should only be built out if the user explicitly asks for regional nicknames,
not plain city cleanup.

## What NOT to do

- Don't silently expand the nickname map with new formal→nickname conversions (e.g. "Charles" →
  "Chuck") — past sessions deliberately walked this back because it presumes an unstated
  preference. If the user wants that behavior back, confirm first.
- Don't overwrite the original `first_name` / `city` columns — always add `_normalized` columns
  alongside them so the source data is auditable.
- Don't skip the spot-check step — print the diff of changed values before presenting the file, so
  edge cases (e.g. a genuine compound name getting truncated) can be caught before delivery.
