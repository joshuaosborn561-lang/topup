# leadtopup

Keeps SalesGlider client campaigns topped up with verified, normalized leads
without a human babysitting the pipeline. Runs on Railway, keeps its state in
the `topup` schema on Supabase (campaignintelligence), and talks to people
through Slack.

Read `CANON.md` first. It is one page and it is the current truth.
`DECISIONS.md` is the ledger of why.

## What is in this build

- The **watch** (every six hours, and once on boot): if a campaign is low or
  empty and still working (1 interested reply per 2,000 sends), a run starts
  on its own. If it is low and not working, Josh gets one card. `/topup` is
  the override.
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
- Josh's **skills** at `skills/` — the specification. `lead-list-build` is
  the spine; `SKILLS_INDEX.md` names the stale parts (the index wins).
- The **spine**: the thirteen steps of `skills/lead-list-build/SKILL.md` as
  the state machine (`src/spine/steps.ts`, titles/owners/gates copied from the
  skill and guarded), with gates that halt a run, record why and post one
  card. Every step from 2 to 12 has its gate wired (CANON, "The spine").
- The **lane ledger**: step per lane, event log, queue registry. `/where
  <client> [lane]`, the `lane_state` MCP tool, and a daily ops digest that
  only names lanes whose state changed or whose campaign health crossed a
  line. Claude sessions hand queue tables to the service with
  `register_queue_table` and leave notes with `lane_note`.
- **Steps 1 → 13 end to end for a getleads lane** (Parlay `it_dm`): step 1
  reuses a file recipe, or proposes from the receipt + outcome (D39) and
  waits for Josh's segment tap, then size,
  pull (`GetleadsPull` behind one adapter interface), find emails (skipped
  for getleads), ingest through LeadPipe, suppress (one SQL pass, response
  based; campaignintelligence positives expire 90 days after the reply;
  optional customer domains via the `add_client_domains` MCP tool),
  verify (LeadPipe export → Email Verifier Progression → stall runbook →
  per-row verdicts), normalize (the four skill scripts ported), QA (rules in
  `topup.qa_rules`, hold cards for Cayden), route (cell → campaign, client
  check), stage (`public.leads_staging`), import (Smartlead, count assert),
  pre-launch (merge tags + settings, the `check_merge_tags.py` port), the
  step 13 reminder (Josh flips ACTIVE; the service never does), and the
  receipt.
- Geocoding needs `topup.ref_cities`: run `npm run seed:cities` once per
  database (downloads the free US cities file, pinned).
- `docs/servers.md` — every vendor server documented from its code, with the
  breakages confirmed and listed as prerequisite PRs. Read before building on
  a server.

## Running it

```bash
npm install
cp .env.example .env        # fill from Railway; never commit values
npm run migrate             # applies supabase/migrations in order, refuses the wrong project
npm run seed:cities         # once per database
npm run dev
curl localhost:3000/health
```

Deploying this build on Railway needs, beyond the Phase 1 variables:
`GETLEADS_MCP_URL`, `GETLEADS_TOKEN`, `SMARTLEAD_MCP_URL`, `SMARTLEAD_TOKEN`,
and `LEADMAGIC_API_KEY` for leftover company-size backfill (≤ $5 total).
(see `.env.example`). Then `npm run migrate` for 0007 and 0008.

`npm test` runs the unit tests and the guards. No test calls a vendor.

## Layout

```
src/
  index.ts            boot: config check, /health first, then everything else
  config.ts           env → typed config; refuses the wrong Supabase project
  orchestrator.ts     opens runs, drives stages, reacts to card taps
  watch/              runway watch: low + working → go; low + dead → ask Josh
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
  clients/            LeadPipe, verifier, getleads and Smartlead (allow-listed) clients — called, never forked
  stages/common.ts    attempt / finish / park / poll — the discipline every stage shares
  stages/trigger/     step 1: saved ICP or infer-from-list + tags; backfill blank company_size
  stages/size/        step 2: counts, partition check, plan
  stages/pull/        step 3: PullAdapter interface, GetleadsPull
  stages/ingest/      step 4: LeadPipe ingest_csv, claim, title audit
  stages/suppress/    step 5: one SQL pass, 90-day recycle, no domain-list card
  stages/puzzle/      after suppress: name/domain/person gaps
  stages/find_emails/ immediately before verify: DiscoLike first (paused Name to Email), then Email Waterfall
  stages/verify/      step 6: runbook (pure), sendable rule, the stage
  stages/normalize/   step 7: names, company, geo, location, team (ports of the skill scripts)
  stages/qa/          step 8: topup.qa_rules, hold cards, taps
  stages/route/       step 9: cell match, client check, pending_campaign card
  stages/stage/       step 10: public.leads_staging
  stages/import/      step 11: Smartlead import, count assert
  stages/post_import/ step 12: merge tags (check_merge_tags.py port), settings findings
  stages/flip/        step 13: remind Josh to flip ACTIVE; never does it
  guards/             tests that name a decision and who to ask
recipes/<client>/<lane>.json
supabase/migrations/*.sql
docs/servers.md       the vendor servers, from their code
skills/               Josh's skills; lead-list-build is the spine, SKILLS_INDEX.md marks stale parts
scripts/seed-cities.ts  load topup.ref_cities once (npm run seed:cities)
```

## Slack

- Every run posts to the client's channel (`SLACK_CLIENT_CHANNELS`) as one
  thread; ops-wide alerts go to `SLACK_OPS_CHANNEL`.
- Cards wait in the database, so a redeploy does not lose an open ask.
- Slash commands and interactions post to `/slack/commands` and
  `/slack/interactions`; both check the Slack signature.

## Adding a recipe

A handwritten `recipes/<client_tag>/<lane>.json` is an override. The default
(D38) is: infer titles from the leads already in the campaign, infer the
find-method from `topup.pull_receipts` tags, backfill missing headcount
bands, and run that. File recipes are validated on boot and mirrored to
`topup.lane_recipes`.
