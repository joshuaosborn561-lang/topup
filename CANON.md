# Canon — what this service does

Canon as of **D31** (2026-09-12). One page of current truth. When a new
decision lands in `DECISIONS.md`, this file is updated **in the same PR**;
the meta guard in `src/guards/meta.test.ts` enforces both.

`DECISIONS.md` is the append-only ledger of *why*. Derive behaviour from this
page; each rule cites its decision numbers.

## Mission

Client Smartlead campaigns stay topped up with verified, normalized leads
without a human babysitting the pipeline — **any campaign, from any source**
(D18). Slack is the console: every run is a thread, every decision that
costs money or changes a list is a card, and the service does only what a
lane recipe says (D9, D15).

## The line (D18)

> If a task does not require judgement, the service does it. If it requires
> judgement, the service brings it to me in Slack with everything I need to
> decide.

- **Mechanical (service):** runway/health watch, counting, approved pulls,
  ingest, suppression, cascade steps within budget, verification and the
  stall runbook, normalization, QA rules, routing, staging, importing with
  the count assert, merge field checks, receipts, ledger, digest, free
  retries and resumes, splits under the spend rules, registering a cloned
  campaign, keeping missing-piece groups current.
- **Judgement (Josh, on a card):** which segment / whether to widen; whether
  a low campaign is worth topping up; spend above cap; whether a pilot's
  yield justifies scaling; copy for a new cell; ICP changes; a client's
  expanded titles; flipping a campaign active.
- **Routine (Cayden):** QA holds, uploading customer lists, resuming parked
  runs, acknowledging receipts.
- Unclear → judgement column, ask. Nobody automates a decision to save a card.

## The spine (D24, D25)

The business process is the thirteen steps of `skills/lead-list-build/SKILL.md`
and the service is those steps, the gates between them, and the ledger that
records which step a lane is on. The skills are in the repo at `skills/` and
are the specification; `SKILLS_INDEX.md` says which parts are stale, and the
index wins over a stale skill. A lane is always on exactly one step, named by
**number and the skill's title** ("Step 6 — Verify") in every card, log line
and ledger row — `src/spine/steps.ts` is the only table of steps and a guard
fails when it differs from the skill's headings or `Gate:` lines. Code runs
3–12; Josh owns 1, 9 when copy is needed, and 13; Cayden clears holds in 8.
Step 5 applies the customer domain list when it has rows and proceeds when
it is empty — no card (D29). A step's gate halts the run, records
why, posts one card, and waits; silence never means yes. The receipt is the
last gate. `trigger` is step 1 (the recipe is the signed-off segment),
`ingest` 4, `stage` 10.

Gates live today (D25, D26). **Step 2**: the band filter must bind (bands +
other bands = all, within 1%) and the projected net new must clear
`size.useful_floor`, else `pool_thin`. **Step 3**: zero rows delivered stops
the run. **Step 4**: rows read = rows exported; titles audited against the
recipe as whole phrases, off-title flagged for step 8. **Step 5**: report raw, removed by reason, net new; prior contact is a send
by this client in the last 90 days (older recycles unless positive / DNC /
wrong person). **Step 6**: sendable count
and reject rate are reported; nothing sendable stops the run; a reject rate
far above the lane's norm (`verify.reject_rate_norm`, Josh's number; 2× and
10 points over, on 50+ verdicts) stops it and says the source is bad. **Step
7**: every merge field the copy uses (`required_fields`) is populated or the
row is **held** (`qa_hold`, `qa_flags.merge_field_empty`); the run goes on
and reports the held count. No team is not a hold; it is the AirPods tier.
**Step 8**: every hold cleared by a tap (accept, purge, reroute). **Step 9**:
every target campaign is this client's in the mirror; unmatched leads wait
as `pending_campaign` for Josh. **Step 10**: every routed row has a staging
row for this run. **Step 11**: Smartlead's imported count equals rows
submitted. **Step 12**: every merge tag in the copy resolves on every staged
lead. Two flavours of step 3 (LinkedIn-native vs physical, routed per
`leadgen-mcp-routing` step zero — getleads is never the rooftop fallback);
one pipeline from 4 on. Puzzle pieces and email enrichment run after
suppress, immediately before verify (D29), so a suppressed person is not paid
for.

## The service is the memory (D19, D20)

Every lane has a state record, an event log and a queue registry in
`topup.lane_state / lane_events / queue_registry`. It answers: which step and
since when, and the gate that is unmet if it halted there; what is queued where (counts by `lead_status`, every registered
queue with what its rows still lack — domain, person, email — and the next
method); blocked on whom and what they must do; spend this run and this
month by vendor; the one-line event log with what the service intends next;
runway and health of every campaign the lane feeds.

Read it with `/where <client> [lane]`, the `lane_state` MCP tool, or the
daily ops digest (13:00 UTC), which only names lanes whose state changed or
whose health crossed a line. Claude sessions hand work to the service with
`register_queue_table` and `lane_note` over MCP (owner token).

