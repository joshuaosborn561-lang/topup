---
name: company-name-normalization
description: Normalize company names in a B2B lead CSV for SalesGlider Growth cold outreach so they read the way someone casually refers to the company, not the full legal name. Use whenever Josh asks to normalize company names, clean up company names, make company names conversational, or take the descriptor out. Applies to any lead CSV (getleads, AI Ark, campaign exports). Adds company_name_normalized alongside the original, never overwrites.
---

# Company Name Normalization

The name should read the way someone says it out loud, not how it appears on a
registration filing. `{{company_name}}` is a merge field, so "would bring Fay
Servicing, Llc more leads" is what a bad pass ships.

## Rule order (order matters)

1. **Fix casing.** ALL CAPS to Title Case, all lowercase to Title Case. Mixed case
   brand names are left alone (JobNimbus stays JobNimbus).
2. **Strip parenthetical tags.** "(RIA)", "(USA)".
3. **Strip subsidiary clauses**, both comma form (", An ABM Company") and bare form
   ("An Employee Owned Company").
4. **Strip legal suffixes**, trailing and mid-string: LLC, LLP, **LP**, PLLC, PC, PA,
   PS, Inc, Corp, Ltd, Co, Company, N.A., L.C., DBA, and punctuated variants.
5. **Strip dash-separated geography.** "Honest Abe Roofing - Ann Arbor".
   Requires whitespace around the dash so internal hyphens survive.
6. **Strip comma geography** and dangling state markers. "Premier Roofing Ca".
7. **Strip one trailing generic descriptor**, but only when exactly two words remain.
8. **Fix filler word casing.** "Bank Of Washington" to "Bank of Washington".
9. **Re-uppercase initialisms.** Trs to TRS, Cfsb to CFSB.
10. **Fix apostrophe casing.** "O'neill" to "O'Neill".
11. **Never end on a dangling filler word.**

## Hard-won fixes, do not regress these

- **LP was missing from the suffix list.** It silently blocked descriptor stripping,
  because the trailing token was "Lp" rather than the descriptor.
- **Dash rule must require whitespace.** Without it "Multi-Bank Securities" collapses
  to "Multi".
- **Initialism rule must require the WHOLE token be vowel-less and not a common short
  word.** Otherwise "South End" becomes "South END" and "Intrafusion By" becomes
  "Intrafusion BY".
- **Never strip a generic tail when an ampersand or "and" is present.** The tail
  usually completes a compound: "Vantage Radiology & Diagnostic Services" must keep
  Services.
- **Only strip a generic tail when two words remain.** Otherwise you get fragments
  like "Omega High-Impact Print".
- **Partners, Associates, Consultants, Technologies, Systems and Management are NOT
  generic tails.** They are part of the brand. Only services, service, solutions,
  group, holdings, enterprises, industries, international, worldwide, usa.
- **Mid-string legal suffixes matter.** "Roof Ready Llc - A Parker Colorado Roofing
  Company" to "Roof Ready".

## Usage

```bash
python3 scripts/normalize_company.py in.csv out.csv \
    --company-col "Company Name" --out-col "company_name_normalized"
```

## Known limitation

Single-token acronyms containing vowels are not detected, so "Mgic" and "Hme" stay
title-cased rather than becoming MGIC and HME. Uppercasing them blindly would also
turn real words like "Acre" into "ACRE", so these are left alone. Roughly 250 rows
in a 19k file. Fix by hand if a specific one matters.

## Pipeline position

Run as part of the standard enrichment order:
name-city-normalization, then conversational-location, then mlb-nfl-sports-team,
then this. All four write new columns and never overwrite source data.
