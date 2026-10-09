# Top Up rebuild: a dumb pipeline and a canon for Grok bot

Audit and plan, 2026-10-09. Written for Josh. Decided the same day; the
decisions are at the end. Phase 0 and the data fixes are done; the rest is
not built yet.

## 1. What you asked for

- The purpose of the app is to find campaigns that are performing well and
  top them up with more leads like the ones already in them.
- Grok bot is the reasoning layer. It reads the Supabase tags and notes,
  works out how the leads were pulled the first time (company, domain,
  person and email sources, how the TAM was sized, Maps or getleads or
  another method), and runs the same pull again.
- A top-up is only worth doing when the pool has at least 1,000 more people
  to add. Under that, the TAM is exhausted.
- The app is dumb. No recipes, no formulas, no per-client logic, no
  reasoning. It is a flat pipeline plus a canon so Grok can pull, process
  and upload leads the way you did by hand, without a lead row ever
  entering its context.
- A few rules stay in code: the reply bar of one positive reply per 2,000
  sends, the 1,000 rule, approved spend only, the loads switch, never a
  row in chat, never touch Smartlead's state.

## 2. Audit: what the app is today

### Size and where the reasoning sits

| Area | Lines | What it is | Verdict |
|---|---|---|---|
| recipes | 2,761 | file recipes, inferred lane recipes, routing cells, per-client shaping (Parlay, BCP, MSP owners, Peterson lane overrides), registry merges | reasoning in code; delete |
| plan | 1,228 | pools, partition check, band decisions, pilot gate, TAM agreement, suspect filters, caches, briefing | reasoning in code; delete, keep the count and sample calls as plain verbs |
| policy | 352 | 17 gates: reply bar, net new, excluded, paused, dropped, retired, foreign client, not sized, pilot mismatch, suspect filter, TAM source missing, TAM mismatch, TAM filled | keep the canon rules only; delete the rest |
| watch | 384 | auto-starts runs from runway and health | delete; the app does not decide when |
| slack | 888 | cards, roles, console, taps | delete or reduce to a notifier |
| orchestrator | 710 | chains the thirteen steps, re-resolves recipes, cards, approvals | replace with "run this verb on this job" |
| mcp | 1,218 | 16 tools, queue, overview, size_client, briefing | replace with the canon reads and the verbs |
| stages | 6,331 | pull, ingest, suppress, puzzle, find_emails, verify, normalize, qa, route, stage, import, post_import, flip | keep; this is the dumb pipeline |
| clients | 1,551 | getleads, AI Ark, Maps, PermitStack, LeadPipe, verifier, waterfalls, Smartlead allow list | keep |
| spend, ledger, db | 2,589 | SpendRails, caps, receipts, lead-table locks, runs and steps | keep |
| guards and ledger | 26 guards, 49 decisions | lock all of the above in place | collapse to one short canon; archive the history |

Totals: about 20,400 lines of source and 7,600 of tests. Roughly 12,000
lines exist to decide things; roughly 8,000 move rows and spend money.

### How the reasoning shows up for Cayden

- A campaign is refused with a gate name: not sized, pilot mismatch, TAM
  mismatch, suspect filter, no company filter, TAM source missing. Each is
  the app judging instead of Grok.
- A start resolves a "recipe" for a lane, infers it from receipts, shapes
  it per client, and refuses a campaign the recipe does not name. Client
  names appear in 20 source files for Parlay, 7 for BCP, 6 for Insight, 6
  for PowerGryd, 5 for Emcor, 5 for Peterson.
- The watch opens runs on its own, so Grok and the app compete for the same
  lane.
- Spend and QA decisions go to Slack cards with operator and owner roles,
  a second console beside Grok.
- The MCP surface has 16 tools, several of which run the app's own
  reasoning (size_client, approval_briefing, topup_queue, client_overview).

Yesterday's rewrite made the service better at reasoning. That is the
wrong direction for what you want now. Its useful parts are the vendor
clients, the spend gate, the stage code and the build-record reader.

### Supabase: is the canon already there

Active campaigns per client, excluding canary shells:

