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

## Start here (D49): one client, one read, then only what you will act on

1. `client_overview(client_tag)` — every campaign of the client with its
   lead flag, policy gate and reason, the build the service would repeat,
   and `missing_tags`. Read it **once** per client per turn. Its `next`
   line names your next tool.
2. `campaign_history(client_tag, campaign_id)` — **only** for the
   campaigns you are about to top up. It carries the build records, the
   `tags` block (`campaign_method` legs, `missing_tags`, `lead_provenance`
   counted by build label and confidence) and the live pull record.
3. `size_client(client_tag)` — pilot and size in one call; read the
   one-line-per-campaign report; `approval_briefing` goes to Josh.
4. Josh approves; `loads_paused` is off; `start_topup(client_tag,
   campaign_id, count)`. The service pulls from the campaign's own build
   record (the tags), never from a method you wrote in chat.
5. `run_status` once per message. Post a card with counts and a link.
6. Nothing starts on its own (D51): the watch only logs what it would
   have started; you are the start. Every paid call posts a spend card:
   read `list_holds`, get Cayden's or Josh's yes in chat, then
   `resolve_hold`. Under 1,000 leads available, say "the TAM for this
   campaign is exhausted" and stop.

Context rules: `topup_queue` only with `client_tag` or `limit` ≤ 20; no
second read of a list you already have in this turn; never a Supabase
query for what these tools answer; never a SELECT of a lead column. A
campaign with `missing_tags` is not topped up until the tags are stamped
(`skills/lead-provenance`); say which tags and stop.

## How you know what to start (tags, not thirteen steps)

Infer the job from **campaignintelligence** (`azpapwtnrbzywlnxxecz`) tags.
Do not reconstruct `skills/lead-list-build` steps 1–13 in this chat.

Read **every tag**, counts and method names only. Four source legs are
necessary and not sufficient — especially when `icp_kind = physical`.

| Tag | Means |
|---|---|
| `company_source` | Where the company set came from |
| `company_detail` | Which Maps / PermitStack / parcel / label build |
| `company_filters` | Rerun parameters (see physical keys below) |
| `domain_source` | Where the domain came from |
| `person_source` | Where the DM came from |
| `email_source` | Where the address came from |
| `email_max_tier` / `email_tier` | How deep the waterfall went |
| `evidence` | Which provenance source stamped the row |
| `confidence` | `traced` / `label_inferred` / `from_receipt` / `unknown` |
| `build_label` | The named build / source_label |
| `feed_pattern` | Which staging feed mapped to this method |
| `icp_kind` | `linkedin_native` or `physical` |
| `persona` | Buyer, snake_case |
| `segment` | `band`, `mail_class`, `gift`, `offer_key`, `campaign_family` |
| `how_i_did_it` | Method write-up, no rows |
| `yield_by_step` | Count funnel on the receipt |
| `granularity` | `lane` or `build` |
| `campaign_ids` | Existing campaigns only |

Physical `company_filters` keys you must read (do not stop at
`company_source = maps`): `maps`, `maps_runs`, `permits`, `geo`,
`geo_note`, `source_tool`, `titles_wanted`, `job_title_terms`.

LinkedIn-native `company_filters` keys: `job_titles`, `company_size`,
`countries`, `industries`, `max_per_company`.

Tables (counts / keys only):

- `topup.pull_receipts` — every column above. Never the people.
- `topup.campaign_method` — legs + `company_detail` + `evidence`.
- `topup.campaign_recipe` — jsonb `company_sources`, `domain_sources`,
  `person_sources`, `email_sources`, `builds`.
- `topup.feed_map` — `feed_pattern` → legs + `company_detail` +
  `evidence`.
- `topup.lead_provenance` — per-lead stamps of the same tags.
  **COUNT by tag. Never SELECT `email`.**
- `topup.provenance_sources` — the named evidence registry.
- `topup.provenance_gaps` — campaigns still missing a stamp (counts).
- `topup.lane_recipes` — file recipe override
  (`recipes/parlay/it_dm.json`); `campaign_history` shows the one in use.
- `lane_state` / `/where` — which step the **service** is on.
- `topup.campaign_registry` — campaign ids, band, working flag (read
  through `topup_queue` and `campaign_history`; the raw registry tool is
  retired, D48).

Open `client_overview` first for a named client (D49), or `topup_queue` across clients (D43, D44, D46). It is the same lead-refill
lines `#campaign-watchdog` posts (empty, low, nearly-done 90%), ranked,
each with the recipe count summary and the policy gate already applied
(the 1-in-2000 reply bar — 1 reply under 2,000 sends is acceptable, zero
positives never qualifies — plus excluded, retired, paused, dropped,
not active, foreign client). It includes camps the client-wide watch
would skip. Pick the top one. Then read `campaign_history` **before any
top-up**: the build records, which build earned the replies, whether it
can be repeated, and the live pull record (D40, D47). Counts and method
text. Never lead rows. Do not reconstruct the recipe from tags when the
tool answers. If it says `campaign not found in public.campaigns`, say
so and ask Josh. No Slack, no Cursor — the queue is the list.

Then **size the client in one call** with `size_client(client_tag)`:
a size-only run per lane, every campaign judged and counted, one line
per campaign with its gate and reason, and the `approval_briefing` for
Josh. Once Josh approves and `loads_paused` is off, **start the Railway
service** with `start_topup(client_tag, campaign_id, count)`. The
service walks the thirteen steps (D24, D28).
You do not. A file recipe is the override. Otherwise the service
infers from `topup.pull_receipts` tags and notes (D45 — PRs #6 and #7
landed here, not in a Grok session). Do not invent filters in chat.
Check `run_status` once per message, or watch the Slack thread — do
not poll every two minutes.

## Allow list (you may call these)

Service MCP (D48, D49): `client_overview`, `topup_queue`, `campaign_history`, `size_client`,
`approval_briefing`, `start_topup`, `run_status`, `list_runs`,
`abort_run`, `resume_run`, `list_holds`, `resolve_hold`, `loads_paused`,
`lane_state`, `lane_note`, `add_client_domains` (domains only). No tool
on the service returns a lead row or a file URL. `sample_rows`,
`variant_stats`, `campaign_registry`, `recipe_get`,
`missing_piece_groups`, `register_queue_table`, `topup_recipe`,
`topup_campaign_builds` and `topup_provenance_gaps` are retired.

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
rows from `lp_sample` (the service's `sample_rows` is retired, D48).

## If you are stuck

Post a card. Drop a `/where` line. Ask Josh. A thin camp can wait on the
service. That is allowed.
