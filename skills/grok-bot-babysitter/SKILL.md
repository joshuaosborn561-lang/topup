---
name: grok-bot-babysitter
description: Standing orders for the Lead Top Up Grok bot. Use on every Grok / Cursor Grok / Slack Cursor turn in this repo. Grok is the babysitter — it starts the Railway service or a LeadPipe / csv-endpoint job, reads campaignintelligence tags and counts, posts a card, and drops a link. It never pulls lead rows into context, never walks the thirteen-step skill in chat, and never fans out GetLeads child agents.
---

# Grok bot is the babysitter (D39)

Josh, 2026-09-24: "I nuked our grok bot usage again trying to do lead top up."
The desktop Grok agent "Lead top-up service" spawned dozens of child runs
named "Fire GetLeads n=…" and "Apply leftover … CSVs". That is the opposite
of this skill.

You start a run. You read tags and counts. You post a card. You drop a
link. You stop. Rows move **MCP → Supabase**, **edge functions**, and
**LeadPipe**. They do not enter this context.

Read `skills/leadpipe/SKILL.md` and `skills/supabase-csv-endpoint/SKILL.md`
before you move a single row. Those are how Claude already kept tokens
down. Copy that, do not invent a chat pipeline.

## How you know what to start (tags, not thirteen steps)

Infer the job from **campaignintelligence** (`azpapwtnrbzywlnxxecz`) tags.
Do not reconstruct `skills/lead-list-build` steps 1–13 in this chat.

Read, counts and method names only. The source tags are **four legs**,
not three ICP fields:

| Leg | Column | Means |
|---|---|---|
| Company | `company_source` | Where the company set came from (`getleads`, `maps`, `permits`, `ai_ark`, named signals, …) |
| Domain | `domain_source` | Where the domain came from (`already`, `maps`, `domain_waterfall`, `theirstack`, …) |
| Person | `person_source` | Where the DM came from (`getleads`, `ai_ark`, `people_waterfall`, `serp`, `hard_to_find`, …) |
| Email | `email_source` + `email_max_tier` / `email_tier` | Where the address came from (`getleads`, `email_waterfall`, `name_to_email`, …) and how deep the waterfall went |

They live on more than `public.leads` and more than three receipt fields:

- `topup.pull_receipts` — the four legs plus `icp_kind`, `persona`,
  `company_filters`, `campaign_ids`, `segment`, `tam_count`,
  `rows_found`, `rows_imported`. Never the people.
- `topup.campaign_method` — one row per campaign: the four legs +
  `email_tier`.
- `topup.campaign_recipe` — per campaign jsonb `company_sources`,
  `domain_sources`, `person_sources`, `email_sources` (counts of each
  tag, not rows).
- `topup.feed_map` — feed pattern → the four legs.
- `topup.lead_provenance` — per-lead stamps of the same four legs.
  **COUNT by tag. Never SELECT `email`.**
- `topup.lane_recipes` / `recipe_get` — the signed-off file recipe when
  one exists (`recipes/parlay/it_dm.json` is the override).
- `topup.lane_state` / `/where` — which step the **service** is on.
- `campaign_registry` — campaign ids, band, working flag.

Then **start the Railway service** with `start_topup`. The service walks
the thirteen steps (D24, D28). You do not. If there is no recipe yet,
say so and ask Josh — do not walk the skill to invent one. Inferring a
new file recipe from `public.leads` + these stamps is PRs #6 and #7,
not a Grok session.

## Allow list (you may call these)

Service MCP: `start_topup`, `lane_state`, `run_status`, `list_runs`,
`list_holds`, `resolve_hold`, `recipe_get`, `campaign_registry`,
`variant_stats`, `missing_piece_groups`, `add_client_domains` (domains
only), `register_queue_table` (`source_table`, never rows), `lane_note`,
`sample_rows` (ten masked, owner token, prefer not to).

LeadPipe: `lp_plan`, `lp_run` (`ingest_csv` from a vendor URL;
`import_smartlead`; `sync_smartlead`; `build_suppression`), `lp_status`,
`lp_export` (keep the `signed_url` closed; pass it to the next server),
`lp_sample` (n ≤ 10), `lp_inventory`, `lp_ensure_client`,
`lp_list_clients`.

Edge functions / `skills/supabase-csv-endpoint`: table → public CSV URL,
result CSV URL → table. `curl` the URL for HTTP 200 and a line count.
Do not `cat` the file into chat.

Slack: a card with counts, ids, spend, and a link.

## Ban list (you must not call these)

These return contact payloads or dump an export into chat:

- `export_contacts` — GetLeads export is a URL. The **service** starts it.
  You do not. Never wait on the file and paste rows.
- `search_contacts`
- `getleads_enrich_person_batch`
- `getleads_get_emails_from_linkedin_batch`
- `get_decision_makers_batch_result`
- `get_enrichment_result`
- `list_profile_monitoring_leads`
- `list_website_visitor_leads`
- `export_website_visitor_leads`
- `get-dataset-items` (Apify)
- `find_dms_by_title` (~$0.10 / company; estimate first; Josh only)

Also banned:

- `SELECT` of `email`, `first_name`, `last_name`, `phone`,
  `linkedin_url` into chat. Counts and tag columns only.
- `enrich_waterfall` with inline `rows`. Use `source_table` + writeback.
- Pasting a CSV. Opening a signed export URL. Uploading leftover exports
  into this context.
- Child agents named "Fire GetLeads", "Apply leftover CSVs", or anything
  that pulls contacts into a transcript.
- A Grok self-routine that re-reads lists. Scheduled pulses are Railway
  crons (Josh, 2026-09-22, `#campaign-watchdog`).
- Walking `skills/lead-list-build` or a `*-lead-pulls` skill as if you
  were Claude building the first list.

## What "here's what it found" looks like

`Parlay it_dm · run abc123 · getleads export 1,200 · LeadPipe ingest
1,184 inserted · 16 dupes · verify job xyz · sendable 910 · Slack thread
<url>.`

Not the list. Not a sample dump unless Josh asks, and then ten masked
rows from `lp_sample` or `sample_rows`.

## If you are stuck

Post a card. Drop a `/where` line. Ask Josh. A thin camp can wait on the
service. That is allowed.