Health, from the hourly Smartlead mirror: **silent** (ACTIVE, untouched
leads, no sends in 7 days), **empty**, **low** (runway under the recipe
floor), **bouncing** (over 5%).

## Build order (D23)

1. Done: ledger, `/where`, digest, verify → normalize (D17).
2. **This build:** a getleads lane end to end, steps 2 → 12 (D26), and the
   runway watch that starts a run on its own (D27).
3. Physical lane cascade with the **yield card** and the **pilot of ~100**;
   nothing scales without the second tap (D21). Peterson roof owners first.
4. Vendor server fixes and attribution.

Before the service calls a vendor server it is documented from its code in
`docs/servers.md`, and Josh reviews that first (D22).

## First pull (D31)

The first list for a campaign is built in Claude. After that pull, Claude
writes one row to `topup.pull_receipts` on campaignintelligence: which
campaigns, ICP kind and persona, where the companies came from, the
filters, and which puzzle piece filled domain / person / email. Counts and
ids only — never lead rows. Mixed ICPs are two receipts. Latest row for
those campaign ids is how the service knows what “more of these people”
means. The recipe can be filled from that receipt; a lane with no receipt
and no recipe cannot be invented.

## What this build runs (D26, D27, D28)

The **watch** is the normal start. Every six hours (and once on boot) it
reads the Smartlead mirror for every recipe. A campaign that is ACTIVE and
empty or under the runway floor, and still **working** (one interested reply
per 2,000 sends, D11), opens a run by itself — no `/topup`, no card. A
campaign that is low and **not** working posts one card: Top up anyway, or
Leave it. Leave it stays quiet until the rate recovers or Josh flips
`/working on`. `/topup` and MCP `start_topup` are the override.

A run is locked in Postgres so there is only ever one per lane (D12). It
walks steps **1 → 13** in the skill's order, every time, whether the watch
or `/topup` started it (D28). Step 1 reuses the saved recipe when the ICP
is already signed off — it does not ask Josh again. Size, pull, ingest,
suppress, verify, normalize, QA, route, stage, import and pre-launch run on
the new rows. Step 13 posts the flip reminder and never sets ACTIVE.

The stages:

1. **trigger** — the saved recipe is the signed-off ICP. Every cell still
   needs a campaign of this client; missing cells or foreign campaigns halt.
   No card when the saved ICP is complete.
2. **size** — classify each **campaign's** ICP (`routing[].icp.kind` +
   `persona`, D30). LinkedIn-native: getleads `count_contacts` plus the
   partition check; AI Ark People Preview is the tam-sizing default primary
   and is not a leadtopup client yet, so the five-line report says so.
   Physical: park — TAM is a Maps/PermitStack range, never a getleads
   number. Campaigns that share kind + persona + source union their bands
   in one count; mixed kinds or personas in the same run park (split them).
   Net-new subtracts emails this client sent in the recycle window
   (`public.sends`), not lifetime staging.
3. **pull** — routed by the target campaigns' ICP and source
   (`leadgen-mcp-routing` step zero). getleads on a LinkedIn-native
   campaign runs `GetleadsPull` with that campaign's bands/titles (or the
   union when the run's targets share a persona). getleads on a physical
   campaign parks (do not fall back). maps / permits / AI Ark park until
   those adapters are wired. The watch passes the needy campaign ids; a
   `/topup` with no ids sizes the whole lane.
4. **ingest** — LeadPipe `ingest_csv` under a run-scoped `source_label`; rows
   claimed for the run; `company_size` / `vertical` filled; title audit
   against the union of the target campaigns' titles.
5. **suppress** — one SQL pass, response based only: positive reply, DNC,
   wrong person, suppression list, bounced, client prior contact (a send by
   this Smartlead client in the last `recycle_after_days`, default 90),
   same offer other client, client customer domain when the list has rows.
   An empty domain list is noted and the step continues — no card (D29).
   Then **puzzle** (name / no domain → Domain Waterfall; domain / no name →
   Find Named Person; names banked in `public.name_bank`) and
   **find_emails** (Name to Email `verify_person`, then Email Waterfall
   `source_table` + writeback). Both sit immediately before verify.
6. **verify** — LeadPipe signed CSV (row count must match), Email Verifier
   Progression, 60s polls, the stall runbook; `mv_status, n2b_status,
   mail_class, verify_path, ev_status, lead_status` per row. Sendable is `mv
   ok` or `catch_all + N2B deliverable`; nothing else (D10).
7. **normalize** — `first_name_n, company_n, location, local_sports_team`
   and flags from the four skill-script ports (D25); empty required merge
   field → hold. `topup.ref_cities` via `npm run seed:cities`, once.
8. **qa** — `topup.qa_rules` named by the recipe (Postgres regex; purge
   before hold); one summary, one card per rule with ten samples of company
   and title; taps accept, purge or reroute (reroute only where the recipe
   maps the target to a campaign of this client).
