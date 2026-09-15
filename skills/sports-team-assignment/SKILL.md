---
name: sports-team-assignment
description: "Assign each contact in a B2B lead CSV their local sports team (MLB or NFL, with college as a fallback in college-dominant territory) for SalesGlider Growth cold email gift-offer personalization. Use whenever Josh asks to assign the local sports team, add the sports column, do the MLB version or the NFL version, run the sports skill, or is building a ticket-offer campaign that needs a Local_Sports_Team merge field. Supports a pro-only mode that disables all college and NBA/NHL assignments, required for education-sector lanes. Applies to any lead CSV (getleads, AI Ark, Maps exports, Smartlead campaign exports) across any vertical or client. Always use this skill instead of hand-writing team-distance logic."
---

# Sports Team Assignment

Assigns a local sports team nickname to each row of a lead CSV, for use as the
`Local_Sports_Team` merge field in gift-offer cold email campaigns.

This skill replaces the separate `mlb-college-sports-team` and `nfl-college-sports-team`
skills. Same logic, same team lists, one codebase, selected with `--league`.

## Decision tree

Evaluated in this exact order. First match wins.

1. **No city/state** on the row → blank, reason `NO_CITY_STATE`.
2. **Florida panhandle** (FL, longitude west of -84.5) → always blank, reason
   `PANHANDLE_FL_BLANK`. Tallahassee sits at -84.28 and is deliberately outside this,
   so it still resolves to Seminoles.
3. **City override** → exact city/state match against `CITY_OVERRIDES`. Fires before
   everything else. This is where Memphis/Grizzlies, Orlando/Magic, Portland/Trail Blazers,
   and Raleigh/Hurricanes live. **Skipped entirely in `--pro-only` mode.**
4. **Home market, 35 miles.** If a team from the selected league is within 35 miles,
   assign it and stop. This wins outright even over a college in the same town. Houston
   must be Astros/Texans, not Aggies. Minneapolis must be Twins/Vikings, not Golden
   Gophers.
5. **Nearest wins, both within 120 miles.** Outside the home market, compare the nearest
   pro team and the nearest college town and take whichever is genuinely closer. Ties go
   to pro.
6. **Blank**, reason `OUT_OF_RANGE`.

In `--pro-only` mode, steps 3 and 5's college half are skipped entirely: pro team within
120 miles, or blank.

Two bugs this ordering exists to prevent, both caught in real runs:

- **Nearest college, not first list match.** An earlier version returned whichever
  eligible school appeared first in the list rather than the closest one, silently
  producing wrong picks whenever two schools were both in range.
- **College swallowing a metro-fringe contact.** A pure "home radius, then college, then
  regional pro" ladder assigned Forney TX (36 miles from the Rangers, just outside the
  home radius) to Baylor Bears 100 miles away. Every DFW-fringe contact had the same
  failure. The nearest-wins comparison in step 5 is the fix. South Bend / Notre Dame also
  carries a tightened **50 mile** radius so it stops swallowing Chicagoland.

## Hard rules

- **Nickname only.** "Yankees," never "New York Yankees." "Cowboys," never "Dallas Cowboys."
- **Current franchise names only.** Guardians not Indians. Commanders not Redskins.
- **No NBA, NFL, or NHL in MLB mode**, and vice versa, except the four explicit
  `CITY_OVERRIDES`. Those exist because those cities have no reasonable pro baseball or
  football answer and a real local team people actually care about.
- **Ambiguous college nicknames are school-qualified** in the data table. "LSU Tigers" not
  "Tigers," because "Tigers" also means Detroit. Same for Auburn, Clemson, Missouri,
  Louisville, Oklahoma State, K-State, Baylor, BYU, Boise State, Washington State,
  Montana, Fresno State, Mississippi State, Ole Miss, NC State.
- **Blank beats a bad match.** Never stretch the radius to fill a row.

## `--pro-only` mode: when it is mandatory

Pass `--pro-only` for any **education-sector** lane. Without it, universities get offered
their rival's tickets. This happened live in the Goliath Lane 4 build and had to be fixed
mid-campaign. Pro-only disables college assignment and all four city overrides, leaving
only MLB or NFL, with blanks routed to the AirPods gift tier.

## How to run it

```
python3 scripts/assign_team.py <input.csv> <output.csv> \
    --league mlb \
    [--city-col "Contact City"] [--state-col "Contact State"] \
    --out-col "Local Sports Team MLB" \
    [--pro-only] [--split]
```

**Always pass `--out-col` explicitly when re-running on a file that already has a team
column.** Omitting it creates a stray new column instead of overwriting the old one,
leaving incorrect prior values silently in place. This caused a real production mistake.

`--league both` writes both columns in one pass (`Local Sports Team MLB` / `Team Source`
and `Local Sports Team NFL` / `Team Source NFL`), which is what the gift ladder needs:
MLB first, NFL second, AirPods when both are blank.

`--split` additionally writes `<output>_WITH_TEAM.csv` and `<output>_NO_TEAM.csv`, the
standard two-file handoff shape.

## Geocoding reference

Reads `$USCITIES_CSV`, defaulting to `/home/claude/uscities.csv`. Fetch once per session
if missing:

```
curl -s -o /home/claude/uscities.csv \
  https://raw.githubusercontent.com/kelvins/US-Cities-Database/main/csv/us_cities.csv
```

The script auto-detects column names, so a different city/lat/lon reference file will
work as long as it has recognizable headers.

## Output columns

- The team column (name from `--out-col`)
- A source column: `MLB`, `NFL`, `College`, `CityOverride`, or a blank reason
  (`NO_CITY_STATE`, `PANHANDLE_FL_BLANK`, `NO_GEOCODE`, `OUT_OF_RANGE`)

Always report **row counts**, not unique city/state counts. Confusing the two has been a
recurring reporting error. The script prints both, labeled.

## Expected yield

Roughly 80 to 85% of rows get an assignment with college enabled. Pro-only mode runs
lower, typically 55 to 70% depending on how urban the list is. A yield far outside those
bands means the city/state columns are probably mismapped... check before shipping.

## Known edge cases

- **Two-team markets** (Giants/Jets, Rams/Chargers, Cubs/White Sox, Mets/Yankees) resolve
  to whichever stadium coordinate is literally closer. Both share nearly the same location,
  so this rarely produces a meaningfully wrong pick, but it is arbitrary. Override by city
  if a client cares.
- **The Athletics** are listed at their Sacramento interim location. Verify before a
  campaign that leans on Northern California.
- **Spokane Indians** and similar minor league names must never be caught by the
  Indians to Guardians rename. The rename dictionary is exact-match on full team
  identity, not substring, for this reason.
- **Raleigh** is set to Hurricanes by city override, which suppresses NC State Wolfpack.
  Flip the override off if a client would rather have the college.
