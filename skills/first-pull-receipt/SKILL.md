---
name: first-pull-receipt
description: After you build a first lead list for a SalesGlider campaign in Claude, write one receipt row to campaignintelligence so leadtopup can get more of those same people automatically. Use whenever you finish a first pull, first import, "top off" that you did by hand, or Josh says write the receipt / tell leadtopup how you found them. Never write lead rows or emails.
---

# First-pull receipt (for leadtopup)

You are the agent that builds the **first** list. There is a Railway service called **leadtopup** whose only job is: a campaign is performing → get more of those people, automatically.

It cannot see this Claude chat. After you import (or stage) the first list, the Smartlead mirror has *who* landed. It does not have *how you found them* — getleads vs Maps vs permits, which titles and bands, which puzzle piece filled domain / person / email. Without that, leadtopup cannot repeat you.

So: **when the first pull is done, write one receipt. Then stop talking about the rows.**

## What leadtopup will do with this

- Watch a campaign that is low and still getting replies.
- Read the **latest** `topup.pull_receipts` row for those campaign ids.
- Go get more people the same way: same company source and filters, then the same waterfall for any missing piece, then verify and load.
- Never invent a third source. If you used Maps + permits, it will too. If getleads already had the email, it will not pay a waterfall.

If you pulled two different ICPs (Peterson GC-partner vs vacant-land, or staffing owners vs staffing CROs), write **two receipts**. One stack per row.

## Where to write

- **Only** Supabase project `azpapwtnrbzywlnxxecz` (campaignintelligence).
- Table: `topup.pull_receipts`.
- Confirm the project before the insert. `kemvxzhcxvynmoutwdrh` is maps/parcels. `klomihumrgwoixbzxypr` is CRM. Wrong project is a hard fail.
- Use `execute_sql` / the Supabase MCP. Do not invent a second table.

## Never

- Never put emails, names, phones, or lead objects in the receipt or in chat (ten company-or-title samples on a card is the cap; this receipt needs **zero** samples).
- Never write a row until you know which Smartlead `campaign_id`s received the list.
- Never mix two ICPs in one receipt.
- Never set `email_max_tier` to `fullenrich` unless Josh already stamped FullEnrich on for that client.

## When

Write **once**, at the end of the first successful pull for that ICP, after you know the campaign ids (import or stage is enough). If you later change titles or add a band, write a **new** row — latest wins. Do not update old rows.

## The row

| Column | What to put |
|---|---|
| `written_by` | `claude` (or Josh's name if he typed the filters) |
| `client_tag` | snake_case LeadPipe tag: `parlay`, `peterson`, `salesglider`, `goliath`, … |
| `smartlead_client_id` | The Smartlead client id if you have it (Parlay `418274`, SalesGlider `345263`) |
| `lane` | snake_case offer/lane: `it_dm`, `trades`, `staffing`, `pe`, `roof_owner`, `gc_partner` |
| `campaign_ids` | Postgres array of Smartlead campaign ids this list went into, e.g. `{3847839,3847846}` |
| `icp_kind` | `linkedin_native` (desk / LinkedIn people) or `physical` (rooftop, trade, permit, parcel) |
| `persona` | snake_case buyer: `it_dm`, `owner`, `gc_partner`, `vacant_land`, `staffing_rev`, `pe_partner` |
| `company_source` | Where the **companies** (or people-with-companies) came from. One of: `getleads`, `maps`, `permits`, `maps_and_permits`, `parcels`, `ai_ark`, `table`, `other` |
| `company_filters` | JSON of the exact filters you passed. See shapes below. |
| `domain_source` | How the website/domain was obtained: `already`, `getleads`, `maps`, `domain_waterfall`, `none`, `other` |
| `person_source` | How the named human was obtained: `already`, `getleads`, `ai_ark`, `people_waterfall`, `serp`, `hard_to_find`, `none`, `other` |
| `email_source` | How the work email was obtained: `already`, `getleads`, `name_to_email`, `email_waterfall`, `none`, `other` |
| `email_max_tier` | If `email_source` is `email_waterfall`: how far you allowed the cascade (`getleads`, `smartlead`, `aiark`, `leadmagic`, `prospeo`, `fullenrich`). Null otherwise. |
| `rows_found` | Count only |
| `rows_imported` | Count only |
| `tam_count` | The size number you trusted, if you sized. Count only |
| `how_i_did_it` | One paragraph a later agent can follow. Tools + filters + order. No rows. |
| `notes` | Optional. Thin pool, widening you considered, Josh calls. No rows. |

### `company_filters` shapes

**getleads / AI Ark (desk):**

```json
{
  "job_titles": ["CIO", "IT Director"],
  "company_size": ["11 to 50", "51 to 200"],
  "countries": ["United States"],
  "industries": ["Construction"],
  "email_status": ["VALID"],
  "max_per_company": 3
}
```

Headcount is **band labels only** (`"51 to 200"`), never min/max integers. Industries must not contain commas.

**maps / permits:**

```json
{
  "categories": ["roofing contractor"],
  "states": ["TX"],
  "cities": [],
  "permit_types": ["reroof"],
  "counties": []
}
```

Every brand or subtype is its own Maps category. Do not collapse them.

**table:** `{ "schema_table": "client_peterson.email_resolution", "where": "dl_status is null" }`

## Insert (copy this)

```sql
insert into topup.pull_receipts (
  written_by, client_tag, smartlead_client_id, lane, campaign_ids,
  icp_kind, persona, company_source, company_filters,
  domain_source, person_source, email_source, email_max_tier,
  rows_found, rows_imported, tam_count, how_i_did_it, notes
) values (
  'claude',
  'parlay',
  418274,
  'it_dm',
  '{3847839,3847846}',
  'linkedin_native',
  'it_dm',
  'getleads',
  '{
    "job_titles": ["IT Director", "CIO"],
    "company_size": ["11 to 50", "51 to 200"],
    "countries": ["United States"],
    "email_status": ["VALID"],
    "max_per_company": 3
  }'::jsonb,
  'already',
  'getleads',
  'getleads',
  null,
  400,
  380,
  16000,
  'getleads count_contacts then export_contacts on IT DM titles, bands 11-50 and 51-200, VALID only. Person and email came on the export. Imported to the two 11-50 team campaigns.',
  null
);
```

Swap the values for the pull you just did. If the insert fails a check, fix the enums — do not create another table.

## How to classify the puzzle (this is the part leadtopup cannot infer)

Ask, for the typical row you produced:

1. **Did the company source already include a work email?** → `email_source = already` or `getleads`. Do not list a waterfall you did not run.
2. **Did you have a name but no domain?** → `domain_source = domain_waterfall`.
3. **Did you have a company/domain but no name?** → `person_source = people_waterfall` (or `serp` / `hard_to_find` if that is what you used).
4. **Did you have name + domain but no email?** → `email_source = name_to_email` if that found it, else `email_waterfall` and set `email_max_tier` to the last tier you allowed.

getleads VALID exports are usually `person_source = getleads`, `domain_source = already`, `email_source = getleads`. Peterson roofs are usually `company_source = maps_and_permits`, then `domain_waterfall` → `people_waterfall` → `name_to_email` / `email_waterfall`.

## After the insert

Reply to Josh with **counts and campaign ids only**: client, lane, persona, source, campaign ids, rows found / imported. Then you are done. leadtopup takes it from here the next time that campaign is low and still working.