| Client | Active | With a receipt | With a method note | With a build row | With filters |
|---|---|---|---|---|---|
| bcp | 17 | 17 | 17 | 17 | 17 |
| emcor | 21 | 20 | 20 | 20 | 16 |
| insight | 9 | 9 | 9 | 9 | 9 |
| parlay | 11 | 10 | 10 | 10 | 10 |
| peterson | 5 | 5 | 5 | 5 | 5 |
| peterson_earthworks | 1 | 1 | 1 | 1 | 1 |
| powergryd | 9 | 9 | 9 | 9 | 9 |
| salesglider | 11 | 9 | 9 | 11 | 6 |
| techevo | 6 | 6 | 6 | 6 | 6 |
| Deep Roots Capital (not in client_map) | 3 | 0 | 0 | 0 | 0 |
| unnamed client (not in client_map) | 1 | 1 | 1 | 0 | 0 |

Verdict: the canon mostly exists. Receipts carry the four source legs, the
filters, the method note and the yield funnel for 86 of 90 mapped active
campaigns. `lead_provenance` stamps every lead row with the same tags and
most are traced. Source vocabulary already covers getleads, AI Ark, Maps,
PermitStack, Maps plus permits, SERP tool mentions, TheirStack tech
signals, LinkedIn engagers and imports, web-visitor pixel, job-posting
signals and hand tables; email legs cover getleads, the email waterfall,
name-to-email, site scrape and "already had it".

Gaps to fix in data, not code:

- Deep Roots Capital was not in `topup.client_map` and has no receipts.
  Mapped on 2026-10-09 as `deep_roots`; the receipts are still to write.
- One active campaign sits on a Smartlead client the mirror does not name.
- Two SalesGlider and one Emcor campaign have no receipt.
- Eleven campaigns have a receipt with empty filters (five SalesGlider,
  four Emcor, one Parlay, one unnamed).
- `topup.campaign_method` has two rows; it is not the record and should be
  dropped or folded into receipts.
- Fourteen registry rows (twelve Peterson, two Insight) carried no
  Smartlead client because the mirror has none for those campaigns. Mapped
  on 2026-10-09 to the Peterson and Insight client ids.
- Migrations 0015 and 0016 are unapplied and the service logs three
  permission errors at every boot trying to apply them itself.

## 3. Target design

Three parts. The app owns the first two and enforces the third.

### A. The canon (reads)

Every read returns what Supabase holds, unopinionated, as counts, ids,
labels and the written notes. No gate, no verdict, no recipe.

- `campaigns(client_tag?)`: every ACTIVE campaign with lifetime sends,
  positive replies, the rate per 2,000, leads total, untouched, last send,
  and a flag for the reply bar. Grok picks.
- `campaign_record(campaign_id)`: every receipt that fed it (source legs,
  filters as stored, build label, method note, yield by step, segment,
  dates), the provenance counts by source leg and confidence, the client's
  Smartlead id and the never-top-up flag. Raw. Grok infers where most of
  the leads came from.
- `sources()`: the source vocabulary with one line each: what the value
  means, which verb or which outside MCP repeats it, what it costs.
- `count(source, filters)`: a count on getleads, AI Ark, Maps or PermitStack
  with the filters Grok supplies. Returns the number and the cost. Grok
  applies the 1,000 rule.
- `held(client_tag, source, filters, sample)`: how much of a sample is
  already in the client's tables, so Grok can estimate net new.
- `jobs(client_tag?)`, `job(job_id)`, `spend()`, `loads_paused()`.

### B. The pipeline (verbs)

Each stage that exists today becomes one verb on a job. Grok calls them in
the order the canon says. Every verb returns counts and a job id. Rows move
vendor to LeadPipe to Supabase to Smartlead on the server.

- `pull(client_tag, campaign_id, source, filters, max_rows, approved_by?)`:
  without `approved_by` it returns the estimate and does nothing; with it,
  it starts the export and records who approved.
- `suppress(job_id)`, `find_emails(job_id, max_tier)`, `verify(job_id)`,
  `normalize(job_id)`, `qa(job_id)`: the existing stage code, one call each.
- `stage(job_id, campaign_id)`, `import(job_id, campaign_id)`: import runs
  only when the loads switch is off and the campaign is on the same
  Smartlead client.
- `write_receipt(job_id, tags, notes)`: Grok writes what it did, in the
  same shape as the first pull, so the next top-up can read it.
- `abort(job_id)`.

### C. The rules (code enforces, nothing else does)

1. The reply bar: one positive reply per 2,000 sends.
2. The TAM: the total leads available for the campaign's query, minus what
   the client already holds, must be at least 1,000 more; otherwise the
   answer is "the TAM for this campaign is exhausted". The count and held
   verbs report, Grok says it, the canon states the rule.
