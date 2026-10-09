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
- Spend rails: auto cap $0 on the service (D51), $25 per day backstop, worst
  case from the price table, ledger row per call, a spend card for every paid
  call that `resolve_hold` answers.
- Slack: one thread per run, cards with buttons, slash commands, owner and
  operator roles.
- `/mcp` — Streamable HTTP over HTTPS at
  `https://leadtopup-production.up.railway.app/mcp` with owner and
  operator bearer tokens (D40).
- Josh's **skills** at `skills/` — the specification. `lead-list-build` is
  the spine; `SKILLS_INDEX.md` names the stale parts (the index wins).
- The **spine**: the thirteen steps of `skills/lead-list-build/SKILL.md` as
  the state machine (`src/spine/steps.ts`, titles/owners/gates copied from the
  skill and guarded), with gates that halt a run, record why and post one
  card. Every step from 2 to 12 has its gate wired (CANON, "The spine").
- The **lane ledger**: step per lane, event log, queue registry. `/where
  <client> [lane]`, the `lane_state` MCP tool, and a daily ops digest that
  only names lanes whose state changed or whose campaign health crossed a
  line. Claude sessions leave notes with `lane_note`.
- **Steps 1 → 13 end to end for a getleads lane** (Parlay `it_dm`): step 1
  reuses the saved ICP, then size,
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
`GETLEADS_MCP_URL`, `GETLEADS_TOKEN`, `SMARTLEAD_MCP_URL`, `SMARTLEAD_TOKEN`
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
  stages/trigger/     step 1: reuse the saved ICP; halt if a cell has no campaign
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

## MCP (HTTPS on Railway)

Streamable HTTP at **`https://leadtopup-production.up.railway.app/mcp`**.
No login (D41). POST JSON-RPC; no `Authorization` header. CORS is open
so Cursor can add the URL. GET is 405 (stateless). `/mcp` is always
mounted once the database is up. Operator and owner see the same tools;
owner-only choices are enforced on the card. No tool returns a lead row
or a file URL (D48).

Cursor / Claude:

```json
{
  "mcpServers": {
    "leadtopup": {
      "url": "https://leadtopup-production.up.railway.app/mcp"
    }
  }
}
```

The operator flow (D46–D49): `client_overview` for the client (or
`topup_queue` across clients) → `campaign_history` for each campaign you
will top up → `size_client` → read the report → `approval_briefing` to
Josh → `start_topup` once approved and `loads_paused` is off.

The reads and the verbs for Grok bot (D52). Reads return what Supabase and
the vendors hold, the rule stated, no verdict. Verbs run one stage on a
job and return counts.

| Tool | What |
|---|---|
| `campaigns` | Every ACTIVE campaign with lifetime sends, positives, the rate per 2,000, leads left, lane and `passes_reply_bar`. |
| `campaign_record` | Every receipt (four source legs, `company_filters` as stored, method note, yield, dates), the build rows, stamped leads by label and by leg, the registry row, the vocabulary for the values seen, the notes. |
| `sources` | The source vocabulary: what each value means, how to repeat it, what it costs. |
| `count` | A count on getleads (free), AI Ark (cents; `approved_by`), the stored Maps pool or PermitStack with the filters you give. |
| `held` | How much of a getleads pool the client already holds, scaled to the count; `net_new`. |
| `jobs`, `job`, `spend` | The job log, one job with its steps and vendor calls, spend and the cards waiting for a name. |
| `pull` | Open a job for one campaign and run the pull; the estimate first, `approved_by` runs it. |
| `suppress`, `enrich`, `verify`, `normalize`, `qa`, `stage`, `import` | One stage each on a job; `enrich` and `verify` estimate first; `import` refuses while loads are paused. |
| `write_receipt` | The receipt for a job: legs, filters, counts and a plain-English note. |
| `abort` | Abort any open job or run. |

The older tools, still answering until the rebuild removes them:

