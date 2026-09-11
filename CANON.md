# Canon — what this service does

Canon as of **D23** (2026-09-11). One page of current truth. When a new
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

## The service is the memory (D19, D20)

Every lane has a state record, an event log and a queue registry in
`topup.lane_state / lane_events / queue_registry`. It answers: stage and
since when; what is queued where (counts by `lead_status`, every registered
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

1. **This build:** ledger, `/where`, digest, plus verify → normalize (D17).
2. getleads lanes end to end (pull … import, runway watch).
3. Physical lane cascade with the **yield card** and the **pilot of ~100**;
   nothing scales without the second tap (D21). Peterson roof owners first.
4. Vendor server fixes and attribution.

Before the service calls a vendor server it is documented from its code in
`docs/servers.md`, and Josh reviews that first (D22).

## What this build runs (D17)

`/topup <client> <lane>` (or MCP `start_topup`) opens a run for that lane,
locked in Postgres so there is only ever one (D12). The run:

1. **verify** — claims `lp.<tag>_ingested_leads` rows in `needs_verify`,
   exports them through LeadPipe as a signed CSV (row count must match),
   submits to Email Verifier Progression, polls every 60s, applies the stall
   runbook, and writes `mv_status, n2b_status, mail_class, verify_path,
   ev_status, lead_status` per row. Sendable is `mv ok` or `catch_all + N2B
   deliverable`; nothing else (D10). SEG / OTHER is stamped from `mail_class`.
2. **normalize** — moves `verified` rows to `normalized` with
   `first_name_n, company_n, location, local_sports_team` and flags (D16).
   Raw columns are never overwritten.
3. Closes as `done` with a receipt. Nothing is routed, staged or imported.

`/health` reports counts by `lead_status`, spend by vendor, stall events,
open cards, open runs and which integrations are configured.

## Money (D9)

- Auto cap **$5** per step; anything over asks with the worst case in
  dollars and waits for Josh. Daily backstop **$25** across vendors.
- Worst case comes from `src/spend/prices.ts` × batch size. Never a
  vendor's number.
- One `topup.spend_ledger` row per vendor call, free or paid.
- A bill more than 10% over the approval stops the run and pages `#topup_ops`.
- Verifier resume is free. A split is spend.
- Banned: PDL (including wrappers), LeadMagic job change detector,
  BillionVerifier, Clay (D8). FullEnrich off per recipe until Josh stamps
  `owner_approved_at` (D7).

## People (Slack, D2)

- Owner = Josh, operator = Cayden, by Slack user id in Railway variables.
- Owner-only taps: approve/decline spend, top up anyway / leave it, split,
  anything that changes a recipe. Operator taps never spend and never change
  a recipe; the reply is "This needs Josh."
- Commands: `/where`, `/topup`, `/holds`, `/runs`, `/working` (owner),
  `/suppress` (explains itself until the suppression stage lands).
- `/mcp` with owner and operator bearer tokens exposes `lane_state,
  run_status, list_runs, list_holds, resolve_hold, start_topup` to both and
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
| Lane ledger | `src/ledger/` (`lane.ts` state, `health.ts` campaign lines, `render.ts` `/where` + digest text) |
| Servers | `docs/servers.md` — every vendor server from its code (D22) |
| Recipes | `recipes/<client>/<lane>.json`, validated at boot, mirrored to `topup.lane_recipes` |
| Rails | `src/spend/` |
| Runbook | `src/stages/verify/runbook.ts` (pure) |
| Cards | `src/slack/cards.ts`; state in `topup.cards` |
| Guards | `src/guards/*.test.ts` — each names its decision and who to ask |
