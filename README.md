# leadtopup

Keeps SalesGlider client campaigns topped up with verified, normalized leads
without a human babysitting the pipeline. Runs on Railway, keeps its state in
the `topup` schema on Supabase (campaignintelligence), and talks to people
through Slack.

Read `CANON.md` first. It is one page and it is the current truth.
`DECISIONS.md` is the ledger of why.

## What is in this build (Phase 1)

- `/health` — counts by `lead_status`, spend by vendor, stall events, open
  cards, open runs, integration readiness.
- The `topup` schema, the `lead_status` column on `lp.*_ingested_leads`, the
  write lock (one open run per lane and per campaign; lead writes carry
  `app.run_id`).
- Spend rails: $5 auto cap per step, $25 per day, worst case from the price
  table, ledger row per call, Slack card for anything over the cap.
- Slack: one thread per run, cards with buttons, slash commands, owner and
  operator roles.
- `/mcp` with owner and operator tokens.
- The **spine**: the thirteen steps of `skills/lead-list-build/SKILL.md` as
  the state machine (`src/spine/steps.ts`), with gates that halt a run, record
  why and post one card. Steps 6 and 7 gate today.
- The **lane ledger**: step per lane, event log, queue registry. `/where
  <client> [lane]`, the `lane_state` MCP tool, and a daily ops digest that
  only names lanes whose state changed or whose campaign health crossed a
  line. Claude sessions hand queue tables to the service with
  `register_queue_table` and leave notes with `lane_note`.
- The **verify** stage (LeadPipe export → Email Verifier Progression → stall
  runbook → per-row verdicts) and the **normalize** stage.
- A run stops after normalize. Routing, staging and import are later PRs.
- `docs/servers.md` — every vendor server documented from its code, with the
  breakages confirmed and listed as prerequisite PRs. Read before building on
  a server.

## Running it

```bash
npm install
cp .env.example .env        # fill from Railway; never commit values
npm run migrate             # applies supabase/migrations in order, refuses the wrong project
npm run dev
curl localhost:3000/health
```

`npm test` runs the unit tests and the guards. No test calls a vendor.

## Layout

```
src/
  index.ts            boot: config check, /health first, then everything else
  config.ts           env → typed config; refuses the wrong Supabase project
  orchestrator.ts     opens runs, drives stages, reacts to card taps
  commands.ts         /where /topup /holds /runs /working /suppress
  health.ts           the first run report
  db/                 pg pool with app.run_id transactions; typed repo over topup.*
  domain/             lead_status machine, run vocabulary, the "working" rule
  spine/              the thirteen steps (number, owner, gate, skill, pipeline stages) and gate outcomes
  ledger/             lane step + gate, event log, queue registry, campaign health, /where text, digest
  spend/              price table, the five rails, balance readers
  recipes/            recipe schema (zod) and loader
  slack/              signature check, roles, cards, poster, console, router
  mcp/                /mcp server with per-role tool sets
  clients/            LeadPipe and verifier HTTP clients (called, never forked)
  stages/verify/      runbook (pure), sendable rule, the stage
  stages/normalize/   names, company, location, team, the stage
  guards/             tests that name a decision and who to ask
recipes/<client>/<lane>.json
supabase/migrations/*.sql
docs/servers.md       the vendor servers, from their code
```

## Slack

- Every run posts to the client's channel (`SLACK_CLIENT_CHANNELS`) as one
  thread; ops-wide alerts go to `SLACK_OPS_CHANNEL`.
- Cards wait in the database, so a redeploy does not lose an open ask.
- Slash commands and interactions post to `/slack/commands` and
  `/slack/interactions`; both check the Slack signature.

## Adding a recipe

Create `recipes/<client_tag>/<lane>.json` matching `src/recipes/schema.ts`.
It is validated on boot (a bad recipe fails the deploy) and mirrored to
`topup.lane_recipes`. Recipes change in git only.
