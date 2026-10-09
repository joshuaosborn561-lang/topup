# Top Up rebuild: a dumb pipeline and a Bible for Grok bot

Audit and plan, 2026-10-09. Written for Josh, to decide. Nothing in this
document has been built.

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
  reasoning. It is a flat pipeline plus a Bible so Grok can pull, process
  and upload leads the way you did by hand, without a lead row ever
  entering its context.
- A few canon rules stay in code: the reply bar, the 1,000 rule, spend caps,
  the loads switch, never a row in chat, never touch Smartlead's state.

One number to confirm: today you said one positive reply per 1,000 sends;
the Oct 8 brief said one per 2,000. The plan uses a single constant either
way. Say which.

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
| mcp | 1,218 | 16 tools, queue, overview, size_client, briefing | replace with the Bible reads and the verbs |
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

### Supabase: is the Bible already there

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

Verdict: the Bible mostly exists. Receipts carry the four source legs, the
filters, the method note and the yield funnel for 86 of 90 mapped active
campaigns. `lead_provenance` stamps every lead row with the same tags and
most are traced. Source vocabulary already covers getleads, AI Ark, Maps,
PermitStack, Maps plus permits, SERP tool mentions, TheirStack tech
signals, LinkedIn engagers and imports, web-visitor pixel, job-posting
signals and hand tables; email legs cover getleads, the email waterfall,
name-to-email, site scrape and "already had it".

Gaps to fix in data, not code:

- Deep Roots Capital is not in `topup.client_map` and has no receipts.
- One active campaign sits on a Smartlead client with no name or map row.
- Two SalesGlider and one Emcor campaign have no receipt.
- Eleven campaigns have a receipt with empty filters (five SalesGlider,
  four Emcor, one Parlay, one unnamed).
- `topup.campaign_method` has two rows; it is not the record and should be
  dropped or folded into receipts.
- Fourteen registry rows (twelve Peterson, two Insight) belong to a client
  not in the map; retire or map them.
- Migrations 0015 and 0016 are unapplied and the service logs three
  permission errors at every boot trying to apply them itself.

## 3. Target design

Three parts. The app owns the first two and enforces the third.

### A. The Bible (reads)

Every read returns what Supabase holds, unopinionated, as counts, ids,
labels and the written notes. No gate, no verdict, no recipe.

- `campaigns(client_tag?)`: every ACTIVE campaign with lifetime sends,
  positive replies, the rate per 1,000, leads total, untouched, last send,
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
the order the Bible says. Every verb returns counts and a job id. Rows move
vendor to LeadPipe to Supabase to Smartlead on the server.

- `pull(client_tag, campaign_id, source, filters, max_rows)`: start the
  export. Spend goes through the gate; over the operator cap it stops and
  says so, Grok asks you in chat.
- `suppress(job_id)`, `find_emails(job_id, max_tier)`, `verify(job_id)`,
  `normalize(job_id)`, `qa(job_id)`: the existing stage code, one call each.
- `stage(job_id, campaign_id)`, `import(job_id, campaign_id)`: import runs
  only when the loads switch is off and the campaign is on the same
  Smartlead client.
- `write_receipt(job_id, tags, notes)`: Grok writes what it did, in the
  same shape as the first pull, so the next top-up can read it.
- `abort(job_id)`.

### C. The canon (code enforces, nothing else does)

1. The reply bar, one positive per 1,000 or per 2,000 sends, your call.
2. At least 1,000 net new or the TAM is exhausted; the count verb reports,
   Grok decides, the Bible states the rule.
3. The never-top-up list and the dropped and paused campaigns.
4. Spend: operator cap and daily cap through SpendRails; over the cap the
   verb stops and names the amount.
5. The loads switch; nothing reaches Smartlead while it is on.
6. Same Smartlead client only; Smartlead is never started, paused, stopped
   or deleted from here.
7. No tool returns a lead row or a file URL; samples stay on LeadPipe.
8. No secrets in the repo.

Everything else is Grok's judgement, written in the Bible as guidance, not
enforced.

### D. The Bible document

One file, `BIBLE.md`, served to Grok as the MCP's instructions and kept as
the Grok skill. It holds: the canon; the order of reads and verbs; the
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
3. `count(source, filters)` and `held(...)`. If net new is under 1,000, say
   the TAM is exhausted and stop, or propose a widening to you.
4. `pull(...)`, then `suppress`, `find_emails`, `verify`, `normalize`,
   `qa`, each returning counts. Post the counts to you.
5. `stage` and, once you approve and the switch is off, `import`.
6. `write_receipt` with the tags and a note in plain English.

## 4. Migration plan

| Phase | What | Effort |
|---|---|---|
| 0 | Stop the app deciding: disable the watch auto-start; loads stay paused | half a day |
| 1 | Ship the Bible reads on the existing service, reusing the clients and the spend gate; write `BIBLE.md`; Cayden and Grok start using them | 2 to 3 days |
| 2 | Turn the stages into verbs on jobs; remove the orchestrator's automatic chaining; receipts written by `write_receipt` | 3 to 5 days |
| 3 | Delete recipes, plan, the derived policy gates, watch decisions, the Slack console and cards, and the guards that lock them; one short CANON; archive DECISIONS as history; version 1.0 | 2 to 3 days |
| 4 | Data: map Deep Roots and the unnamed client, write the four missing receipts and the eleven missing filter sets with you, retire the fourteen stale registry rows, drop or fold `campaign_method`, apply or drop migrations 0015 and 0016 | in parallel, needs you for the notes |
| 5 | Pilot one client end to end with Cayden with loads paused; then lift the pause | 1 day |

About two weeks of agent work. Phases 1 and 2 can go out behind the current
surface so nothing breaks while Cayden tries the new reads.

## 5. Risks and what stays regardless

- Spend stays gated on the server; Grok cannot pull without the gate.
- Rows never enter chat; every verb returns counts; LeadPipe keeps the
  files and `lp_sample` stays at ten masked rows.
- Parlay, BCP and Peterson special cases become notes in their receipts
  that Grok reads, not code paths.
- The thirteen-step skill stays as the description of the manual process;
  the verbs mirror it one to one.
- A wrong pull is still only a job: abort, and nothing has reached
  Smartlead while the switch is on.

## 6. Questions for you

1. One positive per 1,000 sends, or per 2,000?
2. Should anything ever start on its own, or only Grok? The plan says only
   Grok; `campaigns` shows what is low.
3. Slack: drop the cards and roles entirely, or keep a one-line notifier?
4. Keep the spend caps at $5 operator and $25 per day?
5. Is Deep Roots Capital a client to map, or to ignore?
6. Do you want the fourteen stale Peterson and Insight registry rows
   retired, or mapped to their real client?
