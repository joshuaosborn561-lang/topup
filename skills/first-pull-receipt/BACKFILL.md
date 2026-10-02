# Receipt backfill prompt

Paste this to the Claude that did (or can see) the pull. It is the same
row `first-pull-receipt` asks for at step 11.5, written after the fact.
The leadtopup service does not invent titles, bands, campaign ids or a
TAM (D45). If the receipt does not carry them, every top-up on that lane
parks with `receipt gap — receipt <id> … Missing — …` and points here.

A receipt that passes this prompt means the service always knows what to
do on that lane. No recipe file is needed.

---

## Prompt

> You are backfilling `topup.pull_receipts` on Supabase project
> `azpapwtnrbzywlnxxecz` (campaignintelligence) for **client `<client_tag>`,
> lane `<lane>`**. A Railway service (leadtopup) re-runs this pull from the
> receipt alone. It refuses to guess, so every field below must come from
> what you actually ran — the getleads `count_contacts` / `search_contacts`
> arguments, the LeadPipe `source_label`, the `lp.*` or `client_<tag>.*`
> tables, Smartlead campaign names. Never from memory of a vibe.
>
> Write **one new insert** (`written_by = 'claude_backfill'` for a lane
> row, `'claude_backfill_build'` for a build row). Never update an old row;
> the latest row wins. Counts and ids only — no emails, names, phones or
> lead objects in the row or in this chat.
>
> **Before you insert, every item below must be true or you stop and ask
> Josh for the one value you cannot find.**
>
> 1. **`campaign_ids` are only this lane's campaigns.** List the Smartlead
>    campaigns under client id `<smartlead_client_id>` and copy the ids
>    whose name is this lane (e.g. `PowerGRYD | vCISO | …` → vciso;
>    `… | MSP Sec Leads | …` → msp_sec_leads). A campaign id appears on
>    exactly one lane's receipt. A resolution step (a name bank, a re-verify
>    pass) that feeds other lanes' campaigns is **not a lane**: it gets no
>    lane row of its own; record it as a `build` row on the lane it fed, or
>    skip it.
> 2. **`company_source` is one of the named sources** (`getleads`, `maps`,
>    `permits`, `maps_and_permits`, `parcels`, `ai_ark`, `table`, or a named
>    signal). Not `other`. Not prose.
> 3. **If `company_source = getleads`, `company_filters` is a complete
>    getleads param set:**
>    - `job_titles`: the exact title list you passed. A list of persona
>      words (`"vCISO"`, `"fractional CISO"`) matched on headline or bio is
>      not a title list — if that is what you did, the source was a people
>      search, so say so (see 4) rather than inventing titles.
>    - `company_size`: exact band labels only — `"1 to 10"`, `"11 to 50"`,
>      `"51 to 200"`, `"201 to 500"`, `"501 to 1000"`, `"1001 to 5000"`,
>      `"5001 to 10000"`, `"10001+"`. Never `"any"`, never min/max integers,
>      never a sentence. Individuals and one-person shops are `"1 to 10"`
>      only if that is the band you passed.
>    - `countries` (and `states` / `cities` / `industries` if you used them;
>      no commas inside an industry).
>    - Omit `email_status` (D35 item 15). Put `max_per_company` under
>      `export_caps`, not in the count filters.
> 4. **If the people came from AI Ark, Prospeo, or a headline/bio match**,
>    `company_source` is `ai_ark` (with `titles` / `locations`) or the
>    person leg is `people_waterfall` — write what ran. If the lane mixed
>    vendors and you cannot name one re-runnable query, say that in `notes`
>    and tell Josh the lane needs a decision before the service can top it
>    up. Do not paper over it with a getleads filter you did not run.
> 5. **`tam_count` is a fresh `count_contacts` (desk) or Maps/permit
>    company count (physical), run now with the filters in 3.** Required on
>    a getleads lane row. `rows_found` is the export size; `rows_imported`
>    is what landed in Smartlead. These are three different numbers.
> 6. **`icp_kind`** is `linkedin_native` or `physical`; **`persona`** and
>    **`lane`** are snake_case.
> 7. **`domain_source` / `person_source` / `email_source`** from the
>    vocabulary in `SKILL.md`; `email_max_tier` only if a waterfall ran.
> 8. **`how_i_did_it`** is two to five sentences: the counting call, the
>    export call, the verify step, the campaigns. Put the long story in
>    `notes`. Both stay free of lead data.
>
> Then report to Josh in one line per lane: client, lane, granularity,
> build_label, source, campaign ids, tam / found / imported, and any item
> above you could not satisfy and why.

---

## Lane-row template

```sql
insert into topup.pull_receipts (
  written_by, granularity, build_label, client_tag, smartlead_client_id, lane, campaign_ids,
  icp_kind, persona, company_source, company_filters,
  domain_source, person_source, email_source, email_max_tier,
  rows_found, rows_imported, tam_count, yield_by_step, spend_cents, segment, suppression_scope,
  how_i_did_it, notes
) values (
  'claude_backfill', 'lane', null,
  '<client_tag>', <smartlead_client_id>, '<lane>', '{<this lane''s campaign ids only>}',
  'linkedin_native', '<persona>', 'getleads',
  '{"job_titles":[...],"company_size":["11 to 50","51 to 200"],"countries":["United States"],"export_caps":{"max_per_company":3}}'::jsonb,
  'already', 'getleads', 'getleads', null,
  <export size>, <imported>, <count_contacts now>,
  '{"imported":<imported>}'::jsonb, 0,
  '{"band":["11_50","51_200"]}'::jsonb, 'response_based_v1',
  '<count call, export call, verify, campaigns>', null
);
```

## What the service checks

`src/recipes/infer.ts` reads the latest lane row (filter book) and the
best imported build row (method). It needs `job_titles` + valid
`company_size` bands to produce a getleads source; anything else is a
`mixed` source and the size step parks with the receipt id and the
missing field names. `campaign_ids` become the recipe's routing and the
`topup.campaign_registry` lane stamp, so a cross-lane id mislabels the
registry and the runway maths. There is no file to write.
