# leadtopup

The lead top-up service for SalesGlider clients. A dumb, flat pipeline on
Railway with an MCP on top. **Grok bot does the reasoning**; this service
counts, moves rows and writes receipts. Read `CANON.md` first: it is the
one page of rules, reads and verbs. `AGENTS.md` says how to work in the
repo. `DECISIONS.md` is the ledger of why.

## What it does

* Serves the **reads**: what Supabase and the vendors hold about every
  campaign and how it was pulled, as counts, ids, labels and notes.
* Runs the **verbs**: one stage of the pipeline on a job, once, when Grok
  calls it. pull → suppress → enrich → verify → normalize → qa → stage →
  import → write_receipt.
* Gates **spend**: every paid call posts a card with the worst case and
  waits for a person's name. The auto cap is $0.

## What it refuses to do

* Start anything on its own. There is no watch, no cron, no planner.
* Decide what to pull. No recipes, no inference, no policy gates.
* Spend without a named approval. Import while loads are paused.
* Return a lead row or a file URL from any tool.
* Set a Smartlead campaign ACTIVE, or pause, stop, edit or delete one.
* Touch a campaign marked as cold call. It is not listed, read or pulled (D54).
* Drop a phone. Every table it writes carries one; the stage passes it to Smartlead (D56).

## Running it

```
cp .env.example .env     # names only; values live in Railway
npm install
npm run typecheck && npm test
npm run dev              # tsx src/index.ts
```

Railway deploys `main`. `/health` reports the commit, the database, the
spend and the open cards. `/mcp` is the Streamable HTTP MCP (no login,
D41; an owner token elevates). `CANON.md` is served as the MCP
instructions and by the `canon` read.

## The MCP surface

Reads (counts, ids, labels, notes; the rule stated; no verdict):

| Tool | Answers |
|---|---|
| `canon` | The canon page. |
| `campaigns` | Every ACTIVE campaign with sends, positives, rate per 2,000, leads left, `passes_reply_bar`. |
| `campaign_record` | Every receipt, build row, lead stamp count, registry row and note for one campaign. |
| `sources` | The source vocabulary. |
| `count` | A count on getleads (free), AI Ark (paid, needs a name), Maps or permits with the filters you pass. |
| `held` | How much of a getleads pool the client already holds, and net new. |
| `jobs`, `job` | The job log and one job with its steps, report, vendor calls and waiting cards. |
| `spend` | Today, thirty days, month to date, cards waiting. |
| `leftovers` | Where past pulls left rows that may never have been sent, per client, as counts, with the gap each store still has (domain, person, email, phone) and the step that fills it. |
| `holds` | Open cards. |
| `loads_paused` | The global switch. |

Verbs (one stage each, counts back):

| Tool | Runs |
|---|---|
| `pull` | Opens a job and pulls 1 to 2,000 rows from getleads, Maps, permits or a table; ingests them. |
| `suppress` | The suppression set. Returns raw, dropped by reason, net new. |
| `enrich` | Domains, people, emails through the waterfalls. Paid tiers estimate first. |
| `verify` | MillionVerifier then No2Bounce. Paid; estimate first. |
| `normalize` | Names, companies, locations, sports team. |
| `qa` | Merge-field QA; holds go to `holds`. |
| `stage` | Route and stage. |
| `import` | LeadPipe into Smartlead. Refuses while loads are paused. |
| `write_receipt` | The receipt the next top-up reads. |
| `abort` | Stop a job and release its rows. |
| `resolve` | Resolve a card by id (QA choices, resume, abort; spend needs the owner token or `approved_by` on the verb). |
| `note` | One line in a lane's event log. |

Everything older (`topup_queue`, `client_overview`, `size_client`,
`start_topup`, `run_status`, `list_holds`, `resolve_hold`, `lane_state`,
…) is retired; `GET /mcp` lists the names.

## How to watch it

* `jobs` and `job(job_id)` from any MCP client.
* `holds` and `spend` for what is waiting on a person.
* `/health` for the deploy, the database and the open cards.
* `topup.lane_events` in Supabase is the event log; `note` writes to it.

## Layout

```
CANON.md            the canon (served to Grok)
DECISIONS.md        the ledger of why (append only)
src/canon/          the reads
src/jobs/           the verbs, the job recipe, the filter mapping
src/stages/         pull ingest suppress puzzle find_emails verify normalize qa route stage import post_import
src/console/        cards and the role table (D18)
src/spend/          SpendRails: the gate, prices, the ledger
src/mcp/            the surface (server.ts, grok.ts)
src/db/             pool and repo
src/ledger/         lane events and campaign health
src/clients/        vendor clients (getleads, AI Ark, Maps, permits, LeadPipe, Smartlead, waterfalls, verifier)
src/guards/         tests that name a decision
skills/             the business's skills; grok-bot-babysitter is Grok's standing orders
supabase/           migrations
```

## Adding a rule

A new rule is a new decision. Append `## Dn — title` to `DECISIONS.md`,
add its row to the status index, fold it into `CANON.md`, and write a
guard in `src/guards/` whose failure message names the decision and who
to ask. `npm test` fails otherwise.
