---
name: territory-lock
description: Hard territory lock before any lead load. Always run on the final file before staging to Smartlead, for every client. Drops companies whose Maps listing, HQ or location is outside the client's territory, drops people whose location or title names an out-of-territory state or region (for example "VP of Operations - CT/ME/NH" on a CA client), and holds rows with no location data. Territories live in config/territories.json; clients without an entry are US only.
---

# Territory lock

## Why
A Maps search seeded from a CA ZIP returned a listing in Connecticut, and
nothing checked the Maps state. A people search also matched a regional VP
whose title covered only New England states at a national company with a
real CA location. An after-load check that only looked for place names in
the text did not catch either one.

## Run
```
python3 skills/territory-lock/scripts/territory_gate.py --client <client_tag> final.csv \
  --out pass.csv --dropped dropped.csv --held held.csv --receipt territory_receipt.json
```
Only `pass.csv` goes on to the split and the load. Paste the
`territory_lock` block (counts and reasons) into the run receipt and the
`list_build_records` row. Held rows wait for Josh.

## Rules (in order)
1. Company country is not US: drop.
2. Company: the Maps state or ZIP wins. If there isn't one, the HQ state or ZIP is used, then a free-text company location. Outside the territory, or inside an excluded area (NYC, Tampa for TechEvo): drop. A state that the territory narrows by ZIP (South Florida) but that has no ZIP: hold.
3. Person: a location that names an out-of-territory state, or a non-US country: drop.
4. Title: if the title names states or regions and none of them overlap the territory, drop. Codes count only in upper case, and only in a segment made entirely of geography (` - CT/ME/NH`, `, NY, NJ & PA`, `(New England)`). Region words and full state names count anywhere. So `Director of IT`, `Me`, `Ca` and similar never match.
5. No company or person location at all: hold, never pass silently.

## Config
`config/territories.json`. Add a client by tag. `include` lists states, and
an optional `zip3` narrows a state to those ZIP prefixes. `exclude` lists
named areas by `zip3` and `cities`.
