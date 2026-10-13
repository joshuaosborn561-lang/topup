# leadtopup

The lead top-up service for Lead Top Up on Railway: a Streamable HTTP MCP at
`https://leadtopup-production.up.railway.app/mcp` (no login) with twelve
tools, on top of a flat pipeline that moves rows **MCP → Supabase → LeadPipe
→ Smartlead**. `CANON.md` is the one page that says what is true; read it
first. `DECISIONS.md` is the ledger of why.

## What it does

When a lane runs low, Grokbot reads the client's living playbook
(`playbook`) and how that lane's list was built (`build_record`: the
saved transcript's tool calls in order, what the person asked, and the
process changes since), replays the lane's search once with its own
connectors, and hands the pool to this service as a signed file URL or a
table on campaignintelligence; the service runs it through LeadPipe. The
service:

1. ingests the pool into `lp.<tag>_ingested_leads` (`ingest`), keeping the
   people the export names without an email (D103),
2. removes everyone the client already has anywhere (`dedupe`, D98),
3. removes real unsubscribes and the DNC list (`suppress`, D81),
4. posts one card: new-lead count and worst-case cost (`topup` → quoted),
5. after the approver says yes by name (`TOPUP_APPROVERS` in Railway): the website ICP check (D60),
   the email finder for the people with no email (D103), verification, normalization, QA, routing, staging, the Smartlead import
   and the post-import check (split across the lane's refillable campaigns
   the recorded build already named; STOPPED is never refilled), then
   writes its own top-up into `topup.list_build_records`.

Loads paused: it stops at staged; `load(job_id)` finishes later. Josh flips
ACTIVE by hand.

## What it refuses to do

* Read a lead row into chat, or return one from any tool.
* Spend a cent before a named approver says yes. The auto cap is $0. A step priced more than a tenth above the quote asks again.
* Start on its own. No watch, no cron, no planner.
* Top up a campaign with no recorded build, a cold-call campaign, or SG Nurture.
* Start, pause, stop, delete, create or edit a campaign in Smartlead.
* Pull, count, size, enrich or widen. Grokbot does the building.

## Running it

```
npm install
cp .env.example .env     # Railway holds the real values
npm run typecheck && npm test
npm run dev
```

`/health` reports readiness, spend, open cards and open jobs. Boot refuses
any Supabase project other than campaignintelligence (D6).

## The MCP surface

| Tool | What it does |
| --- | --- |
| `canon` | The one page. Also the server instructions. |
| `connectors(have)` | First call of every session: which required connectors are missing and how to attach them in Grokbot. |
| `campaigns(client_tag?)` | Campaigns plus a lane rollup: runway is the sum across refillable campaigns (STOPPED excluded). |
| `playbook(client_tag)` | The living how-we-build for this client: list builds, disqualifications and method changes in order, plus transcript object names. |
| `build_record(client_tag, campaign_id, from?, limit?)` | The build record, the method off the transcript (paged), and the process changes since. |
| `topup(client_tag, lane\|campaign_id, source)` | Quote the whole lane as one pull (`campaign_id` points at its lane). `topup(job_id, approved_by)` runs the approved tail, splits, and loads. |
| `load(job_id)` | Import a staged job once loads resume. |
| `job(job_id)` / `jobs()` | Steps with counts, cards waiting, the last events. |
| `spend()` | Spend today, by vendor, month to date, cards waiting for a name. |
| `abort(job_id)` | Stop a job; nothing is loaded. |
| `loads_paused(paused?, by?)` | The global switch. |

## How to watch it

`jobs()` then `job(job_id)`: every step's counts, the quote or spend card
waiting for a name, the last ten events. The logger redacts lead fields.
Nothing is posted to Slack.

## Layout

```
CANON.md                  the one page; served as the MCP instructions
DECISIONS.md              the append-only ledger (D1 … D105)
src/mcp/                  the twelve tools (grok.ts) and the HTTP server
src/jobs/runner.ts        the top-up: quote → approve → load
src/jobs/settings.ts      a job's settings (pool source, campaign); no recipes
src/canon/                build record + method extraction, connectors, campaigns, held keys
src/stages/               ingest, dedupe, suppress, icp, find_emails, verify, normalize, qa, route, stage, import, post_import
src/clients/              LeadPipe, the email finder (D103), the verifier, Smartlead, the ICP gate. Nothing else.
src/spend/                SpendRails: every paid call passes the gate; $0 auto cap
src/guards/               tests that fail the build when a decision is broken
supabase/migrations/      the topup schema on campaignintelligence
skills/grok-bot-babysitter  standing orders for Grokbot
```

## Adding a rule

A new rule is a new decision: append `## Dn — title` to `DECISIONS.md`,
add its status row, fold it into `CANON.md`, write a guard in `src/guards/`
whose failure message names the decision and who to ask. The meta guard
fails the build otherwise.