| Tool | What |
|---|---|
| `topup_queue` | Campaigns `#campaign-watchdog` would flag as needing leads (empty, low, nearly-done 90%), ranked empty-first then shortest runway, each with the recipe count summary, `sends_last_14d`, and the policy gate and reason already applied (excluded, ignored client, retired, paused, dropped, not active, foreign client, under the 1-in-2000 reply bar — 1 reply under 2,000 sends is acceptable, zero positives never qualifies — or ok). Page with `limit` / `offset` / `client_tag`. No Slack, no Cursor (D43–D46). Counts only. |
| `client_overview` | **Read first for a client.** Every campaign of one client in one call: status, lane, lead flag, runway, untouched, the policy gate and reason, the build the service would repeat and whether it can, and which campaignintelligence tags it carries (`missing_tags` names the gaps). Open runs, client-wide runway, the loads switch, and a `next` line naming the next tool. `include_inactive` lists the rest. Counts and short reasons only (D49). |
| `campaign_history` | **Read before any top up.** The build records for a campaign (vendor, exact query or stored pool, counts, interested, method note, reconstructed flag), lifetime sends and positives, the build the service would repeat and why, and the live pull recipe (`select topup.recipe($1, $2)`; `campaign not found in public.campaigns` when the mirror has no row), plus `tags`: the `campaign_method` legs, `missing_tags`, and `lead_provenance` counted by build label and confidence (D49). `client_tag` is the live list from `topup.client_map` (D42). Counts and method text, never lead rows. |
| `size_client` | Pilot and size one client in one call: a size-only run per lane, concurrently; waits up to `wait_seconds`; returns each lane's one-line-per-campaign report and briefing. `pilot=true` scores the sample only. Nothing is pulled or loaded. |
| `approval_briefing` | Josh's one line per campaign from the latest sized run of each lane, or one `run_id`: what loads, what is skipped and why, the build it repeats, whether loads are paused. |
| `start_topup` | Open a run. `client_tag` + `campaign_id` (optional `count`) or `lane`. File recipe wins; else infer from pull_receipts, and every ACTIVE campaign the registry puts on the lane joins it, each pulled from its own build record (D49). Every campaign is judged by the policy first. Every paid call waits for a named approval (D51); $5 or above is Josh. Nothing starts without this call or `size_client` (D51). |
| `run_status` | Counts, spend, step state, the per-campaign report with gates and reasons, every vendor call's outcome, open cards. Never rows. |
| `list_runs` | Recent runs. |
| `abort_run` | Abort any open run, parked or running. |
| `resume_run` | Give a waiting run's step its attempts back and drive it again. |
| `list_holds` | Open cards, each with the per-campaign report. |
| `resolve_hold` | Tap a card (same role rules as Slack; spend of $5 or above needs the owner token). |
| `loads_paused` | The global switch. While on, nothing reaches Smartlead. |
| `lane_state` | Where a lane is. Counts only. |
| `lane_note` | One line on the lane event log. |
| `add_client_domains` | Customer domains only, never rows. |

Retired by D48 and no longer answering: `sample_rows`, `variant_stats`,
`campaign_registry`, `recipe_get`, `missing_piece_groups`,
`register_queue_table`, `topup_recipe`, `topup_campaign_builds`,
`topup_provenance_gaps`. None of these tools is on LeadPipe. The
`topup.recipe()` function and the views already exist on
campaignintelligence; this service does not change schema.
`count_contacts` is count filters only — `max_per_company` is an export
cap (D43).

## Slack

- Every run posts to the client's channel (`SLACK_CLIENT_CHANNELS`) as one
  thread; ops-wide alerts go to `SLACK_OPS_CHANNEL`.
- Cards wait in the database, so a redeploy does not lose an open ask.
- Slash commands and interactions post to `/slack/commands` and
  `/slack/interactions`; both check the Slack signature.

## Adding a recipe

A file at `recipes/<client_tag>/<lane>.json` is the **override**. Without
one, `start_topup` infers the pull from `topup.pull_receipts` tags and
notes (D45). File recipes match `src/recipes/schema.ts`, are validated
on boot, and are mirrored to `topup.lane_recipes`.
