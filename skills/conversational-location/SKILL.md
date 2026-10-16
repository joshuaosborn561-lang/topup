---
name: conversational-location
description: Convert city/state columns in a B2B contact CSV into the conversational name people actually use for that area, for SalesGlider Growth cold email personalization. Naperville becomes Chicagoland, West Palm Beach becomes South Florida, Plano becomes DFW, Bellevue becomes the Seattle area. Use whenever Josh asks for the conversational name for the geo, conversational location, metro nickname, location2, or says the normalized city should read like how someone would say where they live. Applies to any lead CSV (getleads, AI Ark, campaign exports) across any vertical. Always use this skill instead of hand-writing a metro lookup. The state column must be passed explicitly and may be a two-letter code.
---

# Conversational location

Geocodes each city, measures distance to a set of metro anchors, and returns the label people in that area actually use. A city outside every radius keeps its own name, which is correct. "Bozeman" is already how someone from Bozeman says where they live.

## The failure this skill exists to prevent

**A silent no-op.** If the state cannot be resolved, `geocode` returns `None` and the function falls back to the raw city. Every row gets a value, the run reports "10,060 changed", and the output is the input. Nothing errors. On the Cornerstone Earthworks build this shipped into a merge field and was only caught by eyeballing samples: Plano came back as "Plano", not "DFW".

Two causes, both now handled:

**State abbreviations.** The geocode table is keyed on full state names. Lead files carry `TX`, `CA`, `FL`. The lookup for `('plano','tx')` missed while `('plano','texas')` would have hit. The script now expands two-letter codes before lookup.

**The wrong column name.** `--state-col` defaults to lowercase `state`. A file with `State` silently passes an empty string, and an empty state short-circuits geocoding on the first line of the function. **Always pass `--state-col` explicitly.**

## Usage

```
python3 scripts/conversational_location.py in.csv out.csv \
    --city-col City_normalized --state-col State --out-col Location_Conversational
```

Run **after** city normalization, so trailing `Metro Area` and casing are already cleaned, and after any state code has been split out of a combined `City, ST` column.

## Reading the output

The script now prints an unresolved count:

```
Unresolved, fell back to raw city: 389 of 10060
```

**Judge the run by the label distribution, never by the "changed" number**, which counts every row whether or not it actually resolved.

On a DFW-centric list expect something like:

```
DFW 5,909 | (blank) 389 | Greater Houston 240 | the Austin area 169 | Waco 121
```

If the top labels are individual city names rather than metro labels, the state column did not resolve. Stop and fix it.

## Anchors

Metros are ordered specific before broad, so Orange County wins over the LA blanket and the Inland Empire keeps its own name. Each entry is a label, a lat/lon anchor and a radius in miles set to how far the label genuinely stretches. DFW is a 50 mile radius from a point between Dallas and Fort Worth, which covers Rockwall, Waxahachie, Denton and Cleburne but not Waco or Tyler.

Add a metro only when a real list needs it, and set the radius to how far people actually claim the label, not to the MSA boundary.

## Where it gets used

The `{{location_conversational}}` merge tag, in lines like "if you own ground around {{location_conversational}}". A blank value breaks that sentence, so **any lane using the tag must filter to rows where the field is non-empty.** Rows with no city produce no label.

## Verify before shipping

- The unresolved count is a small minority
- The top label is a metro name, not a city name
- Spot-check five known cities: Plano, Frisco, Arlington and Rockwall should all read DFW
- Every row in a lane using the merge tag has a non-empty value