3. The never-top-up list and the dropped and paused campaigns.
4. Spend: every paid call is approved by a named person through Grok before
   it runs. A verb that spends returns its estimate first and runs only with
   `approved_by`. The ledger records the amount and who approved. There is
   no automatic dollar cap.
5. The loads switch; nothing reaches Smartlead while it is on.
6. Same Smartlead client only; Smartlead is never started, paused, stopped
   or deleted from here.
7. No tool returns a lead row or a file URL; samples stay on LeadPipe.
8. No secrets in the repo.

Everything else is Grok's judgement, written in the canon as guidance, not
enforced.

### D. The canon document

One file, `CANON.md`, served to Grok as the MCP's instructions and kept as
the Grok skill. It holds: the rules above; the order of reads and verbs; the
source vocabulary and which tool repeats each source; how to read a
receipt and a method note; what to do when a tag or a note is missing
(ask Josh, never guess); cost expectations per vendor; the context rules
(one record per campaign, no re-reads, no SQL for what the tools answer,
no lead columns ever). The existing lead skills stay as its appendix.

### How Grok will use it

1. `campaigns("bcp")`. Pick the campaigns over the bar that are low or
   empty.
2. `campaign_record(id)`. Read the receipts and the notes. Decide the
   source and the filters: "most leads came from getleads on these titles
   and industries; emails from getleads; domains were already there".
3. `count(source, filters)` and `held(...)`. If fewer than 1,000 more are
   available, say "the TAM for this campaign is exhausted" and stop, or
   propose a widening to you.
4. `pull(...)` for the estimate; Cayden or you approve; `pull` again with
   `approved_by`; then `suppress`, `find_emails`, `verify`, `normalize`,
   `qa`, each returning counts. Post the counts.
5. `stage` and, once you approve and the switch is off, `import`.
6. `write_receipt` with the tags and a note in plain English.

## 4. Migration plan

| Phase | What | Effort |
|---|---|---|
| 0 | Stop the app deciding: the watch no longer starts runs; every paid call needs an approval; loads stay paused | done 2026-10-09 |
| 1 | Ship the canon reads on the existing service, reusing the clients and the spend gate; write the new `CANON.md`; Cayden and Grok start using them | done 2026-10-09 (D52) |
| 2 | Turn the stages into verbs on jobs; remove the orchestrator's automatic chaining; receipts written by `write_receipt` | done 2026-10-09 (D52) |
| 3 | Delete recipes, plan, the derived policy gates, the watch, the Slack console and cards, the dollar caps, and the guards that lock them; one short CANON; DECISIONS stays as the ledger; version 1.0 | done 2026-10-09 (D53) |
| 4 | Data: write the four missing receipts and the eleven missing filter sets with you, drop or fold `campaign_method`, apply or drop migrations 0015 and 0016 (Deep Roots and the fourteen registry rows were mapped on 2026-10-09) | in parallel, needs you for the notes |
| 5 | Pilot one client end to end with Cayden with loads paused; then lift the pause | 1 day |

About two weeks of agent work. Phases 1 and 2 can go out behind the current
surface so nothing breaks while Cayden tries the new reads.

## 5. Risks and what stays regardless

- Spend stays gated on the server: no paid verb runs without a named
  approver, and the ledger keeps every dollar.
- Rows never enter chat; every verb returns counts; LeadPipe keeps the
  files and `lp_sample` stays at ten masked rows.
- Parlay, BCP and Peterson special cases become notes in their receipts
  that Grok reads, not code paths.
- The thirteen-step skill stays as the description of the manual process;
  the verbs mirror it one to one.
- A wrong pull is still only a job: abort, and nothing has reached
  Smartlead while the switch is on.

## 6. Decisions taken, 2026-10-09

1. The guidance document is the canon.
2. One positive reply per 2,000 sends.
3. The TAM is the total leads available for the campaign; under 1,000 more,
   the answer is "the TAM for this campaign is exhausted".
4. Nothing starts on its own. Grok starts everything. The watch now only
   observes and logs what it would have started.
5. Slack cards and roles are dropped.
6. No dollar caps. Every paid call is approved by a named person through
   Grok before it runs, and the ledger records who.
7. Deep Roots Capital is a client: mapped as `deep_roots`.
8. The fourteen Peterson and Insight registry rows are mapped to their
   client ids, not retired.
