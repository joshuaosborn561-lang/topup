---
name: "rvm-campaign-setup"
description: "Stand up, load, and run a ringless voicemail campaign in Josh's RVM Drop app (rvm-drop-production.up.railway.app) to SalesGlider standard: pull live line IDs, set audio and callback forward, load leads server to server through a Supabase CSV endpoint, activate, and verify from the audit log. Use whenever Josh asks to drop an RVM, build or stage an RVM campaign, load leads into RVM, record or swap the voicemail audio, check whether a campaign is sending, or asks why an RVM campaign sent nothing. Also use before setting any RVM campaign ACTIVE, and whenever running the owner-cell enrichment ladder that feeds one."
---

# RVM campaign setup

Josh's own RVM sequencer. A Next.js app on Railway with an MCP at `/api/mcp`, a web UI,
and Slybroadcast behind it. Same shape as `smartlead-campaign-settings` and
`heyreach-campaign-setup`, different channel.

## The five things that have actually broken

Read these before anything else. Each one silently produced zero sends.

**Line IDs are not stable.** The 817 DID pool was re-provisioned around Sept 8 2026 ...
same phone numbers, brand new `ln_` ids, warmup reset to day 8, cap 48. Every campaign
still pointing at the old ids failed on first drain with `lastError:
NO_LINES_CONFIGURED` and auto-paused. Two campaigns sat dead for over a week.
**Always `lines_list` and set `lineIds` from that live read immediately before
activating.** Re-check on any campaign untouched for a week.

**Appending leads does not schedule them.** `leads_import_from_url` with `mode: append`
adds leads to the list but creates no send attempts. Attempts are only created on a
status flip to ACTIVE. **After any append, re-send `status: ACTIVE`.** Note this resets
`activatedAt` and puts the ramp back to day 0, so a mid-ramp append dumps everything at
once rather than continuing the ramp.

**`campaigns_get` and `leads_list` dump every lead row into context.** On a 93-lead
campaign that is enough to stall a turn. Use `campaigns_update` with just the id as the
read-back tool ... it echoes the campaign object without leads and exposes `lastError`,
`scheduled`, `lastDrainStats`, and `activeDay`. Keep `audit_list` at `limit: 10`.

**Skips write no audit event by default.** A campaign that is drained but sending
nothing shows an empty audit log. Diagnose from `lastError` and `lastDrainStats`
(`attempted` vs `sent` vs `skipped`), not from the audit log's silence.

**`SEED_INJECTED` means queued, not sent.** Only `ATTEMPT_SENT` with `isSeed: true`
proves the audio actually went out.

## Order of operations

1. Build the lead list and get verified owner cells ... see the enrichment ladder below
2. `lines_list` ... take the current healthy line ids
3. `settings_get` / `settings_update` ... callback forward
4. Audio ... record or upload, confirm it is publicly fetchable
5. `campaigns_create`, then `campaigns_update` with lines, audio, script, schedule, ramp
6. Stage the leads as a Supabase CSV endpoint, `leads_import_from_url`
7. Add a seed
8. `campaigns_update` `status: ACTIVE`
9. Verify from `audit_list` at limit 10 within the first 20 minutes

## Line selection

`lines_list` returns status, reputation, warmup day, daily cap, and sent-today.

Use only lines that are `HEALTHY` and `UNFLAGGED`. Exclude anything `DEGRADED`,
`QUARANTINED`, `WARMING`, or with a reputation label of `MIXED_LOW` or `FLAGGED`.
Exclude area codes that do not match the target geography ... a 415 caller ID on a DFW
contractor is a wasted drop.

## Schedule and ramp

House defaults, measured to work:

| Setting | Value |
|---|---|
| `sendDays` | `[1,2,3,4,5]` |
| `sendWindowStart` / `End` | 9 / 17 |
| `fridaySendWindowEnd` | 13 |
| `timezoneMode` | `RECIPIENT_LOCAL` |
| `stopOnCallback` | true |
| `stopOnOptOut` | true |
| ramp | start 40, increment 20, ceiling 80 |

**Ramp is campaign-level, not per line.** `ceilingPerDay` equals `newLeadsPerDay`; line
`dailyCap` is a separate ceiling that rarely binds. `lineMinGapSec` of 600 caps each
line at roughly 48 sends per 8 hour window, so five lines fire five drops every 15
minutes.

A 9 to 5 recipient-local window sits inside every federal and state quiet-hours rule
(8am to 9pm at the tightest), so it is compliant even if the clamp layer is not loaded.

## Audio

The app has an in-app recorder at `/record/[campaignId]`, minted by
`create_recording_link` (signed, 7 day default TTL). That is the right way for Josh to
record ... it shows the script, records, plays back, and attaches to the campaign.

**Supabase cannot host a recorder page.** Edge functions and storage both force
`content-type: text/plain` and `content-security-policy: default-src 'none'; sandbox`,
so HTML never renders from a `supabase.co` URL. A day was lost proving this.

For a file Josh sends in chat: POST it to the recorder's upload endpoint to get a public
URL, then `audio_upload` with that url and a name. **Slybroadcast fetches the audio
anonymously**, so the URL must be publicly readable with no auth. Verify with a plain
GET before activating.

Prefer m4a or mp3 over wav. Browser recordings should be encoded to 8kHz mono WAV
client-side; there is no ffmpeg in the Railpack image.

Set `audioUrl` at both campaign level and step level.

## Callback forward

