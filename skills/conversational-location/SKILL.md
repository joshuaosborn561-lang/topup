---
name: conversational-location
description: "Convert city/state columns in a B2B contact CSV into the conversational name people actually use for that area, for SalesGlider Growth cold email personalization. Naperville becomes Chicagoland, West Palm Beach becomes South Florida, Plano becomes DFW, Bellevue becomes the Seattle area. Use whenever Josh asks for the conversational name for the geo, conversational location, metro nickname, location2, or says the normalized city should read like how someone would say where they live. Applies to any lead CSV (getleads, AI Ark, campaign exports) across any vertical. Always use this skill instead of hand-writing a metro lookup."
---

# Conversational Location

Turns a plain city into how someone from there would actually describe where they live.
Nobody in Naperville says "I'm in Naperville" to a stranger, they say "Chicagoland." Nobody
in West Palm Beach says "West Palm Beach," they say "South Florida." That's what this produces,
so a merge field like `{{city_normalized}}` reads naturally in a cold email.

## When to use this

Trigger whenever the user asks for:
- "the conversational name for the geo" / "conversational location"
- "metro nickname" / "location2"
- normalized city that "should read like how they'd say it"

## How to run it

```bash
python3 scripts/conversational_location.py <input.csv> <output.csv> --city-col city_normalized
```

- `--city-col` defaults to `city_normalized`, then `city`. Point it at whichever column holds
  the cleaned city.
- `--out-col` defaults to overwriting the city column you read from. The raw `city` column is
  never touched, so source data stays auditable.
- `--state-col` defaults to `state`. Full state names expected ("Texas", not "TX").

Run the name-city-normalization skill FIRST so casing and "Metro Area" suffixes are already
cleaned up, then run this on the resulting `city_normalized` column.

The script needs the US cities lat/lon reference at `/home/claude/uscities.csv`. If it isn't
there, fetch it:

```bash
curl -sL -o /home/claude/uscities.csv \
  https://raw.githubusercontent.com/kelvins/US-Cities-Database/main/csv/us_cities.csv
```

## How it works

Each metro is an anchor point (lat/lon) plus a radius in miles that reflects how far the label
genuinely stretches. A city geocodes to lat/lon, and if it lands inside a metro's radius it gets
that metro's conversational label. Nearest metro wins when radii overlap.

Tighter, more specific metros are listed before broad ones so they win on distance:
Orange County beats the LA blanket, the Inland Empire keeps its own identity, the Triad stays
separate from the Triangle.

**Anchor cities get the metro label too.** Chicago maps to "Chicagoland," Miami to "South Florida."
This is intentional: one consistent label per geo, so a campaign doesn't end up with both "Chicago"
and "Chicagoland" as separate merge values for the same market. If a specific list ever needs anchor
cities to pass through under their own name, that's a deliberate change to make explicitly.

**Cities outside every metro keep their own name.** Bozeman stays Bozeman, which is correct, that
IS the conversational name. Never force a distant city into a metro it doesn't belong to.

## Labels currently covered

~65 metros spanning California, Texas, Florida, the Northeast, Midwest, South, Mountain West,
and Pacific Northwest. Some carry a leading article by design ("the DMV", "the Bay Area",
"the Triangle") because that's how the phrase is said out loud; write copy that reads
"out in {{city}}" rather than "in the {{city}} area" so the article doesn't double up.

## What NOT to do

- Don't overwrite the raw `city` column. Write to `city_normalized` (or a named `--out-col`)
  so the original is preserved.
- Don't invent a metro label for a city that falls outside every radius. Leaving the city name
  as-is is the correct answer, not a failure.
- Don't widen a radius to capture one stray city without checking what else it swallows. Widening
  the Austin radius far enough to reach San Antonio, for example, would wrongly merge two markets
  people consider distinct.
- Don't add a metro whose "nickname" is just the city name with "Greater" bolted on if locals
  don't actually talk that way.
