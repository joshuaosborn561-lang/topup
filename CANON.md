# Canon — what this service does

Canon as of **D17** (2026-09-11). One page of current truth. When a new
decision lands in `DECISIONS.md`, this file is updated **in the same PR**;
the meta guard in `src/guards/meta.test.ts` enforces both.

`DECISIONS.md` is the append-only ledger of *why*. Derive behaviour from this
page; each rule cites its decision numbers.

## Mission

Client Smartlead campaigns stay topped up with verified, normalized leads
without a human babysitting the pipeline. Slack is the console: every run is
a thread, every decision that costs money or changes a list is a card, and
the service does only what a lane recipe says (D9, D15).

## What this build does (Phase 1, D17)

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
- Commands: `/topup`, `/holds`, `/runs`, `/working` (owner), `/suppress`
  (explains itself until the suppression stage lands).
- `/mcp` with owner and operator bearer tokens exposes `run_status,
  list_runs, list_holds, resolve_hold, start_topup` to both and `sample_rows`
  (ten max, emails masked), `variant_stats, campaign_registry, recipe_get,
  missing_piece_groups` to the owner.
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
| Recipes | `recipes/<client>/<lane>.json`, validated at boot, mirrored to `topup.lane_recipes` |
| Rails | `src/spend/` |
| Runbook | `src/stages/verify/runbook.ts` (pure) |
| Cards | `src/slack/cards.ts`; state in `topup.cards` |
| Guards | `src/guards/*.test.ts` — each names its decision and who to ask |