9. **route** — cell = band × mail class × gift tier; first matching rule;
   campaign must be this client's in `public.campaigns`; no match →
   `pending_campaign` and a card to Josh (continue without, or abort).
10. **stage** — `public.leads_staging` with normalized `first_name` /
    `company_name`, `job_title`, `vendor`, `source_dedupe_key`, `imported = false`.
11. **import** — Smartlead `start_lead_import` per campaign, poll
    `get_lead_import_status`, count assert; a mismatch stops before the next
    campaign. Restart-safe through `run_steps.vendor_job_id`.
12. **post_import** — merge tags from `get_sequences` against staged
    coverage (the `check_merge_tags.py` port), settings findings from
    `get_campaign`, runway before → after; one pre-launch post per run.
13. **flip** — posts the step 13 line: Josh sets ACTIVE by hand and watches
    day one. The service never starts, pauses, or stops a campaign. Then the
    run closes as `done` with the **receipt** (the funnel plus one line per
    campaign). The watch starts the next fill when a campaign is low and
    still working.

`/health` reports counts by `lead_status`, spend by vendor, stall events,
open cards, open runs and which integrations are configured.

## Money (D9)

- Auto cap **$5** per step; anything over asks with the worst case in
  dollars and waits for Josh. Daily backstop **$25** across vendors.
- Worst case comes from `src/spend/prices.ts` × batch size. Never a
  vendor's number.
- One `topup.spend_ledger` row per vendor call, free or paid.
- A bill more than 10% over the approval stops the run and pages the ops channel (`C0C135EB76H`).
- Verifier resume is free. A split is spend.
- Banned: PDL (including wrappers), LeadMagic job change detector,
  BillionVerifier, Clay (D8). FullEnrich off per recipe until Josh stamps
  `owner_approved_at` (D7).

## People (Slack, D2)

- Owner = Josh, operator = Cayden, by Slack user id in Railway variables.
- Owner-only taps: approve/decline spend, top up anyway / leave it, split,
  continue without pending leads, anything that changes a recipe. Operator
  taps never spend and never change a recipe; the reply is "This needs Josh."
  Step 5 no longer waits on a customer-domain-list card (D29).
- Commands: `/where`, `/topup` (override — the watch is the normal start), `/holds`, `/runs`, `/working` (owner),
  `/suppress` (explains itself until the suppression stage lands).
- `/mcp` with owner and operator bearer tokens exposes `lane_state,
  run_status, list_runs, list_holds, resolve_hold, start_topup,
  add_client_domains` (domains only, never rows) to both and
  `register_queue_table, lane_note, sample_rows` (ten max, emails masked),
  `variant_stats, campaign_registry, recipe_get, missing_piece_groups` to
  the owner.
- Counts and ids only. Ten sample values on a card at most, never emails.

## Never (D1–D6, D8, D13, D14)

- Never write to a Supabase project other than `azpapwtnrbzywlnxxecz`.
- Never hardcode a secret. Never call a vendor in a test.
- Never start, pause, stop or delete anything in Smartlead; never remove an
  API-added block-list entry.
- Never send getleads numeric headcount bounds or comma industries; only
  `VALID` emails count.
- Never patch around a broken vendor server; bound the damage by batch size
  and say so in the PR.
- Never trust "processed" or a zero-verdict resume as a verification.
- Never run more than one replica.

## Where things are

| Thing | Place |
|---|---|
| State | `topup.*` on campaignintelligence; migrations in `supabase/migrations` |
| Skills | `skills/` — Josh's skills, the specification; `skills/SKILLS_INDEX.md` says what is stale (D25) |
| Spine | `src/spine/steps.ts` (the thirteen steps, from the skill), `src/spine/gate.ts` (`GateUnmet`, step 6 and 7 rules) |
| Stages | `src/stages/<stage>/` one per step, `src/stages/common.ts` the shared attempt/finish/park discipline, `PIPELINE_STEPS` in `src/orchestrator.ts` |
| Vendor clients | `src/clients/` — getleads, Smartlead (D6 allow list), LeadPipe, verifier; every one documented in `docs/servers.md` first |
| Lane ledger | `src/ledger/` (`lane.ts` state, `health.ts` campaign lines, `render.ts` `/where` + digest text) |
| Servers | `docs/servers.md` — every vendor server from its code (D22) |
| Recipes | `recipes/<client>/<lane>.json`, validated at boot, mirrored to `topup.lane_recipes` |
| First-pull receipts | `topup.pull_receipts` — Claude writes after the first list (D31); `skills/first-pull-receipt` |
| Rails | `src/spend/` |
| Runbook | `src/stages/verify/runbook.ts` (pure) |
| Cards | `src/slack/cards.ts`; state in `topup.cards` |
| Guards | `src/guards/*.test.ts` — each names its decision and who to ask |