Workspace-level, not per campaign: `settings_update` with `callForwardToE164` and
`callForwardTimeoutSec`. **Use 90 seconds** ... the Twimlets default of about 20 cuts off
mid-ring and callbacks never connect.

Check which Allo line it points at and whether that line's AI receptionist is ACTIVE,
because that decides whether a callback reaches a person or an agent.

## Script

`scriptTemplate` is reference text for the operator, not TTS ... the audio is static.
Still write it properly, since it is what the recorder page displays.

Use `{{company}}` rather than `{{first_name}}`. Officer-match failures leave blank first
names, and "Hey ," on a voicemail is a dead giveaway. Company is populated far more
reliably.

House structure, from the Cayden script that produced a 17% callback rate:
cold-call admission up front, one concrete proof number, a free offer, a soft close.
About 22 to 36 seconds.

## Loading leads

**Never pass lead rows through tool arguments.** `leads_import_from_url` takes an HTTPS
CSV URL on `*.supabase.co`. Build a `security definer` SQL function that emits the CSV,
wrap it in an edge function, curl-verify it (200, correct row count, zero malformed
phones), then hand RVM the URL.

CSV header: `phone,firstName,lastName,company`. Phones as `+1XXXXXXXXXX`.

Before loading, drop:
- any number equal to the company's Google LSA listing phone (see below)
- landlines ... verify line type first
- duplicate numbers across the whole campaign set
- rows where the "first name" is the company name or a single initial ... blank the name
  fields rather than dropping the row, since the script uses company anyway
- anything already dropped in a prior campaign

Take the campaign's `upload_count` equivalent (`imported`) and confirm it equals the CSV
row count. `dncHits` greater than zero means the global list caught someone.

**Never RVM a Google LSA listing phone.** It is usually a Google call-tracking number,
and a voicemail drop registers as an LSA lead that bills the contractor $50 to $300.

## Seeds

`seeds_upsert` with Josh's cell before activating. The seed is the only proof that the
audio plays and that Slybroadcast can fetch it from wherever it is hosted. Watch for
`ATTEMPT_SENT` with `isSeed: true`, not just `SEED_INJECTED`.

## Verifying a live campaign

`audit_list` at `limit: 10`. Healthy looks like five `ATTEMPT_SENT` per tick, one per
line, every 15 minutes, each with a `providerMessageId`. `ATTEMPT_SKIPPED` with
`OUTSIDE_SEND_WINDOW` is normal for western time zones early in the day and resolves on
a later tick.

Provider acceptance is not delivery. Slybroadcast accepting a job only means it queued.

## Suppression

RVM suppression lives in the app's own Postgres and **does not propagate**. A DNC here
does not stop Smartlead, does not stop Allo, and does not write to
`public.suppression`. `suppress_phone` takes `phone` (not `e164`) and `reason` capped at
120 characters.

The Allo-to-RVM sync exists (`suppression_sync_run`, `suppression_sync_status`) but is
`configured: false` until `ALLO_API_KEY` is added to the RVM Drop Railway service. Allo
also has no `do_not_call` tag and no block primitive; the closest is a tag plus a
conversation note.

## Feeding the campaign: the owner-cell ladder

For contractor lists, business name to verified owner cell:

1. **Domain** ... Domain Waterfall `resolve_domain`, name plus city. Do not pass an LSA
   phone as a match input.
2. **Owner name** ... Find Named Person `resolve_people`. For trades put **AI Ark first**
   (LeadMagic was removed from the stack Oct 8 2026): AI Ark hit a 94% owner-title rate at
   about half a cent, LeadMagic had returned 277 people for 4 owner matches at three times the
   cost. Pass `skip_tiers=leadmagic_employee,leadmagic_role` until the service default drops
   them. Secretary of State officer match (Sunbiz, TX Comptroller) belongs in front of AI Ark
   and is nearly free.
3. **Cell** ... Email Finder Waterfall, `need: 'phone'`, `require_title_match: true`,
   `max_tier: 'prospeo'`, `skip_tiers: 'leadmagic'`.
4. **Line type** ... Veriphone on every hit. About 92% come back mobile.

Measured yield: roughly 40% of companies produce a named owner, 88% of named owners
produce a cell, 92% of those verify as mobile. Net about 1 in 3 companies to a loadable
lead. **The leak is the name rung, not the cell rung.**

### Two traps in the ladder

**Scope the `where` clause to the batch.** `enrich_waterfall` with a bare
`cellphone is null` matches the entire shared contacts table. On Sept 16 2026 that
processed 1,905 rows instead of 92 and spent about $5 re-enriching rows that already had
cells. Always scope (`lane = 'signal_batch2' and cellphone is null`) and confirm the row
count in SQL first.

**The `<tag>_wf_contacts` table duplicates on every run.** The writer inserts rather than
upserts ... 5,543 rows for 89 companies and 230 real owners. New cells land on fresh
duplicate rows while the originals stay null, which makes yields read as zero and sends
you chasing a phantom failure. **Always query through
`distinct on (lower(first_name), lower(last_name), domain)`.** A unique index would make
the service error, so the real fix is a Cursor change to make the writer upsert.

New contacts tables also need `notify pgrst, 'reload schema'` and the full column set
(`job_level, email, email_status, cellphone, contact_city, contact_state, source_tool,
source_url, confidence, place_id, suppressed`) or the writer fails.

## Keep tool payloads small

`audit_list` at limit 100, people-waterfall `get_job_status`, and broad `tool_search`
calls each return enough to stall a turn. Get counts from SQL against Supabase instead.