# Decisions

Append-only log of the repo owner's standing calls (Josh). Seeded from the
brief ("Lead top up service: the brief", sections 8, 9 and 11) and the design
doc (v2). Where the two disagree the brief wins; both win over anything
inferred from code.

**Superseding means adding a new entry, never editing or deleting an old one.**
Each entry states the decision, why (including what went wrong before), the
tradeoff accepted, and the guard test that holds it if one exists. When a
guard fails, its message names the decision and who to ask.

## Status index

Maintained with every new entry (the meta guard checks the newest decision is
listed). **Do not derive behaviour from this file** — `CANON.md` is the only
statement of current rules; this ledger is the historical record of why.
Statuses: **live** (in canon), **superseded** (by the named entry),
**historical** (a one-shot that already ran).

| Decision | Status |
|---|---|
| D1 | Live |
| D2 | Live; Grok-bot context window tightened by D39 |
| D3 | Live |
| D4 | Live |
| D5 | Live |
| D6 | Live |
| D7 | Live |
| D8 | Live; Hunter added by D35 |
| D9 | Live; "$5 or above" wording by D45 |
| D10 | Live |
| D11 | Live; variant volume floor 300 superseded by D35 (1,000); 1-reply-under-2k confirmed by D44; measured per campaign on lifetime sends, zero positives never qualifies, by D46 |
| D12 | Live |
| D13 | Live; VALID-only superseded by D35 item 15 |
| D14 | Live |
| D15 | Live |
| D16 | Live |
| D17 | Superseded by D23 (phase order); the verify → normalize scope itself is still live |
| D18 | Live |
| D19 | Live |
| D20 | Live |
| D21 | Live |
| D22 | Live |
| D23 | Live |
| D24 | Live |
| D25 | Live |
| D26 | Live; pipeline order and find_emails-before-ingest superseded by D29 |
| D27 | Live; superseded for starting by D51 (the watch observes); per-campaign needy as the start signal superseded by D38; the not-working card removed by D46 |
| D28 | Live; pipeline list superseded by D29 |
| D29 | Live; recipe-level ICP superseded by D30; empty-list-proceeds superseded by D34; 90-day send window restored by D35 |
| D30 | Live |
| D31 | Live; per-lane-only receipts superseded by D32 |
| D32 | Live; `other` and trusted backfill TAM superseded by D33 |
| D33 | Live |
| D34 | Live; lifetime prior contact superseded by D35 item 2; empty-list halt superseded by D37; staging dedupe, mixed headcount, MX, health, QA regex stay |
| D35 | Live; live-campaign exclude pending and Name-to-Email-first superseded by D36; positives-forever and empty-list item 4 superseded by D37 |
| D36 | Live |
| D37 | Live |
| D38 | Live; n/a-as-healthy and inbox-only days superseded by D45; superseded for starting by D51 (the watch observes) |
| D39 | Live; allow/ban + LeadPipe/csv-endpoint + no 13-step walk in Grok context; receipt inference is D45 |
| D40 | Live; live pull recipe MCP on this service, not LeadPipe; the three tools are folded into `campaign_history` by D48; watch Slack includes the count summary |
| D41 | Live; HTTPS MCP needs no login; unauthenticated callers get the operator set |
| D42 | Live; recipe-tool client_tag enum is topup.client_map at boot, not a hardcoded twelve |
| D43 | Live; topup_queue visibility widened by D44; its gate is the policy verdict by D46; count_contacts is count filters only |
| D44 | Live; topup_queue shows #campaign-watchdog lead flags; 1 reply under 2,000 sends is working |
| D45 | Live; client days from send rate; n/a fails; start_topup infers from receipts; item 7 (sample_rows) and item 9 (campaign_registry on the surface) superseded by D48; Cayden runs ops |
| D46 | Live; one policy layer, per-campaign parking, the Oct 8 rules |
| D47 | Live; build records are the memory |
| D48 | Live; the planner, the caches, the vendor-call log, lifecycle tools, the fifteen-tool surface, Slack optional; `client_overview` is the sixteenth tool by D49 |
| D49 | Live; starts read the registry and the build tags for every client; `client_overview` and the `tags` block for the babysitter; the step 2 gate is the 1,000 floor |
| D50 | Live; registry lane wins over the first recipe; a stored Maps pool is the TAM; a LinkedIn gap no longer parks |
| D51 | Live; nothing starts on its own, Grok bot starts; every paid call waits for a named approval (auto cap $0); "the TAM for this campaign is exhausted"; Deep Roots mapped; the fourteen Peterson and Insight registry rows mapped |
| D52 | Live; the reads and the verbs for Grok bot: reads state the rule and no verdict, verbs run one stage on a job, approvals by name through the console, no row or file URL |
| D53 | Live; the reasoning half is deleted (watch, planner, recipes inference, policy gates, Slack console, old MCP tools); one short canon; the surface is the canon tools only; version 1.0.0 |
| D54 | Live; a campaign marked as cold call is ignored everywhere (not listed, not read, not pulled); the mark is in the name; a job pulls at most 2,000 rows |
| D55 | Live; `leftovers` read: where past pulls left rows, per client, as counts (lane table, client schema, waterfall tables, people status, scratch estimates); moves nothing; each store shows its gap (domain, person, email, phone) and the step that fills it |
| D56 | Live; phones are kept: phone / phone_type / wf_phone / wf_phone_type on every lane table, phone on staging, waterfall phones copied, cellphone from the people contacts, ingest maps vendor phone headers, stage carries phone to Smartlead's phone_number; `leftovers` shows need_phone |
| D57 | Live; maps `count` and `pull` read `client_<tag>.maps_raw` scoped by `plan_id` and categories, plus the named ICP view (companion `v_*_companies` ∪ `v_*_needs_domain` when present); already used is live `public.leads` on the receipt's campaigns; never `pipeline_stats` by state/client_tag |
| D58 | Live; LeadMagic is dropped. Replay maps `email_max_tier=leadmagic` to `aiark` and a LeadMagic person source to the live Find Named Person order; old receipts are not rewritten |
| D59 | Live; maps ICP SQL types every bind (`$1::text`); companion views that omit `plan_id` join `maps_raw` so `$1` is used; scrape categories re-applied on the companion union by D68 |
| D60 | Live; the ICP website gate is a verb between suppress and enrich: our own site fetch, Jev picks a category, DiscoLike on unreadable sites; verdict written on the rows, flagged rows suppressed with a reason; label set per client in `topup.icp_variants`; keys in Railway |
| D61 | Live; maps pull insert into `lp.<tag>_ingested_leads` is idempotent on email (`already_held`); `pull` returns the job id and runs in the background; nothing opens as the watch |
| D62 | Live; a background maps pull always ends done or failed with `last_error`; the copy reads the named ICP view (not the companion join), times out, and dedupes with or without a unique email index |
| D63 | Reserved for PR #40 (`cursor/suppress-client-inbox-a879`). That PR writes the live D63 text. This stub keeps the ledger contiguous so D64 can ship off main |
| D64 | Live; job 46b1c941: enrich approval runs the paid people step; a step that did not run is not done; ICP labels are tokens; spend cards re-quote and record actuals; maps used/net-new includes ingested + contacted; lp_export reads the wrapped payload; verify retry uses the recorded approval and does not park; `size` is the free dry-run; maps pull skips held emails before max_rows |
| D65 | Live; job 46b1c941 after #42: size is async + aggregate SQL; approval is idempotent per step/approver/amount; QA hold count is this job; a false done with queued rows is reopened; Lane E role-inbox company from Maps name; first_name_fallback defaults off |
| D66 | Live; job 46b1c941 after #43: people/email waterfalls read an ingest `_ew` view that exposes `domain` from `company_domain`; a done step reopens when its `rules_hash` changed or `force=true`. Runtime CREATE VIEW in `lp` superseded by D67 |
| D67 | Live; job 46b1c941 after #44: no runtime DDL — people/email waterfalls read `topup.<tag>_ingested_leads_ew` from one-time migration 0021; normalize fills company from `maps_raw.name` joined on email; ingest coalesces company/name/title |
| D68 | Live; job 46b1c941 after #45: hold and fill share `company_n`; maps city is parsed from `City, ST`; lane E ICP re-applies `main_category` and drops preschool–high school (reverses D59's no-reapply) |
| D69 | Live; job 46b1c941 after #46: a step reopen replaces counts (stale held_company_n / company.missing cannot survive); size pool binds start at $11 so categories do not collide with $2::int[] |

---

## D1 — One Supabase project, and the service checks it before it does anything

**Decision.** State lives in the `topup` schema on `azpapwtnrbzywlnxxecz`
(campaignintelligence). The service refuses to boot against any other project
ref, and `npm run migrate` refuses any `DATABASE_URL` that does not name it.

**Why.** Three Supabase projects exist. `kemvxzhcxvynmoutwdrh` is
google-maps-scraper-leads. Mixing them has cost real hours before (brief
section 8: "Confirm which Supabase project you are writing to").

**Guard.** `src/guards/invariants.test.ts` — `ALLOWED_SUPABASE_PROJECT_REF`;
`assertSupabaseProject` throws on any other ref. Ask Josh before changing.

## D2 — No lead rows in chat, Slack, or logs beyond ten sample rows on a card

**Decision.** Counts and ids travel; rows do not. Slack cards show at most ten
sample values (company names or titles, never emails). The MCP `sample_rows`
tool caps at ten and masks the address. The logger redacts emails and lead
field keys and logs arrays of objects as row counts.

**Why.** Brief section 8, verbatim. Lead lists in a chat transcript are a
data leak and a debugging habit that never ends.

**Guard.** `src/guards/lead_rows.test.ts` (redaction; `SAMPLE_ROWS_MAX === 10`;
`qaHoldCard` slices to ten).

## D3 — Secrets live in Railway, never in the repo

**Decision.** Every key, token and URL with a credential is a Railway service
variable. `.env.example` lists names only. Nothing in `src/`, `recipes/` or
`supabase/` carries a real value.

**Guard.** `src/guards/no_secrets.test.ts` scans for key-shaped strings.

## D4 — Never call a vendor in a test; mock it and assert on the ledger

**Decision.** Tests drive the verifier, LeadPipe, Slack and vendors through
fakes (`MemoryPoster`, fake `Verifier`/`LeadPipe`). The thing a spend test
asserts on is the `topup.spend_ledger` row (or the pure `decide()` result),
not a vendor response.

**Why.** Tests that spend money are not tests. Brief section 8.

**Guard.** `src/guards/no_vendor_in_tests.test.ts` — no test file imports
`fetch`-backed clients directly or names a vendor host.

## D5 — One replica, pinned

**Decision.** `railway.toml` pins `numReplicas = 1`. The run locks are in
Postgres, but the poll loops and in-process card waits assume one process.

**Guard.** `src/guards/invariants.test.ts` reads `railway.toml`.

## D6 — Smartlead is read-mostly and never destructive

**Decision.** The service never starts, pauses or stops a campaign; never
deletes anything in Smartlead; never removes an API-added entry from the
block list. Only Josh flips a campaign active. Later stages may *add* leads
and *add* block-list entries; nothing more.

**Why.** Brief section 8. Campaign status changes and deletes are the two
Smartlead actions with no undo.

**Guard.** `src/guards/smartlead_never.test.ts` — source scan for the
status/delete endpoints and verbs.

## D7 — FullEnrich is off in every recipe until Josh turns it on per recipe

**Decision.** `email_finding.fullenrich: true` is invalid unless that recipe
carries `owner_approved_at`. `max_tier: fullenrich` requires both.

**Why.** FullEnrich is the expensive tail of the waterfall. It is a per-lane
call for Josh, not a default.

**Guard.** `src/recipes/schema.test.ts`.

## D8 — Banned vendors and actions

**Decision.** LeadMagic's job change detector is banned (it bills on every
call). PDL is banned everywhere, including through wrappers. BillionVerifier
and Clay are out of the stack. The spend gate blocks these before any math,
and the recipe schema rejects them.

**Guard.** `src/spend/rails.test.ts`, `src/recipes/schema.test.ts`,
`src/guards/invariants.test.ts` (`BANNED_VENDORS`, `BANNED_ACTIONS`).

## D9 — Spend rails: five rules and a daily backstop

**Decision** (design 3.5, brief section 8):

1. The service never has ideas. A paid call must name the recipe step that
   authorises it, or it is refused.
2. Worst case over `AUTO_SPEND_CAP_USD` (5) posts a card with the worst case
   in dollars and waits. A recipe may lower the cap, never raise it.
3. Worst case is computed here from the unit price table and the batch size,
   before submit. Never from a vendor's cost field.
4. Vendor balance is read before and after paid steps; a bill more than 10%
   over what was approved stops the run and pages ops.
5. Anything that may bill again (a split, a re-submit) is new spend under
   rule 2. A verifier resume is free and never gated.

`DAILY_VENDOR_CAP_USD` (25) across all vendors parks everything. One ledger
row per vendor call, including free ones and approvals.

**Tradeoff.** The price table is deliberately conservative (rounds up). It
over-asks rather than under-asks; Josh confirms the numbers.

**Guard.** `src/spend/rails.test.ts` (pure `decide`), `src/guards/invariants.test.ts`
(defaults are 5 and 25; paid vendors have non-zero prices).

## D10 — A verification verdict is a verdict, "processed" is not

**Decision.** Sendable means `mv_status = ok`, or `mv_status = catch_all` and
No2Bounce says deliverable. Everything else is not sendable. A completed
verifier run with zero MillionVerifier verdicts is a stall, never a REJECTED
list. Stall runbook: at or above 90% with no progress for 12 minutes, resume
once for free; no movement after that, split the remainder (a split can bill,
so it is an ask); repeat down to 50 rows; the residue is `stalled_unverified`
and is never sent. Rows the verifier never mentioned stay unverified.

**Why.** Insight bounced 23.8% because "passed" was trusted. A resume once
merged 2,301 rows into REJECTED for zero credits.

**Guard.** `src/stages/verify/runbook.test.ts`, `src/stages/verify/sendable.test.ts`,
`src/guards/invariants.test.ts` (`NEVER_SEND_STATUSES`).

## D11 — "Working" is one interested reply per 2,000 sends

**Decision.** A campaign is working when it has at least one interested reply
per 2,000 sends, counted from Smartlead lead categories 1, 2 and 131482 only
(never raw reply rate). Checked at campaign level and per variant; a variant
with fewer than 300 sends is too early to judge; if any variant with volume
clears the bar the campaign counts as working and the dead variant is named.
An owner override (`/working <id> on|off|auto`) wins.

**Guard.** `src/domain/working.test.ts`.

## D12 — One open run per lane and per campaign, enforced in the database

**Decision.** Partial unique indexes on `topup.runs` allow one open run per
`(client_tag, lane)` and one per `campaign_id`. Lead-table updates and deletes
must carry `app.run_id` matching an open run, or the trigger rejects them.
The TypeScript list of terminal statuses mirrors `topup.run_is_open()`.

**Why.** Two processes topping up the same lane is how a list gets imported
twice.

**Tradeoff.** INSERT on `lp.*_ingested_leads` is not yet locked, because
LeadPipe does not set `app.run_id`. Locking it is a LeadPipe change.

**Guard.** `src/guards/invariants.test.ts` (TS/SQL status lists agree).

## D13 — getleads filters: band labels, no commas, VALID only

**Decision.** Headcount goes to getleads as band labels ("51 to 200"), never
numeric bounds. Industry names containing commas are rejected (they shred the
filter). Only `email_status = VALID` counts.

**Guard.** `src/recipes/schema.test.ts` (`GETLEADS_BANDS`).

## D14 — Do not work around a broken vendor server

**Decision.** A vendor endpoint that is missing (no cancel) or wrong ($0
accounting) is not patched over here. Damage is bounded by batch size and
the gap is named in the PR description.

**Why.** Brief section 9. Workarounds hide the bug and move the cost.

## D15 — Brief over design doc; both over code; when unsure, ask in the PR

**Decision.** The brief wins over the design doc; both win over anything
inferred from existing code. Copy is Josh's and is shown in full before any
upload. Nothing is invented: a missing recipe, price or rule is an open
question in the PR, not a guess in the code.

## D16 — Normalize rules

**Decision** (design 3.3 F): never overwrite the raw city; `NO_GEOCODE`
becomes blank, not a guess; an ambiguous nickname yields a null team and the
AirPods gift tier; acronyms on the reference list stay upper-case even when
they contain vowels; pipes are stripped; company names are shortened at word
boundaries, never mid-word.

**Guard.** `src/stages/normalize/normalize.test.ts`.

## D17 — Phase 1 stops after normalize

**Decision.** This build runs `verify` then `normalize` and closes the run as
`done` with a receipt saying nothing was routed, staged or imported. Pull,
suppress, find_emails, qa, route, stage, import and the runway watch land in
their own PRs. `/suppress` explains this instead of pretending.

**Why.** Design section 7: "health endpoint first", small plain-English PRs.

**Guard.** `src/guards/invariants.test.ts` (`PHASE1_STEPS`).

## D18 — Any campaign, any source; the line is judgement

**Decision.** The service tops up any campaign from any source, not only
getleads lanes: a contact database query, a Google Maps scrape, a permit
feed, a parcel query, a public record, a signal feed, or a queue table a
Claude session filled by hand. The rule that decides who does a step:

> If a task does not require judgement, the service does it. If it requires
> judgement, the service brings it to me in Slack with everything I need to
> decide.

Three columns, stated once (addendum section 3):

- **Mechanical — the service does it and reports.** Runway and health watch;
  counting a segment; approved pulls; ingest; suppression and dedupe; the
  cascade steps of an approved segment within budget; verification and the
  stall runbook; normalization; QA rules; routing; staging; importing with
  the count assert; merge field checks; receipts; the ledger; the digest;
  retries that cannot bill; resumes; splitting under the spend rules;
  registering a cloned campaign; keeping the missing-piece groups current.
- **Judgement — Josh, on a card in Slack.** Which segment, and whether to
  widen; whether a low campaign is worth topping up; spend above the cap;
  whether a pilot's yield justifies scaling; copy for a new cell; ICP
  changes; a client's expanded title list; flipping a campaign active.
- **Routine — Cayden.** QA holds; uploading customer lists; resuming parked
  runs; acknowledging receipts.

A step that does not clearly sit in one column goes in the judgement column
and gets asked. **Nobody automates a decision to save a card.**

**Why.** Addendum section 1 and 3, verbatim. The first version of the brief
read as "getleads lanes"; the addendum says the service is for every lane,
and that the only thing that stays with Josh and Claude is working out which
source holds a never-sourced buyer, once per lane, whose output is a recipe.

**Tradeoff.** More cards early. Accepted: a wrong automated decision costs
more than a tap.

**Guard.** `src/guards/judgement.test.ts` — every card choice that spends,
widens, scales or flips is owner-only; no code path resolves a card without
a human or an MCP token.

## D19 — The service is the memory

**Decision.** One state record per lane in `topup.lane_state`, an append-only
`topup.lane_events` log, and a `topup.queue_registry` of every table a lane
draws from (including hand-filled ones registered from a Claude session over
MCP). The state answers, for a lane: current stage and since when; what is
queued where (counts by `lead_status`, every registered queue with what its
rows are still missing and the next method that fills it); what it is
blocked on and what that person or thing needs to do; spend by vendor this
run and this month; a one-line event log with what the service intends next;
runway and health for every campaign the lane feeds. It is readable three
ways: `/where <client> [lane]` in Slack, the `lane_state` MCP tool, and a
daily digest in the ops channel that only names lanes whose state changed or
whose health crossed a line since the last digest.

**Why.** Addendum section 2: "A chat that ends is not a state that ends."
Work done in a Claude session was being lost with the session.

**Tradeoff.** `register_queue_table` accepts a `where` predicate written by
the owner. It runs in a read-only transaction with a statement timeout and
the table name is validated as `schema.table`; the predicate is not parsed.
Accepted because only the owner token can register, and the result is a
count.

**Guard.** `src/ledger/ledger.test.ts` (state composes; digest silent on no
change; nothing rendered looks like an email; registry refuses anything that
is not `schema.table` or has a statement separator).

## D20 — Campaign health lines

**Decision.** From the Smartlead mirror (`public.campaigns / leads / sends` on
campaignintelligence), never from Smartlead directly. A lead is *untouched*
when it has no sent row. Over a seven-day window a campaign is:
**silent** — ACTIVE, untouched leads, zero sends; **empty** — ACTIVE with no
untouched leads; **low** — days of runway (untouched ÷ average daily sends)
under the recipe's `runway.floor_days` (default 7); **bouncing** — bounce
share over 5% of sends. Any flag change is a "crossed a line" for the digest.

**Why.** Addendum section 2 names the case: a live campaign with thousands of
leads and zero sends for a week must be surfaced automatically.

**Tradeoff.** The mirror syncs hourly; health is at most an hour stale and
says so (`synced_at`). Accepted.

**Guard.** `src/ledger/ledger.test.ts` (`assessCampaign`).

## D21 — Physical lanes get a yield card, then a pilot of about 100, then a second card

**Decision.** For any lane whose source is not already a person with an
email (Maps, permits, parcels, public records, signal feeds), the service
runs the cascade — company → domain, domain → named person with the wanted
title, person → email (name-to-email first, then the email finder
waterfall), verification, then the shared tail — and before spending it
posts a **segment card with expected yield and expected cost per usable
lead**, computed from per-lane, per-step hit rates the service keeps
(seeded from the measured defaults in the skills the first time). On
approval it runs a **pilot of about 100** through the whole cascade and posts
a second card: "pilot returned N usable at $X each — scale to the remaining
M, or stop." **Nothing scales without that second tap.** The skills
`leadgen-mcp-routing`, `tam-sizing`, `domain-waterfall`, `people-waterfall`,
`unmask-shell-llc`, `hard-to-find-dm-discovery`, `serp-dm-discovery` and
`unresolved-name-routing` are the specification for the cascade: every
measured hit rate and trap in them becomes a guard or a default here.

**Why.** Addendum section 1. Scaling a cold cascade on an estimate is how a
few hundred dollars disappears into unresolved rows.

**Status.** Decided now, built in Phase 3 (D23). Peterson roof owners first:
a working campaign with nothing left to send and about four thousand
verified contacts never staged.

**Guard.** None yet; lands with the cascade PR and must cite this entry.

## D22 — `docs/servers.md` before pipeline code on a server

**Decision.** Before the service calls a vendor server, that server is
documented in `docs/servers.md` from its code (not its README): tool names
and real arguments, which calls are synchronous and which return a job id,
how to poll and what finished looks like, what a failure looks like versus a
stall, the table-source and writeback modes that keep rows out of the
caller, and the unit prices per tier. Where the brief says a server is
broken (no cancel, zero-dollar accounting, status errors on completed jobs,
row-count truncation) the breakage is confirmed in code and listed as a
prerequisite PR on that server. Josh reviews the document before the service
builds on it. Third-party MCPs (getleads, AI Ark, LeadMagic, Prospeo,
FullEnrich, DiscoLike, Apify) document themselves.

**Why.** Addendum section 4, verbatim: "Fix that as your first task, before
any pipeline code." Every server's tools have been rediscovered by trial in
chat, more than once.

**Guard.** `src/guards/servers_doc.test.ts` — every vendor client under
`src/clients/` names a server that has a section in `docs/servers.md`.

## D23 — Build order: ledger first, then getleads lanes, then the physical cascade, then vendor fixes

**Decision.** Phase one adds the ledger and `/where` before anything else
(this PR). Phase two runs the getleads lanes end to end (pull, suppress,
find_emails, qa, route, stage, import, post_import, runway watch). Phase three
is the physical lane cascade with the yield card and the pilot gate (D21),
Peterson first. Phase four is the vendor server fixes and attribution. The
verify → normalize scope of D17 stands; only its "what comes next" is
replaced.

**Why.** Addendum section 5.

**Guard.** `src/guards/invariants.test.ts` (`PHASE1_STEPS` still ends at
normalize; a new stage is a new decision).

## D24 — The state machine is the thirteen steps of `skills/lead-list-build`

**Decision.** A lane is always on exactly one of the thirteen steps of
`skills/lead-list-build/SKILL.md`. The ledger (`topup.lane_state.step`,
`lane_events.step`), `/where`, the `lane_state` MCP tool, every card and every
log line name the step by **number** and, once the skill supplies them, by the
skill's **title** — never by a name the service made up. The single table of
steps is `src/spine/steps.ts`: number, title, owner, gate, skill, and which
internal pipeline stages (`run_steps.step`) sit on it. Each step's **gate** is
a check that halts the run at the step, records why (`lane_state.gate_unmet`,
a `gate_unmet` event, `run_steps.last_error`) and posts **one** card; a run
never moves past a failed gate on its own and silence never means yes. The
**receipt** is the last gate: a run is not done until the receipt posts, and
it is the last event on the lane. Owners: code runs steps 3–12; Josh owns 1,
9 when copy is needed, and 13; Cayden clears holds in 8 and handles the client
customer list in 5. Where the skill and the brief disagree, the skill wins on
the order of steps and their gates; the brief wins on spend, roles and what
the service must never do.

**Why.** Josh, "build to the spine": "If a piece of code does not map to a
step, ask me why it exists." A card, a log line, a ledger row and the skill
must all say the same thing, so the skill's numbering is the vocabulary. The
gates named first (1 sign-off, 2 useful floor, 3 title audit + ceiling, 5
response-based scope + cross-campaign check, 6 sendable rule + stall runbook,
7 every merge field populated, 11 count assert) "are the ones that have
shipped bad lists."

**Tradeoff.** The skill file is not in this repository or anywhere the agent
could reach (see the PR), so `src/spine/steps.ts` carries only what the
prompt stated: titles are null and render as "Step N"; the owner of step 2
and the gates of 4, 8, 9, 10, 12, 13 are null and are questions, not
defaults; `trigger` and `stage` are unplaced. Supersedes the invented stage
vocabulary (`idle | <stage> | parked | waiting`) of the first ledger commit.

**Guard.** `src/guards/spine.test.ts` — thirteen steps in order; owners as
assigned; the named gates present; every internal stage on exactly one step
or listed unplaced; labels never invent a title; only `LaneLedger` writes
`lane_state`; and when `skills/lead-list-build/SKILL.md` is in the repo the
titles must match its headings (skipped with a message until then).
`src/spine/gate.test.ts` holds the step 6 and 7 gates. Ask Josh.

## D25 — The skills are in the repo; the spine, the gates and the normalizers are copied from them

**Decision.** Josh's skills live at `skills/` (`lead-list-build` plus the
twenty-five SalesGlider skills, `SKILLS_INDEX.md`, `MCP_SERVERS.md`). They
are the specification. From them:

- `src/spine/steps.ts` carries the thirteen titles, owners and `Gate:` lines
  **word for word**; `trigger` sits on step 1 (a run opens against the
  signed-off segment, which is the recipe), `ingest` on 4, `stage` on 10;
  nothing is unplaced. Change the skill first, then the table.
- **Step 6 gate** is the skill's: "sendable count and reject rate reported. A
  reject rate far above the lane's norm means the source is bad, stop and say
  so." The norm is `verify.reject_rate_norm` on the recipe (Josh's number per
  lane; null until he gives it). "Far above" is defined here, not in the
  skill: at least **2×** the norm and at least **10 points** over it, on at
  least **50** verdicts; stalled rows are not verdicts. With no norm only the
  unarguable case stops the run: nothing sendable.
- **Step 7 gate** is the skill's: "every merge field the copy uses is
  populated or the row is held." The fields the copy uses are the recipe's
  `required_fields`. A row with one empty moves to `qa_hold` with the empty
  fields in `qa_flags.merge_field_empty`; the run goes on to step 8 and the
  gate reports how many were held and why. `local_sports_team` is never a hold
  on its own: the skill routes a row with no team to the AirPods tier. This
  replaces D24's halt-the-run reading of the gate.
- The four **normalizers** are ports of the skill scripts, rule for rule and
  in the scripts' order: `normalize_names_and_cities.py` → `names.ts`;
  `company-name-normalization/SKILL.md` (no script; its eleven rules) →
  `company.ts`; `conversational_location.py` → `location.ts` (the METROS
  table verbatim); `assign_team.py` → `team.ts` (MLB, NFL, college tables,
  overrides, renames, radii verbatim). Where `SKILLS_INDEX.md` marks a part
  stale, the index wins: the raw `city` is never written; a city that cannot
  be geocoded gets a **blank** location (the script returned the city); an
  ambiguous (school-qualified) college nickname goes to **null** and the
  AirPods tier (the script wrote "LSU Tigers").
- Geocoding needs the free US cities file both scripts read. It lives in
  `topup.ref_cities`, loaded once by `npm run seed:cities` from
  kelvins/US-Cities-Database pinned to a commit (MIT; not a vendor; never
  called by the service or a test). An empty table means every row is
  NO_GEOCODE and the normalize line says so. Migration 0006 drops the three
  scaffolding reference tables the scripts' constants replace
  (`ref_metro_names`, `ref_sports_teams`, `ref_ambiguous_nicknames`) and the
  suffix table; `ref_acronyms` stays as the skill's "fix by hand" list.

**Why.** Josh: "Each step names its skill. That skill is the specification.
Port the normalizers from their scripts… Where a skill is marked stale in
`skills/SKILLS_INDEX.md`, the skill's stale part is wrong and the index note
is right." And: "Do not invent your own stage names; use the step numbers and
the step titles from the skill."

**Tradeoff.** Three places the skills leave a number or a rule open are
filled here and named as such, for Josh to change: the "far above" factor,
the pipe (`|`) treated like a spaced dash in company names (the skill lists
dashes only), and `local_sports_team` excluded from the step 7 hold. Two
places the skills disagree with each other are decided for the spine and
listed in the PR: the order of the four normalizers (lead-list-build says
company before location; the company skill says company last — the spine's
order is used, and the two write different columns so nothing depends on
it), and school-qualified college nicknames (the sports skill keeps them,
the spine and the index null them — nulled). The first-name script keeps an
all-initials name ("C J") and a lone initial ("J.") as the merge value; the
service does the same and flags them (`all_initials`, `initial_only`) rather
than hold, because the skill says keep.

**Guard.** `src/guards/spine.test.ts` parses `skills/lead-list-build/SKILL.md`
and fails when a title, owner or `Gate:` line in `src/spine/steps.ts` differs
from it (no longer skipped). `src/spine/gate.test.ts` — the reject-rate stop
line and the hold field list. `src/stages/normalize/normalize.test.ts` — every
example the four skills document, as a test. `src/guards/no_secrets.test.ts`
now scans `skills/` and `docs/`. Ask Josh.

## D26 — Steps 2 through 12 run end to end for a getleads lane; each gate is the skill's

**Decision.** The pipeline is the skill's order, one internal stage per step
(`PIPELINE_STEPS` in `src/orchestrator.ts`): `size` (2), `pull` then
`find_emails` (3), `ingest` (4), `suppress` (5), `verify` (6), `normalize`
(7), `qa` (8), `route` (9), `stage` (10), `import` (11), `post_import` (12).
Step 13 is Josh's by hand; the receipt says so and queues nothing. A getleads
lane (Parlay `it_dm`) runs 2 → 12 with fakes end to end against the schema.
The rules each step carries, where the skill left them open or where two
sources disagreed:

- **Step 2, size.** One sizing source (getleads `count_contacts`). The
  tam-sizing partition check runs on the same source (bands + other bands =
  no band filter, within `size.partition_tolerance`, default 1%); off means
  the band filter does not bind and the run stops. Net new = matching − rows
  already sent to this ICP (`public.leads` joined to `public.sends` for the
  lane's campaigns). Under `size.useful_floor` (default 200) the run parks as
  `pool_thin` — the skill's gate. The pull plans
  `min(runway.max_per_run, max(rows needed for 30 days, floor), net new)`;
  when the mirror has no sends for the lane, rows needed is unknown and the
  plan falls back to `max_per_run`.
- **Step 3, pull.** One `PullAdapter` interface; `GetleadsPull` is the first
  adapter (`export_contacts` with `confirmed: true`, then
  `check_contact_export`). Zero rows delivered is the gate. Email finding is
  **inside step 3** as the skill places it, so `find_emails` runs before
  ingest; for a getleads lane it is skipped by recipe (`email_finding.enabled`
  false, VALID rows arrive with an address). The company-first adapter and the
  cascade land next (Peterson first, D23); until then a recipe with email
  finding on parks at the step and says so.
- **Step 4, ingest.** LeadPipe `ingest_csv` under a run-scoped `source_label`;
  the rows are then **claimed** for the run (`run_id`, `lead_status =
  'ingested'`) and `company_size` / `vertical` filled from getleads' band and
  industry. Gate: rows read = rows exported, else stop. The title audit runs
  here against the recipe's title patterns as whole phrases; off-title rows
  are flagged for step 8, not dropped.
- **Step 5, suppress.** One SQL pass, response based only (D18), reason by
  priority: `positive_reply, do_not_contact, wrong_person, suppression_list,
  bounced, client_prior_contact, same_offer_other_client, client_domain`.
  Duplicates within the pull become `deduped`. The client's customer domain
  list is `topup.client_domain_blocklist`, filled by Cayden through the
  `add_client_domains` operator MCP tool (domains only, never rows); a lane
  with an empty list posts one card — **List added** (operator) or **Go
  without** (Josh only) — and waits. "Same offer, other client" applies only
  when the lane's campaigns carry an `offer_key` in `topup.campaign_registry`;
  without one the line says it was not applied.
- **Step 8, QA.** Rules are rows of `topup.qa_rules` named by the recipe's
  `qa` list; a rule the recipe names and the table lacks stops the run. Purge
  rules run before hold rules. Patterns are **Postgres regular expressions**
  (`\y` for a word boundary — `\b` is a backspace in Postgres; `(?c)` for a
  case-sensitive rule under `~*`); migration 0008 corrects the seeded
  patterns. The skill's automatic reroute (nonprofit → EOS) is a **hold with
  a Reroute button**, offered only when the recipe's `reroute` map names a
  campaign of this client; a person decides. Step 7 holds carry
  `hold_rule = merge_field_empty` and get the same card. One summary post,
  one card per rule; ten samples of company and title at most, never an
  address.
- **Step 9, route.** A lead's cell is `band` (segment label from the getleads
  band), `mail_class` (`SEG` / `OTHER`) and `gift` (first tier of
  `normalize_flags.gift_tier`); the first routing rule whose every `when`
  matches wins. Gate: every target campaign is this client's in
  `public.campaigns` (`smartlead_client_id` on the recipe), else stop. A lead
  no rule matches waits as `pending_campaign` and one card asks Josh to
  continue without them or abort; they stay in the lane and a later run
  reclaims them.
- **Step 10, stage.** Rows land in `public.leads_staging` with `first_name`
  and `company_name` set to the **normalized** values (the merge tags read
  those columns), `job_title` from `title`, `vendor = 'getleads'`,
  `source_dedupe_key = md5(campaign_id || '|' || lower(email))`, `imported =
  false`. A routed row whose key already sits in staging from an earlier load
  is the gate: stop and say how many.
- **Step 11, import.** Per campaign, `start_lead_import` then
  `get_lead_import_status` (Smartlead MCP, D6 allow list); the Smartlead run
  id is kept on `run_steps.vendor_job_id` so a restart polls rather than
  re-submits. Gate: `imported_count` equals rows submitted, else the rows are
  `import_mismatch` and the run stops before the next campaign — duplicates
  and invalids count as a mismatch because the skill's assert is on the count.
- **Step 12, pre-launch.** `check_merge_tags.py` ported rule for rule
  (`KNOWN_BAD`, system fields under coverage warn, custom fields posted
  `Local_Sports_Team, vendor, job_title` at zero coverage fail with the
  near-miss hint, "ZERO staged leads" is the Goliath failure); settings
  findings (plain text, tracking off, stop on reply, bounce autopause off,
  Mon–Thu) reported, unknown when the payload lacks them. Any merge failure is
  the gate: the leads are already in the campaign, so the card says do not
  flip it active. Runway before → after per campaign from the mirror.
  Signatures, pod staffing and placement tests are the deliverability
  wizard's and are named as not checked.
- **Receipt.** Funnel numbers only (`FUNNEL_COUNTS` in `src/domain/runs.ts`,
  in step order) plus one line per campaign: imported, runway before → after,
  ready for ACTIVE or not. Per-step detail stays on `run_steps.counts`.

**Why.** Josh's order of work: "Then steps 2 through 12 end to end for one
getleads lane, Parlay." The lane has to run before the physical cascade can
be measured against it (D21, D23). Where the skill's placement and the
brief's phase list disagreed (email finding after suppress in the earlier
stage list; inside step 3 in the skill) the skill wins on order (D24).

**Tradeoff.** Rules filled in here for Josh to change, all listed in the PR:
the partition tolerance (1%), one sizing source where tam-sizing wants two,
the `max_per_run` fallback when the mirror has no sends, reroute as a hold
rather than automatic, duplicates as an import mismatch, the merge-tag gate
running after import (a pre-check in step 9 would need the copy earlier),
staging carrying normalized names, and the additive indexes on the shared
`public.leads`, `leads_staging` and `suppression` tables (0007). The e2e
exercise lives outside the repo and hits a local Postgres with fakes; the
repo's tests assert on the pure rules and the ledger, never a vendor (D5).

**Guard.** `src/guards/invariants.test.ts` — `PIPELINE_STEPS` is exactly the
order above, non-decreasing on the spine, with no `trigger`. `src/guards/
smartlead_never.test.ts` — no forbidden Smartlead verb anywhere in source.
`src/stages/pure.test.ts` — partition check, plan rows, title phrase match,
QA scope SQL, routing cells, dedupe key, import match, job parsing, and the
Smartlead client's allow list is exactly D6's five tools. `src/
stages/post_import/mergeTags.test.ts` — every case the Python script
documents. `src/slack/roles.test.ts` — `no_list` and `continue_without` are
Josh's; `list_added` and `add_client_domains` are operator. Ask Josh.

## D27 — The watch starts a top-up on its own when a campaign is low and still working

**Decision.** `/topup` is the override, not the normal start. Every
`WATCH_CRON` (default every six hours) and once on boot, the service looks
at every recipe's campaigns in the Smartlead mirror:

- A campaign is **needy** when it is ACTIVE and either **empty** or **low**
  (runway under `recipe.runway.floor_days`). Silent is not needy: it already
  has leads it is not sending.
- A campaign is **working** by D11 (one interested reply per 2,000 sends,
  or `/working on|off`). Too few sends to judge counts as working.
- **Any needy campaign still working → open a run and go.** No card. Trigger
  is `runway`. The thread says the watch started it.
- **Every needy campaign not working → open a run, post the not-working
  card, wait.** Top up anyway (Josh) drives the pipeline; Leave it closes as
  `not_working`. The watch will not ask again on that lane until a campaign
  becomes working or Josh flips `/working on`.
- An open run, a recipe with no campaigns, or `DRY_RUN` → skip.

The recipe is the signed-off ICP (step 1). After that, starting a run when
the numbers say so is mechanical (D18). Josh is still the only person who
flips a campaign ACTIVE (step 13).

**Why.** Josh: the whole point is to top up automatically, evaluating for a
good reply rate and then going for it — not waiting for `/topup`.

**Tradeoff.** The watch reads the hourly Smartlead mirror, not Smartlead
live, so a campaign can sit low for up to the mirror lag plus the cron
interval. Tightening `WATCH_CRON` is a Railway variable. Bouncing is a
digest flag, not a stop: a low working campaign that is bouncing still
gets topped up. Change that here if it should ask instead.

**Guard.** `src/watch/decide.test.ts` — go / ask / skip / leave-it quiet /
empty asked first. Ask Josh.

## D28 — Every run walks steps 1 through 13; saved work is reused, not skipped as a different process

**Decision.** A top-up — watch or `/topup` — is the thirteen steps of
`skills/lead-list-build`, in order, every time. `PIPELINE_STEPS` is
`trigger, size, pull, find_emails, ingest, suppress, verify, normalize, qa,
route, stage, import, post_import, flip`.

- **Step 1** is a real stage. The recipe is Josh's sign-off. If it is
  already there and every cell has a campaign of this client, the step
  finishes with "using the saved ICP" and does not ask again. Missing cells
  or campaigns that are not this client's halt. The service never invents
  an ICP.
- **Steps 2–12** always run on the new rows. Saved QA rules, routing, the
  customer domain list and the campaigns are inputs, not a reason to skip
  the step.
- **Step 13** is a real stage. It posts the flip reminder and finishes. It
  never sets a campaign ACTIVE.

This supersedes the D26 line that kept `trigger` out of the pipeline.

**Why.** Josh: it should follow the steps he gave; if a client already has
step 1 (or other saved work) the service can rely on that, but it still
goes through the process.

**Tradeoff.** Step 13 does not wait for a "I flipped it" tap. Waiting would
park every lane on Josh after every fill and stop the next watch tick. The
receipt and the step 13 line are the handoff. Say if a tap should be
required.

**Guard.** `src/guards/invariants.test.ts` — `PIPELINE_STEPS` is exactly the
order above, spanning spine steps 1..13. `src/stages/trigger/cells.test.ts`
— cartesian cells, AirPods rules that omit a dimension, a missing band is
uncovered. `src/guards/spine.test.ts` — `flip` sits on step 13. Ask Josh.

## D29 — Recycle after 90 days; TAM and pull follow the skills; puzzle + email enrichment sit after suppress; step 5 does not wait

**Decision.** Josh's audit of the walkthrough, 2026-09-12. Six corrections;
steps 7–13 stay as D26 built them.

1. **Slack console** is channel `C0C135EB76H` (`SLACK_OPS_CHANNEL` default).
   Client maps may still override per tag.
2. **Recycle, not lifetime suppress.** `client_prior_contact` is a send for
   this `smartlead_client_id` in `public.leads` ⋈ `public.sends` (`sent`,
   `sent_at`) inside `suppression.recycle_after_days` (default 90). Positive
   reply, DNC, wrong person, `public.suppression`, and bounce stay forever.
   Being in `leads_staging` is not a suppress reason. Size net-new subtracts
   the same 90-day send window, not lifetime staging. Campaignintelligence
   emailed-ever vs emailed-90d (counts only, 2026-09-12): Parlay 20,151 /
   20,068; SalesGlider 36,449 / 24,590; BCP 25,742 / 25,435.
3. **Size is tam-sizing, not getleads-only.** Classify `recipe.icp.kind`
   (`linkedin_native` | `physical`). LinkedIn-native: getleads
   `count_contacts` is the free second opinion; AI Ark People Preview is the
   default primary and is not a leadtopup client yet (D22), so the five-line
   report says so. Physical: a range from Maps `estimate_cost` and/or
   PermitStack counts — park until those counters are wired; never a
   getleads TAM. Partition check and useful-floor gate stay.
4. **Pull is routed, not getleads-shaped.** `leadgen-mcp-routing` step zero:
   LinkedIn-native → getleads (then AI Ark / LeadMagic / Prospeo /
   FullEnrich when those adapters exist). Physical → Maps and/or
   PermitStack, then domain-waterfall and people-waterfall. Mixed clients
   are per lane. getleads on a physical ICP parks ("do not fall back").
   maps / permits / AI Ark park with a clear "not wired" until D21's
   physical cascade. If the buyer is in neither Maps nor permits, ask Josh.
5. **Step 5 does not need approval.** Apply `topup.client_domain_blocklist`
   when it has rows; if empty, proceed and say so. `add_client_domains`
   still fills the list. No `client_domain_list` card.
6. **Puzzle pieces, then email enrichment, immediately before verify.**
   `PIPELINE_STEPS` is `trigger, size, pull, ingest, suppress, puzzle,
   find_emails, verify, normalize, qa, route, stage, import, post_import,
   flip`. After suppress: name and no domain → Domain Waterfall
   `resolve_domain` (table source, ≤500/job); domain and no name → Find
   Named Person `resolve_people` (always pass `approve_cost_usd`); name +
   domain and no email → Name to Email `verify_person` first (never
   `start_run` / `export_run`), then Email Waterfall `enrich_waterfall`
   with `source_table` + writeback. Bank every name in `public.name_bank`.
   A getleads VALID pull with no leftover names skips both stages.

**Named conflicts (skill vs Josh; recorded and followed).**

- Skill step 3 walks domain / people / email finding before ingest. Josh:
  do not pay to enrich a suppressed person, so puzzle + find_emails run
  after step 5 and immediately before verify. The thirteen step numbers
  stay the skill's; `puzzle` and `find_emails` sit on spine step 5.
- Skill step 5 body: ask Cayden if the customer domain list is missing.
  Josh: no approval. Heading is `(code)` only.
- Skill step 5: anyone already in this client's campaigns via
  `leads_staging`. Josh: recycle after 90 days if they have not replied
  positively / DNC.

**Why.** The walkthrough treated getleads as the whole size and pull recipe
and treated prior contact as forever. The skills (`tam-sizing`,
`leadgen-mcp-routing`, `domain-waterfall`, `people-waterfall`,
`unresolved-name-routing`) already said otherwise.

**Tradeoff.** AI Ark People Preview, Maps, and PermitStack are documented
as servers but are not leadtopup clients yet (D22). A physical recipe
parks at size/pull rather than guessing a getleads number. Name to Email
`verify_person` is one row per call (server-to-server; catch-all is never
treated as valid). Email Waterfall dollars are still hardcoded $0 on that
server; worst case comes from `src/spend/prices.ts`.

**Guard.** `src/guards/invariants.test.ts` — `PIPELINE_STEPS` is the D29
order. `src/guards/spine.test.ts` — `puzzle` and `find_emails` on step 5;
step 5 has no Cayden tap. `src/stages/pure.test.ts` — classifyPuzzle,
routePull / routeSize, recycle SQL, five-line size report. Ask Josh.

## D30 — ICP, band, and persona are per campaign, not per recipe

**Decision.** Josh, 2026-09-12: each campaign can have a different ICP,
band, persona, and source. D29 put `icp.kind` on the recipe; that is
wrong. Campaign names already follow `Client Offer ICP Gift`. A lane
(Peterson, Parlay, a mixed client) can feed campaigns that do not share
a stack — GC-partner vs vacant-land, desk IT vs rooftop owner.

1. **Routing rule carries the ICP.** Every `routing[]` entry has
   `icp: { kind: linkedin_native | physical, persona }` (snake_case,
   e.g. `it_dm`, `owner`). Optional `source` overrides the recipe
   template; omitted means inherit and slice getleads `company_size` to
   that campaign's `when.band`. The recipe `source` stays as the default
   template. There is no recipe-level `icp`.
2. **Size and pull group campaigns.** Same kind + persona + source kind
   → one count/export, union of bands and titles. Mixed kinds or
   personas in the same run park ("split them — do not pick one stack").
   Physical still parks until Maps/PermitStack are wired. getleads on a
   physical campaign still parks (D29).
3. **A run names its target campaigns.** The watch passes the needy
   campaign ids (`decision.campaigns`). `/topup` and MCP with no ids
   target every campaign the recipe names. Targets are stored as
   `target_<id>: 1` on the run and on the trigger step. Exactly one
   target also sets `run.campaign_id`. Unknown ids refuse the open.
4. **Title audit** uses the union of the target campaigns' getleads
   titles, not only `recipe.source.params.job_titles`.

**Named conflict (skill vs Josh).** Skill step 1 / tam-sizing talk
about "the lane" ICP. Josh: the campaign is the unit. The thirteen
step numbers stay the skill's; classification reads `routing[].icp`.

**Why.** One recipe-level kind cannot describe a client that sells two
offers, or two bands that happen to share a pull today and will not
tomorrow.

**Tradeoff.** A full-lane `/topup` on a mixed-ICP recipe parks instead
of walking two stacks in one run. Sequential multi-stack pulls are a
later decision. Recipe `source` remains so existing getleads filters
are not copy-pasted onto every cell.

**Guard.** `src/recipes/schema.test.ts` — every routing rule has ICP;
recipe-level `icp` is gone. `src/recipes/campaigns.test.ts` — inherit
vs override, grouping, target ids. `src/stages/pure.test.ts` — mixed
kinds park; same persona unions bands. Ask Josh.

## D31 — Claude writes a first-pull receipt so leadtopup can repeat it

**Decision.** Josh, 2026-09-12: the point of leadtopup is “this campaign
is working, get more of those people.” The first list is built in Claude
Web. The Smartlead mirror then has the people and not the how. After every
first pull, Claude writes one row to `topup.pull_receipts` on
campaignintelligence (`azpapwtnrbzywlnxxecz`): client, lane, campaign ids,
`icp_kind`, persona, company source and filters, and how domain / person /
email were obtained. Counts and ids only. Two ICPs → two rows. Latest row
wins. The service does not invent a source from `public.leads`.

**Why.** Title and company size are on the lead. “Came from Maps then
Domain Waterfall then Name to Email” is not. Without the receipt the
service cannot automatically refill what Claude did by hand.

**Tradeoff.** The service does not yet drive a run from a receipt alone
(a recipe is still required to execute). The receipt is the input that
lets us write that recipe without asking Josh to re-narrate the pull.
Claude must know the campaign ids before it inserts.

**Guard.** `src/recipes/receipt.test.ts` — Parlay getleads and Peterson
physical shapes parse; another project, empty campaigns, or a one-word
how are refused. `skills/first-pull-receipt/SKILL.md` is the prompt
Claude runs. Ask Josh.

## D32 — Receipts are per build; tam_count is not rows_found

**Decision.** Josh / Claude backfill, 2026-09-12. One row per lane hid how
leads were actually found (Peterson C1 was nine builds). Receipts are
now **lane** (filter book) plus **build** (`build_label` = source_label /
batch). 28 lane + 104 build rows are seeded. Propose the build with the
best measured imported count. Empty `campaign_ids` is legal on a build
that never loaded. The four columns `segment`, `yield_by_step`,
`spend_cents`, `suppression_scope` are written on every service run
(step 11.5, after import). Campaign-id trigger and project check stay.

**Acceptance test (this entry).** Parlay `it_dm_tickets` lane filters
run through getleads `count_contacts` on 2026-09-12: **36,810** matching
(`VALID`, US, 17 titles, bands 11–50 / 51–200 / 201–500). The receipt
stored `rows_found = 11,405` and `tam_count` null. Staging on those six
campaigns: 17,135 rows / 12,012 distinct emails. Net new vs distinct
staged: 36,810 − 12,012 = **24,798**. The format was missing `tam_count`
as a separate field from the export size — that is the miss, not a 3×
pool change. Peterson `c1_general_contractors` `maps_runs` reconstruct
exactly from `client_peterson.leads`: run `peterson` 76,830 businesses /
72 categories / 832 zips; run `0290c562d4f6` 1,309 / 1 / 265. Permit
counts stay as recorded on the lane row (147,366 permits, 28,767
contractors) — no PermitStack adapter in this service yet. Backfill
notes saying “Josh to confirm” (15 of 28 lane rows) mean propose, do
not scale.

**Why.** Tables remember source_label and vendor better than chat.

**Tradeoff.** The service still needs a recipe to execute. Unconfirmed
backfill is not an auto-export. Earthworks nonprofit Maps (29,647) has
no receipt yet.

**Guard.** `src/recipes/receipt.test.ts` — lane vs build, best-yield
pick, unconfirmed backfill. `supabase/migrations/0010_pull_receipts_builds.sql`
mirrors the live table. Ask Josh.

## D33 — Named receipt sources; recount backfill before proposing

**Decision.** Josh / Claude, 2026-09-12. `topup.pull_receipts` dropped
`other` from `company_source`, `domain_source`, `person_source`, and
`email_source`. `company_source` gained named signals:
`serp_tool_mention`, `theirstack_tech_signal`, `linkedin_engagers`,
`linkedin_import`, `web_visitor_pixel`, `job_posting_signal`,
`public_records`. `domain_source` gained `theirstack`. `person_source`
gained `leadmagic_employee_finder`. A signal row must carry its rerun
parameters in `company_filters`. Writing `other` is a bug to raise, not
a value to store.

Backfill writers (`claude_backfill`, `claude_backfill_build`) left
`tam_count` null and put the old export in `rows_found`. The first
proposal on any such lane recounts (`count_contacts` or Maps/permit
company count). A blank `tam_count` is not TAM.

The 15 remaining “Josh to confirm” lanes are **segment sign-off**
(step 1), done once: `bcp/healthcare_exec`, `bcp/it_dm_airpods`,
`bcp/logistics_exec`, `bcp/pe_firms`, `goliath/displacement`,
`insight/it_dm_by_offer`, `insight/oem_channel_reps`,
`parlay/it_dm_tickets`, `peterson/c2_property_managers`,
`peterson/c3_churches`, `techevo/govt_sub`, `techevo/sfl_it_dm`,
`techevo/sfl_startup_owners`, `vasco/dealership_principals_and_service`,
`vasco/signal_warranty_admin_hiring`. Peterson C1
(`c1_general_contractors`) is off that list — its Maps counts were
measured; it is the first top-up the service can run. Physical adapters
still park until Maps/PermitStack are wired; getleads is not the rooftop
fallback.

`skills/first-pull-receipt` and `skills/lead-list-build` are the Claude
skills and the Cursor prompt. They share this vocabulary. The stale
master-dedupe SQL is gone from `parlay-lead-pulls` (the lane receipt is
the filter book). `conversational-location` writes `city_normalized`
and blanks NO_GEOCODE.

**Why.** The table changed under the validator. Leaving `other` in the
writer would fail the live check. Trusting backfill `rows_found` as TAM
is how Parlay looked 3× too small.

**Tradeoff.** A recipe source the table has no name for (`mixed`) parks
or raises instead of writing a catch-all. Claude Web still needs Josh
to replace the installed copies of the two skills.

**Guard.** `src/recipes/receipt.test.ts` — `other` rejected; signals
need filters; backfill recount. `src/guards/receipt.test.ts` — skill
and validator share the enums. `supabase/migrations/0011_pull_receipts_named_signals.sql`
mirrors the live checks. Ask Josh.

## D34 — Lifetime prior contact; staging dedupe; empty customer list halts

**Decision.** Josh / Claude review of the branch against the Parlay, BCP,
Insight, Peterson, and Earthworks builds, 2026-09-13. Four fixes before
the first unattended run; four soon. Everything else in that review is
faithful and stays.

1. **Prior contact is lifetime by default.** `client_prior_contact` is
   an email in `public.leads` for this `smartlead_client_id` (any
   status) or in `public.leads_staging` for any campaign of this client
   (imported or not). Smartlead only dedupes inside one campaign; an
   untouched lead in campaign A is still a duplicate in B (BCP's 1,782
   cross-campaign dupes; Parlay's ~11,500 unsent). `recycle_after_days`
   is opt-in (default null). When set, it only lifts STOPPED or
   COMPLETED campaigns whose last send is older than the window. D29's
   90-day send window and "staging is not a suppress" are superseded.
2. **Stage dedupes on `(campaign_id, lower(email))`** against
   `leads_staging` and `public.leads`. `source_dedupe_key` is a write
   convention (284k of 306k live staging rows are null). Migration 0012
   backfills the key and adds the unique index when it can.
3. **getleads refuses mixed headcount filters.** Band labels and a
   numeric employee bound together silently overlap (2,700 wrong-band
   rows in August). Strip `employee_profiles_on_linkedin` from the
   Parlay recipe. The SalesGlider PE 5-plus floor stays a later recipe
   that has no `company_size`.
4. **Empty customer domain list halts.** Step 5 posts the Cayden card
   and waits unless `topup.client_domain_list_state.confirmed_empty_at`
   is set for that client. D29's "proceed with no card" is superseded.
   Josh's *Go without* sets the flag.

Soon, same PR: same-offer suppression **halts** when the recipe asks
and the registry has no `offer_key` for the lane (seed from lane
receipts + campaign names); step 6 gates on every sendable domain
having a mail class, with the service's MX lookup as fallback; `/health`
is `ok: false` / 503 when a required `topup` table is missing;
`regulated_gift_hold` is `federal credit union|federal savings|federal
reserve`, not the word `federal`; retail `target` is
`target (inc|corp|stores?|pharmacy)`.

D29's Slack console, puzzle-after-suppress, and physical-never-getleads
stay.

**Why.** Those four would load thousands of people already waiting in a
campaign, miss 93% of staging history, pull the wrong headcount band,
and skip customer suppression on every first run. The live project had
only `topup.pull_receipts`.

**Tradeoff.** Lifetime prior contact shrinks net-new versus a 90-day
recycle. Re-emailing someone who ignored a June sequence is a decision,
not a default. An empty customer list that Josh has not confirmed
blocks the run.

**Guard.** `src/stages/pure.test.ts` — lifetime SQL, recycle opt-in.
`src/recipes/schema.test.ts` — Parlay has no numeric bound and no
recycle window. `src/clients/getleads.ts` `assertGetleadsFilters`.
`src/health.ts` required tables. `src/guards/spine.test.ts` — step 5
heading stays `(code)`. Ask Josh.

## D35 — The merged list is the rulebook; 90-day send recycle is back

**Decision.** Josh's full merged list, 2026-09-14 (`skills/merged-list`).
Seventy-eight items. Six stay pending his tap: item 2's addition (never
two live campaigns of the same client), 26, 27, 53, 58, 71.

Confirmed deltas from D34 / D13 / D11:

1. **Item 2.** Do not load anyone this client sent to in the last 90
   days. Past 90 days with no rule-1 response, they are fair game.
   D34's lifetime prior contact is superseded. The live-campaign
   exclusion SQL exists behind `exclude_other_live_campaigns` (default
   false) until he taps.
2. **Item 15.** Pull every email status. We verify anyway. D13's
   VALID-only is superseded. Omit `email_status` on the getleads call.
3. **Item 12.** Working is one interested per 2,000 at campaign level,
   or any variant with **1,000** sends clearing that rate. D11's 300
   is superseded.
4. **Item 14.** Hunter is banned with PDL, BillionVerifier, Clay.
5. **Item 8.** Gift-lane hold includes insurance. Default stay in.

D34's staging `(campaign_id, lower(email))` dedupe, mixed-headcount
refuse, empty-list halt, MX mail-class gate, `/health` 503, and
federal/Target QA regexes stay.

Client-specific items (18–68) and methods (69–78) are the spec for
recipes and later adapters. The shipped Parlay recipe still pulls
bands 11–50 and 51–200 and counts 201–500 as widening (item 19) until
those cells have campaigns. Currency check (item 17) is required and
has no cheap method yet.

**Why.** The Sept 13 review inferred lifetime prior contact from a
month of builds. Josh's list is the policy: 90-day send window, with
the live-campaign addition still a question. VALID-only was leaving
catch-alls out of the pull that verification would have kept.

**Tradeoff.** Without the pending live-campaign exclude, an unsent
lead in campaign A can load into campaign B (BCP's 1,782). That is
the tap, not a silent default.

**Guard.** `src/guards/d35_merged_list.test.ts`. `src/stages/pure.test.ts`
— 90-day default, send-window SQL. `src/recipes/schema.test.ts` — Parlay
omits `email_status`, variant 1,000, recycle 90. Ask Josh.

## D36 — The six pending taps are yes

**Decision.** Josh tapped yes on every item D35 left pending
(2026-09-15).

1. **Item 2 addition.** Never put someone in two live campaigns of the
   same client. `exclude_other_live_campaigns` defaults true. Size
   subtracts those addresses too.
2. **Item 26.** TechEvo New England IT DM includes New York and New
   Jersey. Re-filter on the contact's city after export (item 28).
3. **Item 27.** Florida IT DM is statewide. The South Florida owners
   lane stays metro (Miami-Dade, Broward, Palm Beach).
4. **Item 53.** Earthworks improved commercial owners means 2+ parcels.
   All 3,958 operators are in scope.
5. **Item 58.** Insight drops gateway catch-alls. It does not route
   them to SEG campaigns. Other clients still segment (item 6).
   `verify.drop_gateway_catchalls` is the recipe flag, default false.
6. **Item 71.** Name to Email is paused. DiscoLike find emails is the
   cheap first rung. DiscoLike is not a leadtopup client yet (D22);
   leftover names go to Email Waterfall. `email_finding.name_to_email`
   defaults false.

**Why.** He said yes to all six. The live-campaign hole was the BCP
1,782 case. Name to Email now runs Hunter inside, which item 14 banned.

**Tradeoff.** Live-campaign exclude shrinks net-new versus send-window
alone. Insight will look thinner than a SEG-split lane with the same
pull. DiscoLike find emails is specified and not wired — the service
says so and uses the waterfall, it does not invent an adapter.

**Guard.** `src/guards/d36_pending_taps.test.ts`.
`src/stages/verify/sendable.ts` `isGatewayCatchallDrop`.
`src/recipes/schema.test.ts` — Parlay live-campaign on, Name to Email
off, Insight drop off. Ask Josh.

## D37 — Campaignintelligence positives are the global list; they expire

**Decision.** Josh (2026-09-16): do not ask for a customer-domain upload.
Who replied positively on campaignintelligence is the suppression list
for every client, and that block expires 90 days after the reply. DNC
and wrong person stay forever. An empty `topup.client_domain_blocklist`
does not halt a run and does not wait on `confirmed_empty`. Optional
customer domains still apply when rows exist.

**Why.** The empty-list card was blocking first use. The reply tables
already name the people nobody should email. A positive from June is
fair game again in September; a DNC is not.

**Tradeoff.** Thirty-eight dated positives older than 90 days recycle.
Forty-seven currently-Interested leads with no `replied_at` stay
blocked (sync gap) so we do not re-email someone still marked
Interested. A later category change on a lead does not lift a dated
positive send inside the window.

**Guard.** `src/guards/d37_positive_expiry.test.ts`.
`src/stages/pure.test.ts` — dated `positiveReplySql`. Ask Josh.

## D38 — Client-wide runway and DM pulls, not camp-by-camp SEG fills

**Decision.** Josh, 2026-09-21 (voice). Lead Top Up optimizes **client-wide
email days left**, not individual campaign dry alerts (SEG vs non-SEG,
Watchdog nearly-done on one camp). Josh named this D37; D37 on main is
already the 90-day positives list. This is the next number on main.

1. **Unit of runway.** Board and top-up triggers use client capacity: rem
   across ACTIVE campaigns ÷ (unique inboxes × MESSAGE_PER_DAY). LI stays
   rem ÷ 40.
2. **Unit of pull.** When topping up, pull the **same kinds of decision
   makers** the client has been sending to (ICP / persona from receipts and
   live sends). After the pull, **segment by title** (and mail class / gift)
   into the client's existing campaigns. Do not treat "this one SEG camp is
   empty" as the primary job while sibling camps for the same DMs still
   hold rem.
3. **Watchdog nearly-done.** Secondary signal. ACK Deliverability CLEAR
   when needed, but do not auto-open a one-camp SEG refill card if
   client-wide days are healthy.
4. **Mock / proposal threshold.** When a non-SalesGlider client is under
   **2 email days**, mock a client-holistic DM pull (filters, net-new, $,
   how it will title-segment). SalesGlider is excluded from under-2 auto
   mocks unless Josh asks.
5. **Floor for watch cards.** Client under-7 still appears on the daily
   board Status. Paid spend still needs Josh yes.

**Why.** Josh: alerts that a specific campaign is out miss the point; he
wants "holistically for this client, how long do they have to send," then
another pull of the same DMs, then title segmentation like he already
runs.

**Tradeoff.** A thin SEG camp can finish while the client still has weeks
of capacity on sibling lanes; that is allowed. Overrides the habit of
carding every Watchdog nearly-done SEG.

**Open.** Unique inboxes and MESSAGE_PER_DAY are not in this service (no
mailbox mirror, no invented column). Until Josh names the source, email
days are null and the watch uses client rem: siblings still holding rem
is healthy; rem exhausted across ACTIVE is needy. Under-2 mock logs the
intent; it does not invent filters, net-new, or a dollar figure. LI rem ÷
40 is specified; this watch still only reads Smartlead.

**Guard.** `src/guards/d38_client_runway.test.ts`.
`src/ledger/client_runway.test.ts`. `src/watch/decide.test.ts` — one-camp
SEG empty skips while sibling rem remains; go targets every recipe
campaign. Ask Josh.

## D39 — Grok bot is the babysitter; rows never enter its context

**Decision.** Josh, 2026-09-24 (voice + Slack, then "be more thorough").
The Lead Top Up **Grok bot** (Cursor Grok on this repo, Slack Cursor in
`#lead-topup`) is the orchestrator only. It does not pull, enrich,
verify, or inspect lead rows. Nothing that returns a list may land in
its context window. Tightened the same day: allow list, ban list,
LeadPipe + csv-endpoint as the only row movers, and a ban on walking
the thirteen steps in chat.

1. **Job.** Start a run, read counts and ids, post a Slack card, drop a
   signed URL or a `/where` line. "Here's what it found" is a count, a
   job id, and a link — not the list.
2. **Where the work lives.** MCP servers write into Supabase with
   `source_table` + writeback. Edge functions (`skills/supabase-csv-endpoint`)
   and LeadPipe / Context Saver (`skills/leadpipe`) move CSVs server to
   server. The Railway service walks the thirteen steps. Grok bot does
   not call export/search tools that return contact payloads into chat.
3. **What it may call.** The allow list in `src/grok/allowlist.ts` and
   `skills/grok-bot-babysitter`: service MCP (`start_topup`, `lane_state`,
   `run_status`, …), LeadPipe (`lp_plan`, `lp_run`, `lp_status`,
   `lp_export`, `lp_sample` ≤10, `lp_inventory`, `lp_ensure_client`,
   `lp_list_clients`), csv-endpoint / edge functions. A signed URL it
   does not open.
4. **What it must not call.** Ban list in the same files:
   `export_contacts`, `search_contacts`, GetLeads enrich / batch-result
   tools, Apify `get-dataset-items`, `find_dms_by_title` (~$0.10 per
   company; Josh's number), `SELECT` of email / first_name / last_name /
   phone / linkedin_url, inline waterfall `rows`, child-agent GetLeads
   fires, CSV paste. Ten masked samples stay the ceiling (D2).
5. **Do not reconstruct the thirteen steps in Grok context.** Infer
   *what to start* from **every** campaignintelligence tag, not four
   legs. Source legs (`company_source`, `domain_source`,
   `person_source`, `email_source`, `email_max_tier`, `email_tier`)
   **and** `company_detail`,
   `evidence`, `confidence`, `build_label`, `feed_pattern`, `icp_kind`,
   `persona`, `company_filters`, `segment`, `how_i_did_it`. Physical
   lanes must also read `company_filters` keys `maps`, `maps_runs`,
   `permits`, `geo`, `source_tool`, `titles_wanted`. Tables:
   `topup.pull_receipts`, `topup.campaign_method`,
   `topup.campaign_recipe`, `topup.feed_map`, `topup.lead_provenance`,
   `topup.provenance_sources`, `topup.provenance_gaps`. COUNT only;
   never SELECT email. Then `start_topup`. The service walks 1–13.
   Grok does not replay `skills/lead-list-build` or a `*-lead-pulls`
   skill in chat.
6. **This branch is honest about inference.** Railway code here still
   walks the file recipe (`recipes/parlay/it_dm.json`) through
   `PIPELINE_STEPS` (D24, D28). Inferring ICP from `public.leads` +
   receipt tags is PRs #6 and #7, not this merge. Grok must not fill
   that gap by walking the skill.
7. **No self-routine.** Scheduled pulses are Railway crons (Josh,
   2026-09-22, `#campaign-watchdog`), not a Grok routine that re-reads
   lists.

**Why.** Josh to Cayden, 2026-09-24 08:52 CDT: "I nuked our grok bot
usage again trying to do lead top up." Same warning two days earlier:
don't set a Grok routine or it burns the allotment. Repo evidence: the
desktop Grok agent "Lead top-up service"
(`bc-de1baca6-0ee5-4854-b3a1-c7f7ca95c5c3`, created 2026-09-11, last
active 2026-09-21) spawned dozens of child runs on 2026-09-16/17 named
"Fire GetLeads n=…", "Apply leftover … CSVs", "Drain remaining leftover"
— the opposite of babysitting. D2 already banned rows in Slack and
logs; this names the **context window** as the thing that ran up the
bill. Claude already kept tokens down with LeadPipe + csv-endpoint;
Grok must use those, not reconstruct a pull.

**Tradeoff.** Grok bot cannot debug a bad row by looking at it. It
posts a link or ten samples and stops. A thin camp can wait on the
service. That is allowed.

**Guard.** `src/guards/d39_grok_bot_context.test.ts`. Allow/ban in
`src/grok/allowlist.ts`. D2 `lead_rows.test.ts` still holds. Ask Josh.

## D40 — Live pull recipe lives on this service

**Decision.** How a campaign's leads were pulled last time lives here, on
the `topup` schema, not on LeadPipe and not reconstructed from tags in
chat. Three read-only MCP tools — `topup_recipe`,
`topup_campaign_builds`, `topup_provenance_gaps` — read
`topup.recipe()`, `topup.campaign_builds`, and `topup.provenance_gaps`
on campaignintelligence through the existing service-role connection.
Each is one SQL call; the jsonb comes back verbatim. No paging, no
cache, no mutation, no lead rows. Operator (Cayden) may call all three.
Cayden's campaign-topup skill and the Grok babysitter read them here.

When the watch flags a campaign as needing leads (go or ask), the Slack
message includes a recipe **summary**: builds, interested per build,
`any_reconstructed`, `leads_without_method`. The human starts from the
recipe, not from tags. The method paragraph stays on the tool, not on
the card.

The MCP is Streamable HTTP over HTTPS at
`https://leadtopup-production.up.railway.app/mcp` (Bearer owner or
operator token). CORS is open so Cursor can POST. GET stays 405
(stateless). These tools are not added to LeadPipe.

The file recipe (`recipe_get` / `recipes/*.json`) is still what the
pipeline walks (PRs #6 and #7). `topup_recipe` is the live pull record.

**Why.** LeadPipe only executes pulls. The watchdog only flags. The
record of how a list was built is `topup.*`. Three places reading three
copies will drift. Josh: Cayden's campaign-topup skill and the watchdog
read the recipe from one place.

**Tradeoff.** Slack gets counts and labels, not the written method. A
missing campaign returns the string `campaign not found in public.campaigns`.
A SQL failure still posts the watch card and says so.

**Guard.** `src/guards/d40_recipe_mcp.test.ts`. Ask Josh.

## D41 — MCP needs no login

**Decision.** The public HTTPS MCP at
`https://leadtopup-production.up.railway.app/mcp` does not require a
bearer token, OAuth, or any other login. Cursor adds the URL and
calls tools. No `Authorization` header. `/mcp` is mounted whenever
the database is up, even if `MCP_OWNER_TOKEN` / `MCP_OPERATOR_TOKEN`
are empty.

A request with no token, or with a token that does not match, is
**operator**. That includes `topup_recipe`, `start_topup`, and the
other operator tools. An optional owner token still elevates to
owner-only tools (`sample_rows`, `recipe_get`, …). Slack stays
signed; this decision is MCP only.

**Why.** Josh: "make the mcp no log in needed." The other house
Railway MCPs are already inbound-authless (`docs/servers.md`). A
Cursor login prompt on this URL blocked Cayden's campaign-topup
skill from reading the recipe we just put here (D40).

**Tradeoff.** Anyone who can reach the Railway URL can start a
top-up or read recipe counts. They cannot sample lead rows without
the owner token. Spend still asks Josh on a Slack card.

**Guard.** `src/guards/d41_mcp_no_login.test.ts`. Ask Josh.

## D42 — client_tag comes from topup.client_map

**Decision.** The `client_tag` input on `topup_recipe`,
`topup_campaign_builds`, and `topup_provenance_gaps` is not a
hardcoded twelve-name enum. The service reads
`select client_tag from topup.client_map order by 1` at boot and
refreshes that list on each `/mcp` request. Adding a client
(Deep Roots, Vector Energy, or anyone else) is a row in
`topup.client_map`. It is not a service code bump. If the table
is empty or the read fails, the tools accept snake_case so a new
tag is not rejected before SQL.

**Why.** The D40 prompt listed twelve tags. Deep Roots and Vector
Energy are not in that list. The day either becomes a campaign,
a hardcoded enum would reject the tag before `topup.recipe()` ran.
Josh: read the enum from `topup.client_map` at startup, or at
least note that adding a client means a service bump. We read
the table.

**Tradeoff.** Cursor's cached tool schema may lag until it
re-lists tools. The server accepts a tag as soon as it is in
`client_map`. Tags only; never `client_name`.

**Guard.** `src/guards/d42_client_map_enum.test.ts`. Ask Josh.

## D43 — Cayden's queue, and count_contacts is count filters only

**Decision.** One more read-only operator MCP tool, `topup_queue`. It
lists the campaigns the watch would flag (go or ask), ranked empty
first then shortest runway, each with the same recipe count summary
the Slack card already carries (builds, interested per build,
`any_reconstructed`, `leads_without_method`). No lead rows. No
mutation. Not on LeadPipe. Cayden's flow is: open the queue, pick
the top one, read `topup_recipe`, run `start_topup`. No Slack, no
Cursor. The watch still posts Slack for Josh.

Separately: getleads `count_contacts` is count filters only — exact
`company_size` band labels, titles, geo. `max_per_company` is an
export cap. The size step must not send it. The first-pull-receipt
skill already said this: "Do not put `max_per_company` in the count filters." The service's own TAM call was sending the recipe params
blob, and Parlay `it_dm` has been parked on size since 2026-09-17
(`unrecognized_keys: max_per_company`). Numeric `employees_min` /
`employees_max` / `company_size_min` / `company_size_max` stay
refused (D34, tam-sizing).

**Why.** Josh: Cayden opens the queue, picks the top one, reads the
recipe, runs it. No Slack, no Cursor. And Parlay has been stuck two
weeks on the same count-filter bug the skills warn about.

**Tradeoff.** The queue is computed (the same watch snapshot plus
one recipe SQL per flagged campaign), not a new SQL function.
Adding a client still does not need a service bump (D42). Watch
Slack stays for Josh.

**Guard.** `src/guards/d43_queue_and_count_filters.test.ts`. Ask Josh.

## D44 — Queue sees what #campaign-watchdog posts; 1 reply under 2k is working

**Decision.** `topup_queue` is the same lead-refill board `#campaign-watchdog`
posts, not only the D38 go/ask set on file recipes. Walk every
`topup.client_map` client and every ACTIVE campaign in the Smartlead
mirror. Include empty, low, and nearly-done (90% consumed — the
watchdog's "nearly done (90%, N left)" line). Rank empty first, then
nearly-done by remaining new, then low by shortest runway. Each row
still carries the recipe count summary. Also carry `working` /
`working_reason`, `client_under_floor`, and `sibling_rem` so Cayden
sees the 1-in-2000 gate and why the watch would skip. Do not hide a
dry camp because siblings still hold rem. Do not include "too few
senders" or silent/not-sending with rem — those are not a lead job.

The working gate for top-up is one interested reply per 2,000 sends
(D11). One interested reply in under 2,000 sends is also acceptable.
Auto-start stays D38. The queue does not start a run.

**Why.** Cayden opened `topup_queue` and it said no campaigns need
top-up. `#campaign-watchdog` was listing BCP / Emcor / Insight /
PowerGRYD / SalesGlider / TechEvo dry camps the same day. The queue
only walked `parlay.it_dm.v3` and skipped because Parlay sibling rem
is healthy. Josh: tie the watchdog channel in, and confirm 1-in-2000
plus 1 reply under 2k.

**Tradeoff.** Nearly-done uses the watchdog's 90% line, not a new
Josh-named floor. 75% "nearly done" posts are not included unless he
says so. `start_topup` still needs a file recipe; visibility is not a
new recipe. Not on LeadPipe. No schema change.

**Guard.** `src/guards/d44_queue_watchdog.test.ts`. Ask Josh.

## D45 — Ops findings 2026-10-01: runway math, infer from receipts, Cayden can operate

**Decision.** Seventeen items from the 2026-10-01 top-up review, plus
Josh: Cayden can do the ops work.

1. **Client runway days.** rem ÷ (unique inboxes × MESSAGE_PER_DAY)
   when both are named; else rem ÷ (sum of 7-day sends ÷ 7). **n/a does not pass
   the floor.** An ACTIVE client with no rate is under
   the floor, not healthy. Peterson 412 rem on one camp at 2.4d,
   peterson_earthworks 252 rem / 3d, and powergryd camps under 1.1d
   must trip.
2. **No file recipe required.** `start_topup` infers from
   `topup.pull_receipts` tags (`company_source`, `company_filters`,
   `how_i_did_it`, notes, lane, persona) for any client. A file
   recipe is the override. Do not invent titles or bands — incomplete
   getleads filters become `mixed` and size parks. Lane on the queue
   comes from the receipt, not a PowerGRYD-only name map.
3. **`start_topup`** takes `client_tag` + `campaign_id` (optional
   `count`) or `client_tag` + `lane`.
4. **`topup_queue`** takes `limit`, `offset`, `client_tag`. Trim
   `recipe_summary.builds` to interested > 0 plus `builds_total`.
5. **`topup_recipe`** omits `vocab` and `rules` unless
   `include_vocab=true`.
6. The 14:18 empty queue → 14:43 74 items was the D44 deploy, not a
   cache.
7. Hide `sample_rows` from the operator tool list (lead rows). Cayden
   may call the other ops tools (`register_queue_table`,
   `add_client_domains`, `campaign_registry`, `missing_piece_groups`,
   `recipe_get`, `lane_note`, `variant_stats`).
8. `resolve_hold` refuses operator approval of any spend ask of $5
   or more.
9. `campaign_registry` is on the operator set (Cayden can read it).
10. Spend copy is **$5 or above**, not "above $5".
11. Bounce-by-build: pass through a `bounces` count when the build
    jsonb has one. Do not invent a column. Ask Josh if
    `campaign_builds` should grow one.
12. `pulled_at` on backfill receipts is the backfill `written_at`.
    Surface a note; do not rewrite history.
13. Provenance gaps (`traced` 0, null `tam_count` / `rows_found`)
    stay as stored. Do not fake them.
14. Queue and recipe carry `sends_last_14d`.
15–17. Docs: $5 or above; working bar = under 1 interested per 2,000
    sends on every build; check `run_status` once per message or
    watch Slack — Claude in chat cannot wait two minutes.

**Why.** Cayden opened the queue and every row said skip because
days were n/a and n/a passed. `start_topup(powergryd, vciso)` died
on a missing file. The live pull record and receipts were already
there for every client. Josh: do not require a PowerGRYD-only file
pack; infer from tags plus notes. And let Cayden operate.

**Tradeoff.** First watch tick after deploy may open inferred
getleads lanes that are under the floor and still working. Physical
and incomplete-filter lanes park at size. Name to Email stays
paused. Bounce-by-build and a real pull-date column wait on Josh.

**Guard.** `src/guards/d45_ops_findings.test.ts`. Ask Josh.

## D46 — One policy layer: the Oct 8 rules, judged per campaign

**Decision.** Every rule a top-up decision depends on lives in `src/policy`
and nowhere else, and `evaluateCampaign(facts)` gives one verdict per
campaign with a one-line reason. The queue, the watch, the size step and
the start path call the same function. The rules, from the Oct 8 2026
rewrite brief:

1. **Never top up** SG Gabe Calls (4085158), SG Cayden Calls, SG Nurture
   (3122546). Ignore client `goliath` until told otherwise.
2. **Retired:** Parlay outside 4049046–4049064. **Dropped:** Insight
   Google SADA. **Paused:** Insight OEM Channel Reps. None of them starts,
   including from the watch.
3. **Targets** are ACTIVE Smartlead campaigns of the lane's own Smartlead
   client. COMPLETED, DRAFTED, PAUSED, ARCHIVED and another client's are not.
4. **Reply bar:** at least 1 interested per 2,000 sends, measured per
   campaign on lifetime sends. Zero positives never qualifies, however few
   sends. One reply under 2,000 sends is acceptable (D44). "Too early to
   judge" is not a pass. Josh's `/working` override wins either way.
5. **Minimum pool:** at least 1,000 net new leads available for the
   campaign, else `tam_filled` and not topped up. The skill's 200 "useful
   floor" stays as the gate's wording; the per-campaign number is 1,000 and
   a thin pool is reported, not parked.
6. **Pilot before sizing:** 200–300 vendor rows scored on title, industry,
   description, headcount band and geography; any scored dimension under
   80% stops that pool. A column missing from the export is "not scored".
7. **TAM source by ICP kind:** LinkedIn-native counts getleads and AI Ark
   People Preview on the same filters; within 10% is the TAM; one missing is
   `single_source`, not a mismatch. Non-LinkedIn sizes from the stored pool
   in the build record, never a getleads count, never 0.
8. **Sanity:** a pool more than 20× the build it repeats, or above a known
   market cap (about 40,000 MSPs; one in the low hundreds is too narrow), is
   a suspect filter. No company filter means no size from titles alone.
9. **Spend:** free proceeds; under $5 is Cayden; $5 or above is Josh; over
   the $25 day is Josh too. Loads reach Smartlead only when `loads_paused`
   is off and Josh approved the briefing.
10. **Parking is per campaign, never per run.** A campaign that fails is
    skipped with its gate and reason; the rest continue. A run with no
    qualifying campaign closes as sized with the report. The watch posts no
    not-working card; the queue and the lane log carry the reason.
11. A top-up repeats; it never widens bands, adds titles or industries, or
    switches vendors on its own.

**Why.** The rules were enforced in scattered places, some in code, some
in Cayden's head, and the owner gate and the sizer disagreed on net new.
One function, one answer.

**Tradeoff.** Campaigns Josh used to be asked about with a card are now
simply named in the queue with their reason; `/working on` is the way past
the bar. PowerGRYD MSP Owners, with 0 net new, closes as `tam_filled`
instead of waiting on a card.

**Guard.** `src/guards/d46_policy_layer.test.ts`. Ask Josh.

## D47 — Build records are the memory

**Decision.** Every pull, past and future, is a first-class `BuildRecord`
(`src/builds`): vendor, the exact query (titles or job function plus
seniority, industries, description terms, headcount bands, geography
including the fence, email status, max per company, fallback personas in
order), source kind (vendor search or a stored Maps / permit pool with its
count), the campaigns it fed, leads, interested replies, rows found and
imported, the method note, the confidence stamp, and a `reconstructed`
flag. Records are built from `topup.campaign_builds` and the pull
receipts; rows that share a label are one build. Performance is joined per
campaign from the Smartlead mirror: lifetime sends, positives, per 2,000.
`chooseBuildForCampaign` repeats the build that earned the replies, else
the latest repeatable build, else says the method cannot be reconstructed.
A record with titles but no company filter, a stored pool with no count, or
no source at all is marked not repeatable with the reason. Nothing is
guessed. `queryFingerprint` names the pool two campaigns share.
`campaign_history` is the operator's read of all of it.

**Why.** BCP pulled a 27,790-person generic IT pool and PowerGRYD a 1.08M
"MSP" pool because the record was thin and the service guessed. The next
pull must come from the build that worked, or stop and say why not.

**Tradeoff.** Builds whose method cannot be reconstructed are reported as
such and need Josh. No new table: records are computed from the view and
the receipts on read.

**Guard.** `src/guards/d47_build_records.test.ts`. Ask Josh.

## D48 — The planner, the caches, the lifecycle tools and the small surface

**Decision.**

1. **One planner sizes every target campaign of a lane at once**
   (`src/plan`). Campaigns are judged by D46 first; the ones that qualify
   are grouped into pools, one per distinct query; each pool is counted
   once and concurrently under the client's vendor cap (4 within a client,
   8 across); each pool is split across its campaigns by need; the same
   person is never planned into two campaigns.
2. **Queries are planned under the vendor timeout.** City fences are cut
   into slices of at most 45 and industry lists into slices of at most 12
   before any call; slices run concurrently; a disjoint sum is the count.
3. **As little vendor data as possible.** Counts before exports; the pilot
   is 250 rows; net new is a 100-row overlap sample scaled to the pool, with
   the method recorded; counts (24 hours) and pilot scores (30 days) are
   cached per query fingerprint on the size step (`pool_cache`) and reused
   while the recipe is unchanged.
4. **Every vendor call is on the step** (`vendor_calls`): vendor, action,
   ok, HTTP status, redacted message, time, rows; cached reuse is marked.
   The AI Ark reason that used to vanish is the first entry this exists for.
5. **Lifecycle:** `abort_run` aborts any open run (cancels running steps,
   returns claimed rows, resolves its cards, posts the receipt);
   `resume_run` gives the stopped step its attempts back and drives again.
   Steps already key work by run and campaign; a retry re-polls, it does
   not restart.
6. **The surface is fifteen tools and none returns a row or a file URL:**
   `topup_queue`, `campaign_history`, `size_client`, `approval_briefing`,
   `start_topup`, `run_status`, `list_runs`, `abort_run`, `resume_run`,
   `list_holds`, `resolve_hold`, `loads_paused`, `lane_state`, `lane_note`,
   `add_client_domains`. Retired: `sample_rows`, `variant_stats`,
   `campaign_registry`, `recipe_get`, `missing_piece_groups`,
   `register_queue_table`, `topup_recipe`, `topup_campaign_builds`,
   `topup_provenance_gaps`. `size_client` pilots and sizes one client in
   one call (a size-only run per lane, concurrently) and returns each
   lane's report and briefing. `approval_briefing` is Josh's one line per
   campaign, generated from the report.
7. **Slack is optional.** Posts are dropped when no token is set; no run,
   card or tool depends on a Slack channel.
8. `/health` keeps exposing the commit, build and start time (core-00).

**Why.** Sizing was one campaign at a time, one vendor call at a time,
with full exports where a count would do and repeated counts across
campaigns that share a pool; the run could not be stopped once started; the
AI Ark error was not logged; the surface had eighteen tools, one of them
returning rows.

**Tradeoff.** A cached count can be a day old; a changed recipe
invalidates it by fingerprint. The retired tools stop answering; callers
move to `campaign_history` and `run_status`.

**Guard.** `src/guards/d48_planner_surface.test.ts`. Ask Josh.

## D49 — Starts read the tags, and the babysitter sees a client in one read

**Decision.**

1. **There is no hand-written method per campaign.** A lane's campaigns
   are the ACTIVE rows `topup.campaign_registry` puts on that lane for
   that client. They join the inferred routing for every client, even
   when the pull receipt that named the lane still lists older campaign
   ids (`addRegisteredLaneCampaigns`). Parlay keeps the Sept 29 rule of
   D45. Nothing is removed by this step and nothing is invented: a row on
   another lane, a retired or paused row, and a never-top-up campaign stay
   out.
2. **Each campaign is pulled from its own build record** (D47): the
   source legs, `company_filters` and the method note in
   `topup.campaign_builds` and `campaign_method`. A campaign with no
   repeatable record is skipped with the missing tags named.
3. **`client_overview(client_tag)`** is the babysitter's first read: every
   campaign of one client with status, lane, lead flag, runway, untouched,
   the policy gate and reason, the build the service would repeat and
   whether it can, which tags it carries and which are missing, plus open
   runs, client-wide runway, the loads switch and a `next` line naming the
   next tool. Counts and short reasons only. `campaign_history` carries a
   `tags` block: the `campaign_method` legs, `missing_tags`, and
   `lead_provenance` counted by build label and confidence. No tool
   selects a lead column.
4. **The step 2 gate in the skill and the spine is the policy's floor:**
   at least 1,000 net new per campaign (D46), else the campaign line says
   TAM filled and that campaign parks. The recipe schema's `useful_floor`
   defaults to the same number.

**Why.** Josh, 2026-10-08: "There should not be a recipe for any person.
You should be reading the Supabase tags and notes so that you know what
to do", and "at least a thousand new contacts or it's not worth it". The
first watch tick after the rewrite wanted to refill three BCP IT AirPods
campaigns and the start refused them: the receipt that named the lane
listed twelve older campaign ids, while the registry and the build
records carried the three. The bot also had no single read for a client
and was told to read the queue, then history, then tags table by table.

**Tradeoff.** A registry row on the wrong lane now routes a campaign into
that lane's run; the registry repair and the policy gate are the guard,
and the report line names the campaign. The surface is sixteen tools, one
more than D48.

**Guard.** `src/guards/d49_tags_overview.test.ts`. Ask Josh.

## D50 — The registry lane, the stored pool, and a count gap that does not park

**Decision.** Three sizing rules, from the 2026-10-09 briefs.

1. **The lane is the one `campaign_registry` names.** `size_client`
   with `campaign_ids`, and `start_topup` with a campaign and no lane,
   open that lane. The first in-memory recipe whose routing mentions the
   id does not win. An id on no lane is said so, and no run opens on
   another lane. Every requested campaign is on a report line.
   Campaigns that share one stored pool split `plan_rows` so the sum
   does not exceed `tam_left`.
2. **A non-LinkedIn ICP sizes from the stored Maps or permits pool on
   the build, including when the route kind is maps or permits.** A
   pool that cannot be read is `tam_source_missing`. TAM 0 is not a
   filled market unless the pool was actually read. Abort releases rows
   left in `verifying`, `claimed`, `reserved`, or `pulling` and reports
   the count. The campaign line carries `tam_source`, `pool_rows`,
   `already_held`, and `already_contacted`.
3. **A LinkedIn count gap does not park.** Within 10% the counts agree.
   From 10% to 25% the TAM is the lower count (`mismatch_minor`). Over
   25%, a 250-row AI Ark pilot that passes 80% on title and industry
   makes the TAM the AI Ark count (`ai_ark_wider`) and the extra people
   are that side's; otherwise the TAM stays the getleads count
   (`getleads_only`). `reason` stays null. Both counts and both filter
   sets are on the line. BCP compares the IT-only pair, then adds the
   COO fallback of the side that won. People Preview is one credit per
   page. The page is dropped.

**Why.** On 2026-10-09, `size_client` opened the first recipe that
mentioned a campaign: PowerGRYD 4005226 went to `msp_sec_leads`,
4005228 to `name_bank`, TechEvo 3730560 to `govt_sub`, and Peterson C2
and C3 to `c1_general_contractors`. `topup_queue` already showed the
registry lanes. The same day EMCOR E Small Ops, which had sized at
about 17,600 from a stored Maps pool of 18,323, sized to 0 and parked
`tam_filled` after one live maps call. LinkedIn lanes parked
`tam_mismatch` whenever getleads and AI Ark differed by more than 10%,
including PowerGRYD MSP Owners at 1,262 versus 1,466.

**Tradeoff.** A gap over 25% can spend a few People Preview credits to
score 250 rows before the TAM is chosen. A registry row on the wrong
lane still routes there. A stored yield is reported when the vendor
query cannot be repeated; it does not invent titles.

**Guard.** `src/plan/planner.test.ts`, `src/mcp/sizeClient.test.ts`,
`src/policy/campaign.test.ts`, `src/guards/d50_lane_pool_gap.test.ts`.
Ask Josh.

## D51 — Nothing starts on its own, and every paid call is approved first

**Decision.**

1. **The watch observes.** It still reads the mirror on its schedule and
   judges every lane by the policy, and it logs what it would have started
   (`would start`, with the campaigns and the reason), but it never opens a
   run. Grok bot, or Cayden through Grok, starts runs with `size_client` or
   `start_topup`.
2. **Every paid vendor call waits for a named approval.** The auto cap on
   the service is zero (`AUTO_SPEND_CAP_USD=0` on Railway): a free call
   proceeds; any call with a worst case above zero posts a spend card that
   `resolve_hold` answers, under $5 by Cayden, at $5 and above by Josh. The
   ledger records the amount and who approved. The rebuild replaces the
   card with `approved_by` on the verb that spends.
3. **Under 1,000 leads available the line says "the TAM for this campaign
   is exhausted."** The step 2 gate in the skill and the spine no longer
   says never to declare a pool exhausted.
4. **Deep Roots Capital is a client,** `deep_roots`, Smartlead client
   597783. The fourteen Peterson and Insight registry rows the mirror could
   not place carry their clients' Smartlead ids.

**Why.** Josh, 2026-10-09: Grok bot is the reasoning layer and the app is a
flat pipeline. "Grok is the one who's going to do all of this." "Somebody
needs to approve spend before you do it." On 2026-10-08 the watch opened a
run for BCP IT AirPods on its own on the first tick after a deploy, and
Cayden met the app's own judgement instead of Grok's.

**Tradeoff.** A low campaign waits for Grok instead of filling itself. A
size run stops on a five-cent AI Ark call until someone taps. D27 and D38
are superseded for starting; their judgement still shows in `topup_queue`
and `client_overview`.

**Guard.** `src/guards/d51_grok_starts.test.ts`. Ask Josh.

## D52 — The reads and the verbs: Grok bot reasons, the service moves rows

**Decision.**

1. **The reads** (`campaigns`, `campaign_record`, `sources`, `count`,
   `held`, `jobs`, `job`, `spend`) return what Supabase and the vendors
   hold: lifetime sends and positives, the receipts with their four source
   legs and `company_filters` as stored, the method notes, the stamped
   leads counted by label and by leg, a count on a source with the filters
   Grok gives, how much of a pool the client already holds, the job log and
   the spend. Each answer states the rule it bears on and gives no verdict.
2. **The verbs** (`pull`, `suppress`, `enrich`, `verify`, `normalize`,
   `qa`, `stage`, `import`, `write_receipt`, `abort`) run one stage of the
   existing pipeline on a job and return counts. A job is one run row for
   one campaign with a job recipe built from Grok's inputs and the service
   defaults. Nothing chains: the next verb runs when Grok calls it, and the
   orchestrator never drives a job. A step that needs money posts a spend
   card and the verb returns the estimate; the same verb with `approved_by`
   resolves that card through the console as the named person's tap,
   records who, and runs. `import` refuses while loads are paused.
3. **The job recipe is filed under its own lane name**
   (`client.job_<campaign>_<stamp>.v1`), so a lane lookup never returns a
   job recipe as a lane's recipe.
4. **No read or verb returns a lead row or a file URL.** The record drops
   any column that is not a count, a label or a note.

**Why.** Josh, 2026-10-09: the app is dumb, a flat pipeline; Grok bot is
the reasoning layer; it reads the Supabase tags and notes, works out how
the leads were pulled the first time, and runs the same pull again. The
audit found the tags on 86 of 90 active campaigns and the method notes on
the same; the app only needed to show them and move rows on request.

**Tradeoff.** Two surfaces answer until the rebuild removes the old one.
A job is one campaign at a time. The old `size_client` and `start_topup`
still infer from a lane; the verbs do not.

**Guard.** `src/guards/d52_reads_verbs.test.ts`. Ask Josh.

## D53 — The dumb half: delete the reasoning, keep the pipeline, one short canon

**Decision.**

1. **Deleted.** The runway watch and its cron, the planner and the sizing
   step, the recipe inference (receipt → recipe, Parlay, BCP, PowerGRYD,
   Peterson special cases, file recipes), the derived policy gates and
   the per-step dollar caps, the Slack console, cards router and daily
   digest, the trigger and flip stages, and the old MCP tools
   (`topup_queue`, `client_overview`, `campaign_history`, `size_client`,
   `approval_briefing`, `start_topup`, `run_status`, `list_runs`,
   `abort_run`, `resume_run`, `list_holds`, `resolve_hold`, `lane_state`,
   `lane_note`, `add_client_domains`). Guards D34 to D52 that locked that
   code are gone with it; the decisions stay in this ledger as history.
2. **Kept.** The twelve stages from pull to post_import, run one at a time
   by the verbs on a job; the spend gate and ledger; the card table and
   the role line (D18), now `src/console` with no poster; the lane event
   log; the vendor clients; the reads and the verbs (D52).
3. **The surface is the canon tools only:** `canon`, `campaigns`,
   `campaign_record`, `sources`, `count`, `held`, `jobs`, `job`, `spend`,
   `holds`, `loads_paused`, `pull`, `suppress`, `enrich`, `verify`,
   `normalize`, `qa`, `stage`, `import`, `write_receipt`, `abort`,
   `resolve`, `note`. `CANON.md` is served as the MCP instructions and by
   `canon`.
4. **The verify stage no longer blocks on its spend card.** It posts the
   card and returns `waiting`; the verb with `approved_by` resolves it and
   the next call proceeds on `run_steps.approved_cents`.
5. **No client is special-cased in code.** The registry repair retags and
   sets the lane from receipts for every client the same way. The MSP
   headcount drop and the same-offer exclusion that only ever applied to
   one lane are gone; a record that needs them says so in its notes and
   Grok applies them through the filters it passes.
6. **Version 1.0.0.** The canon numbers that remain in code are the reply
   bar (1 per 2,000), the net-new floor (1,000), the rows per job (1 to
   2,000), the auto cap ($0), the daily backstop ($25) and the never-top-up
   list.

**Why.** Josh, 2026-10-09: "this app basically needs to be completely
stripped away and totally rebuilt … there should be no recipes or no
formulas … Grokbot should be able to figure out how I initially pulled
the leads … This app is dumb, flat pipeline … a few canon rules like the
1 to 2,000, the TAM size … a canon for Grokbot." And after Phase 2: "do
all the steps." The audit counted about 20,400 source lines, roughly
12,000 of them deciding and 8,000 moving rows. The deciding half made the
wrong calls for Cayden on 2026-10-09 morning and was the thing to remove.

**Tradeoff.** Nothing tops up a campaign unless Grok or a person calls the
verbs. A verb that polls a vendor (verify) holds its MCP call open while
the vendor runs. The old queue and overview are gone; `campaigns` and
`campaign_record` answer the same questions without a verdict.

**Guard.** `src/guards/d53_canon.test.ts`. Ask Josh.


## D54 — Cold call campaigns are ignored

**Decision.** A Smartlead campaign marked as cold call is not an email
campaign and the service ignores it: `campaigns` leaves it off the list
(counted under `ignored_cold_call`), `campaign_record` answers with the
reason, and `pull` refuses to open a job on it. The mark is in the
campaign name: "Cold Call", "Calls" (Gabe Calls, Cayden Calls),
"Post-call", "calling", "dialer". No column marks it on
`public.campaigns` or the registry today; if one appears, it joins the
check. Also pinned here: a job pulls at most 2,000 rows, as the canon
said and the `pull` schema did not.

**Why.** Josh, 2026-10-09: "this app should ignore any campaign marked
as cold call." The two stale goliath runs were aborted the same day.

**Tradeoff.** A name that says "call" for another reason is ignored too.
Rename it or ask Josh for a narrower mark.

**Guard.** `src/guards/d54_cold_call.test.ts`. Ask Josh.


## D55 — Leftovers: where past pulls left rows, as counts

**Decision.** A read, `leftovers(client_tag?)`, lists for each client the
stores where an earlier pull left rows that may never have been sent:
the LeadPipe lane table (`lp.<tag>_ingested_leads`) by `lead_status` and
`source_label`; the client schema (`client_<tag>.companies`, `.contacts`,
`.leads`) with how many rows carry an email or a domain and the first
status column grouped; the waterfall tables in `public`
(`<tag>…_wf_companies`, `_wf_contacts`, and the older `<tag>_contacts`);
the people-waterfall statuses in `public.wf_people_status`; and the
scratch tables under `lp.<tag>_*`, by planner estimate, the largest
twenty-five. Counts only. No value is selected, no vendor is called,
nothing is moved. PermitStack lists (another project), the Maps scraper's
own store, and getleads and AI Ark (no store) are named as not reachable.

**Why.** Josh, 2026-10-09: "sometimes I have extra leads sitting in there
… I would love to have all that noted so that Grokbot understands." The
method is already in the receipts' notes (137 of 138 on active
campaigns); what was missing was where the rows are.

**Tradeoff.** A table name is the only signal of what a scratch table
holds. The read reports it with its size; the receipt notes say what it
was for. Exact counts on big tables can be slow; a count that fails
falls back to the estimate and says so.

**Guard.** `src/guards/d55_leftovers.test.ts`. Ask Josh.


## D56 — Phones are kept

**Decision.** A phone found by any step is kept to the end. Migration
0018 adds `phone`, `phone_type`, `wf_phone` and `wf_phone_type` to every
`lp.<tag>_ingested_leads` table (through `topup.ensure_lead_columns`,
so tables LeadPipe provisions later get them at boot) and `phone`,
`phone_type` to `public.leads_staging`. Ingest passes LeadPipe a header
map so a vendor's phone column (`mobile_phone` on getleads, `cellphone`,
`phone`, `phone_number`, `mobile`, `direct_phone`) lands in `phone`, and
counts `with_phone`. The domain and email waterfalls write `wf_phone`
and `wf_phone_type`; after each, the service copies them onto `phone`
and `phone_type` where empty. The people waterfall's `cellphone` and
`line_type` travel with the name it found. The stage carries `phone` and
`phone_type` into staging and counts `with_phone`. Nothing blanks a
phone. `leftovers` reports `with_phone`, `need_phone` and whether a store
has a phone column at all. Phones stay redacted in logs (D2).

**Why.** Josh, 2026-10-09: "make sure that this thing doesn't throw away
phone numbers if we find them. Because now that I have cold calling,
I'll be doing more of that." Before this, no lane table and no staging
row had a phone column, so every phone a vendor or a waterfall returned
was dropped at ingest.

**Tradeoff.** Two things are outside this repo and unverified: whether
LeadPipe's `ingest_csv` honours `column_map` for a header it did not
already know, and whether the Smartlead server's `start_lead_import`
passes a staging `phone` to `phone_number`. The first real job shows
both: `with_phone` on the ingest and stage counts, and the campaign's
leads in Smartlead. If either is zero while the vendor returned phones,
that server needs the one-line mapping.

**Guard.** `src/guards/d56_keep_phones.test.ts`. Ask Josh.

## D57 — Maps count and pull read the stored pool by plan_id

**Decision.** `count` and `pull` with `source=maps` read the stored pool
in `client_<tag>.maps_raw` (generic per client). Scope is the `plan_id`
on the receipt's `company_filters`, plus the categories list. An ICP
filter view the receipt names (`icp_filter` / `icp_view`, e.g.
`client_emcor.v_lane_e_final`) is applied when it lives in that client
schema; companion `v_*_companies` and `v_*_needs_domain` views, when
present, are the ICP pool. `filters_used` is `plan_id`, categories, and
the view actually applied. The answer is pool size, already loaded
(live `public.leads` on campaigns named by a receipt that carries this
`plan_id`), and net new. Rows move server to server (`INSERT … SELECT`
into `lp.<tag>_ingested_leads`). The service never calls Maps
`pipeline_stats` or `sync_to_supabase` for this, never scopes by ZIP or
`client_tag` alone, never returns a lead row, and never writes
`dl_status`, `sg_exclude`, or `skip_*`.

**Why.** On 2026-10-09, `count(source=maps)` for EMCOR Lane E
(`plan_id` `custom-1789679826`, 404 Bay Area ZIPs × 25 categories)
returned 0 per category. The live call sent only categories and
`states=[]` to the Maps service's `pipeline_stats`, which scopes by
state / `client_tag`. The receipt says scope by `plan_id`. The stored
pool was ~34,878 in `client_emcor.maps_raw`.

**Tradeoff.** A client with no `maps_raw` cannot be counted this way;
the answer names the missing table. A named ICP view in another
schema is refused. Already-used is the live `public.leads` count on
campaigns the receipt listed, which can sit a few rows off the
receipt's `rows_imported`.

**Guard.** `src/guards/d57_maps_plan_id.test.ts`. Ask Josh.

## D58 — LeadMagic is dropped

**Decision.** Josh dropped LeadMagic on 2026-10-08. This service never
calls it, never prices it, and never writes its names on a new recipe or
a new receipt.

1. **Email ceiling.** A stored `email_max_tier` of `leadmagic` (or `lm` /
   `lead_magic`) is a legacy ceiling: replay as `aiark` (the old spend
   boundary — stop before Prospeo — minus the dead vendor) and warn.
   New job recipes default to `aiark`. Zod preprocess maps the old name
   so a new recipe cannot store it. `find_emails` sends the mapped
   ceiling to the Email Waterfall.
2. **People.** The puzzle step calls Find Named Person with no
   `skip_tiers` and no LeadMagic max_tier. That service's default order
   is `site_staff → cache → discolike → prospeo_search → aiark_people`.
   A stored person source of `leadmagic_employee_finder` (and the old
   aliases) maps to `people_waterfall` plus that order, with a warning.
   The spend gate uses the Prospeo search and AI Ark people prices from
   the 2026-10-08 receipt, not the old 5¢ LeadMagic row.
3. **History stays.** `topup.pull_receipts` and `lead_provenance` and
   their CHECK constraints still allow the old names. Seven historical
   receipts hold `email_max_tier='leadmagic'`. They are not rewritten.
   `campaign_record` shows the stored value and a `legacy_warnings`
   line. `write_receipt` maps before insert so a new row never stores
   the old names.
4. **Live recipe SQL is review-only.** `docs/drop-leadmagic.sql` updates
   `topup.lane_recipes` for `vasco / signal_warranty_admin_hiring` from
   `max_tier=leadmagic` to `aiark`. It is not run from this PR, from
   migrate, or from a deploy. It never touches `dl_status`,
   `sg_exclude`, or `skip_*`.
5. **Counts only.** Nothing in this change selects a lead column or
   writes a lead status.

**Why.** The LeadMagic key still authenticates with 0.2 credits. The
people waterfall's default order still named `leadmagic_employee`; a
missing key fails the whole job. The only latest receipt that would
replay `email_max_tier=leadmagic` is vasco `signal_warranty_admin_hiring`.
The Email Waterfall default `max_tier=leadmagic` also stops before
Prospeo, so the mapped ceiling is `aiark`, not a wider spend.

**Tradeoff.** A replay of an old receipt spends on AI Ark / Prospeo /
DiscoLike instead of LeadMagic. Coverage is the people service's new
default, not a guessed substitute for a roster pull. The live vasco
recipe stays `leadmagic` in the database until someone runs the review
SQL.

**Guard.** `src/guards/d58_drop_leadmagic.test.ts`. Ask Josh.

## D59 — Maps ICP binds are typed; companions join maps_raw for plan_id

**Decision.** Every bind on a maps pool query is typed (`$1::text`,
`$2::text[]`). Companion ICP views that have no `plan_id` (Lane E:
`v_lane_e_companies` / `v_lane_e_needs_domain`) join
`client_<tag>.maps_raw` so `plan_id = $1::text` is in the SQL. The
service never sends `$2` without a typed `$1`. Scrape categories are
not applied again on the companion union — those views are already the
ICP pool (D57). `filters_used` still lists the categories the receipt
carried.

**Why.** After D57 shipped, `count(source=maps)` without an ICP view
worked (emcor raw 34,805). The same call with `icp_filter` /
`v_lane_e_final` failed: Postgres `could not determine data type of
parameter $1`. The companions have `place_id` and `main_category` but
no `plan_id`, so the SQL used `$2::text[]` for categories and never
mentioned `$1`.

**Tradeoff.** Re-applying the receipt's 25 scrape categories on the
Lane E companions would cut the live pool from 18,322 to 8,972. That
is a second filter the ICP already applied; Josh can ask for it.

**Guard.** `src/guards/d59_maps_icp_binds.test.ts`. Ask Josh.

## D60 — The ICP website gate is a verb

**Decision.** `icp(job_id, approved_by?)` runs after `suppress` and
before `enrich`, on spine step 5, as the skill `icp-website-gate` says
(step 5.5 of lead-list-build). It takes the job's distinct domains
(company_domain, domain, website, or the email's domain), joins them to
a batch named after the job in `client_salesglider.icp_site_text`, has
the `icp-site-fetch` edge function read each site (free, up to three
calls side by side), has `icp-llm` ask Jev for one category per site
(about $0.11 per 1,000, one call at a time), and has `icp-disco-fallback`
ask DiscoLike about the sites the fetch could not read (about $0.0038
each, one task at a time). The worst case is priced from the table (Jev
on every domain, DiscoLike on a tenth) and waits for a named approval
(D51). The verdict is written onto the rows as `icp_gate` yes / no /
unknown with `icp_gate_label` and `icp_gate_at`; no and unknown are
suppressed with the reason `off_icp` or `icp_unreadable` and stay in the
table. Rows with no domain are left untouched and counted, so `enrich`
then `icp` again covers them. The per-client label set lives in
`topup.icp_variants` (`jev_variant`, `disco_icp`), seeded for
salesglider, emcor and deep_roots; a client without a row parks with the
reason. The function keys live in Railway. The lane event line carries
the label counts and at most ten flagged and four passed domains with
their label (D2).

**Why.** Josh, 2026-10-09, asked for the new skill to be part of the
flow. The skill measured about 22% junk on call lists and a category
pick at 92.7% accuracy; cutting the junk before enrichment saves the
enrichment money and the send reputation.

**Tradeoff.** The verb holds its MCP call open while the fetch and Jev
run (about three minutes per 2,000 sites). A client whose buyer is not
yet a label set cannot be gated until someone writes one in `icp-llm`
and a row in `topup.icp_variants`. The three functions share the
project's 60-connection cap with the live Allo hooks; the limits in the
skill are the limits in the code.

**Guard.** `src/guards/d60_icp_gate.test.ts`. Ask Josh.

## D61 — Maps pull is idempotent; pull returns a job id; nothing opens as the watch

**Decision.** Three things, one rule.

1. **Idempotent maps insert.** `copyMapsPool` writes `lp.<tag>_ingested_leads`
   with `DISTINCT ON (email)` inside the batch and `ON CONFLICT (email) DO
   NOTHING` when that table has a unique email index. Skipped rows (batch
   dups and emails already in the table) are counted as `already_held`.
   The pull does not fail on `emcor_ingested_leads_email_uidx`. Counts
   only; no row comes back.
2. **Pull returns at once.** `pull` opens the job, returns `job_id` with
   `status` started, and runs pull then ingest in the background. Poll
   `job(job_id)`. Grok still calls the verb; nothing chains the next one.
   A spend card still waits for `approved_by` on a later `pull(job_id)`.
3. **The watch cannot open a run.** `opened_by` of `watch` / `the watch`,
   or trigger `runway` / `scheduled`, is refused. Boot does not drive
   leftover watch runs. The old runway watch is gone from this repo
   (D53); this stops it if a stale image or a leftover caller tries again.

**Why.** Job `89f5708d` (emcor #4037475, maps, plan `custom-1789679826`)
failed at pull: `duplicate key value violates unique constraint
"emcor_ingested_leads_email_uidx"`. The same MCP `pull` also timed out
waiting for the 2,000-row copy. Separately, run `dc241965` opened today
with `opened_by=watch`, trigger `runway`, event *"opened by the watch
(client-wide runway low, still working)"*, then the old size/pull
pipeline. That violates canon rule 5. `src/watch` is already deleted;
the live Railway image at 13:19 UTC still opened ~20 watch runs.

**Tradeoff.** A maps pull of 2,000 unique emails that are already in the
ingest table inserts 0 and reports `already_held` 2000; it does not keep
scanning for more new ones past `max_rows`. `pull` no longer returns the
final pull counts on the first call — `job(job_id)` does. Railway cron
and a second replica cannot be turned off from this repo; they are
named in the PR.

**Guard.** `src/guards/d61_maps_pull_async_watch.test.ts`. Ask Josh.

## D62 — A background maps pull cannot hang

**Decision.** Four things, one rule.

1. **The copy is a short query.** `copyMapsPool` reads the named ICP view
   (or `maps_raw`) with `plan_id`, `keep_final` when present, and
   `LIMIT`. It does not join companion `v_*_companies` ∪
   `v_*_needs_domain` for the insert. Those companions stay on the count
   path (D57, D59).
2. **Dedupe works without a unique index.** The batch is `DISTINCT ON
   (email)`. Emails already in `lp.<tag>_ingested_leads` are skipped with
   `NOT EXISTS`. `ON CONFLICT (email) DO NOTHING` is added only when a
   unique email index exists. Skipped rows stay `already_held`.
3. **The copy has a statement timeout.** The write transaction does
   `SET LOCAL statement_timeout` to 45 seconds
   (`MAPS_COPY_STATEMENT_TIMEOUT_MS`). The cancel writes through as an
   error. Ask Josh if 45s is wrong.
4. **A background verb always ends.** `JobRunner.begin` no longer only
   logs. A throw or a 90 second job timeout (`VERB_BACKGROUND_TIMEOUT_MS`)
   writes `last_error` on the running step, closes the job as `failed`,
   and leaves a lane event. A job already `failed` is not rewritten to
   `done`. Ask Josh if 90s is wrong.

**Why.** Job `44fa45d9` (emcor #4037475, plan `custom-1789679826`, ICP
`v_lane_e_final`, `max_rows` 2000) sat at `pull=running` for 12+ minutes
with empty counts and no `last_error`. Railway logs went silent after
`run_opened` and the legacy-tier event. The unique email index on
`lp.emcor_ingested_leads` exists; `leadtopup_app` has no
`statement_timeout`; `lock_timeout` is 0. After abort, `pg_stat_activity`
still showed the windowed CTE as `active` with no `wait_event` — CPU, not
a lock, not pool exhaustion. EXPLAIN of the companion insert is a
Parallel Seq Scan of `maps_raw` with the ICP regex evaluated twice, then
joined back to `maps_raw`; `LIMIT 2000` cannot stop that. `begin()`
caught errors only to log them, so a hung query left the step running.

**Tradeoff.** Count still uses the companion union (companies ∪ needing
domain). Copy from the named view with `keep_final` may include more
place_ids than that union (it is not `DISTINCT ON` domain). A maps pull
of 2,000 rows that are already held still reports `already_held` 2000
and does not keep scanning. The 45s / 90s numbers are ours until Josh
names others. Abort still does not `pg_cancel_backend` an in-flight
query; the statement timeout is what stops it.

**Guard.** `src/guards/d62_maps_pull_timeout.test.ts` and the PGlite
cases in `src/canon/mapsPool.pg.test.ts`. Ask Josh.

## D63 — Suppression recycle and POD inbox exclusion (reserved)

**Decision.** Reserved for PR #40 (`cursor/suppress-client-inbox-a879`).
That PR owns D63 (client-only suppress, 6-month recycle, POD inbox
exclusion). This stub exists so D64 can land on a branch off main
without a gap in the ledger. Do not implement D63 here.

**Why.** #40 is open and unmerged. Meta requires contiguous numbers.

**Tradeoff.** Two D63 headers will collide if #40 merges without
replacing this stub. #40 should take this number; this PR does not
ship suppress behaviour.

**Guard.** None on this branch. Ask Josh.

## D64 — Job 46b1c941: approve, label, used, export, size, pull

**Decision.** Seven things, one rule, from job `46b1c941` (emcor maps
#4037475).

1. **`approved_by` runs the paid step.** Puzzle waits as
   `spend_approval`, not a parked card. The gate sees `approvedCents`.
   `approved_by` records the amount, closes the spend card and any
   leftover parked card for that step, and runs Find Named Person. The
   queue is what is on the table now, not only this attempt's updates
   from `needs_email`. A step that did not run, or processed 0 of N
   queued rows, is failed/blocked with `last_error`, never `done`.
   `find_emails` does not skip while `needs_person` or `needs_domain`
   remain.
2. **ICP labels are tokens.** Jev's `answers.category.choice` (then
   `reason` if it is a snake_case token `/^[a-z][a-z0-9_]{2,80}$/`) is
   the label. An unparseable sentence is `null` plus
   `icp_label_unparseable`. Never the raw sentence, never slugged.
3. **The spend card follows the estimate.** A re-quote updates the open
   card's `rows` and `worst_case_cents`. Completion writes
   `actual_cents`. A successful finish clears `last_error`.
4. **Maps used is a union.** `count` reports `already_live` (receipt
   campaigns), `already_ingested` (`lp.<tag>_ingested_leads`),
   `already_contacted` (this-client sends in 90 days +
   `public.suppression`), `already_used` as the distinct union, and
   `net_new`. Counts only. 90 days matches suppress on main; ask Josh
   if D63's six months should replace it.
5. **`lp_export` unwraps `{ok, tool, result}`.** Read
   `result.signed_url` / `result.row_count`; still accept the flat
   shape. A recorded verify approval is reused on retry. A third
   verify failure does not park the job when that approval is on the
   step; `verify(job_id)` resumes.
6. **`size(client_tag, campaign_id, source, filters)`** is a free
   dry-run read. It walks the entire maps pool the way `count` does,
   reports already held, suppression drops by reason, and net new.
   Opens no job, spends nothing, does not block the lane. Counts only.
7. **Maps pull skips held emails before `max_rows`.** Successive pulls
   advance through the pool instead of re-windowing the same already-held
   slice.

**Why.** Job `46b1c941`: `enrich(approved_by='Josh')` for a $0.67 Find
Named Person estimate marked puzzle done on attempt 2 with 0 people /
0 domains, never recorded the approval, left `last_error` 'over the
auto cap, Ask Josh', left parked card `f19dbfae` open, and skipped
`find_emails` while 19 rows sat at `needs_person`. Cap check ran
without `approvedCents`; classify only looked at `needs_email`;
`finish()` reported done. ICP stored Jev's raw sentence on 24 rows
(`coalesce(reason, model)`). The ICP spend card kept $0.41 after the
estimate fell to $0.17; `actual_cents` stayed unset (about 13¢). Maps
count said 12,305 net new; a 2,000 pull gave 815 new and 333 survived
suppression (473 already contacted) because used ignored ingested and
this-client prior contact, and `LIMIT` ran before the held skip.
Verify failed twice on `lp_export returned no signed_url/row_count:
["ok","tool","result"]` with Josh's $1.40 already on the step.

**Tradeoff.** Maps used components need `maps_raw.email`; without it
the count falls back to live campaign leads only. `size` is maps-only;
getleads still uses `count` + `held`. Verify with a recorded approval
never parks on attempt cap — a broken vendor can retry indefinitely
until someone aborts. Ask Josh if that should be a card instead.
Pull of 2,000 now prefers unseen emails; `already_held` is the
pre-insert dest∩pool count, not `windowed - inserted`.

**Guard.** `src/guards/d64_enrich_icp_count.test.ts`. Ask Josh.

## D65 — Job 46b1c941 after #42: size, approve, QA count, reopen, Lane E

**Decision.** Five things, one rule, from the same EMCOR job after D64
shipped (`da77102`).

1. **`size` is async and the suppress pass is one aggregate JOIN.** The
   MCP call returns a `size_id` at once (`status` started). Poll
   `size(size_id)`. Opens no job, spends nothing, does not block the
   lane. The suppress-by-reason SQL LEFT JOINs the positive / DNC /
   wrong-person / list / bounce / prior-contact / offer sets and
   `count(*)`s. It does not run a correlated EXISTS per pool email.
   The query has a 45s statement timeout
   (`SIZE_STATEMENT_TIMEOUT_MS`). Ask Josh if 45s is wrong. A restart
   loses an in-flight size — call `size` again.
2. **Approval is idempotent per step / approver / amount.**
   `approveStep` stores `greatest(approved_cents, this amount)`. A
   second `approved_by` of the same person and the same cents does not
   add and does not write a second lane event. Two Josh taps of $1.40
   stay $1.40, not $2.80.
3. **A QA hold count is this job.** Groups are `run_id = $1` and
   `lead_status = 'qa_hold'`. The count is distinct rows of the job,
   never the lane table and never multiplied by the
   `merge_field_empty` array (147 rows × 4 empty fields was 588 on
   card `419e7169`).
4. **A pre-D64 false `done` can be reopened.** If a step is `done` but
   rows are still queued for it (`needs_person` / `needs_domain` on
   puzzle, `needs_email` on find_emails, merge-field `qa_hold` on
   normalize), or it is `done` with 0 of N processed, the verb resets
   the step, closes its leftover parked card, and runs. Job
   `46b1c941` may call `enrich` again for the 19 `needs_person` rows
   and close parked card `f19dbfae`.
5. **Lane E role-inbox.** `info@`, `office@` and the listed locals take
   company from the Maps business name (`title` on the ingest row;
   maps copy also picks `title` for `company_name` when `company` /
   `name` are absent). First-name / greeting fallback is
   `recipe.normalize.first_name_fallback`. Default is unset: the hold
   for a missing first name is unchanged. Josh decides the string.
   Normalize re-processes this job's `qa_hold` rows that carry
   `merge_field_empty`.

**Why.** After #42: `size` for EMCOR Lane E (~18k pool, 404 ZIPs × 25
categories) hit the ~60s MCP limit on the correlated EXISTS walk.
Two `verify(approved_by='Josh')` calls added $1.40 + $1.40 on the
step (`approveStep` was `approved_cents + $3`). QA card `419e7169`
said 588 leads on a 147-row job because `holdGroups` joined
laterally to `merge_field_empty` and `count(*)`d the explosion.
`enrich` refused with *every step already done* while 19 rows sat at
`needs_person` and parked card `f19dbfae` stayed open — pre-D64
puzzle had finished as done. Normalize held all 147 for empty
`first_name_n` + `company_n`: Maps business name landed in `title`,
not `company_name`, and role inboxes have no person.

**Tradeoff.** Size results live in the one replica's memory; a
restart loses an in-flight `size_id`. The greeting is not filled
until Josh sets `first_name_fallback`. Reopening a false done still
needs Grok to call the verb; nothing starts on its own. Ask Josh
if the role-inbox local set should grow, or if size should persist
to a table.

**Guard.** `src/guards/d65_emcor_job_fixes.test.ts`. Ask Josh.

## D66 — People-waterfall domain view, and a step reopens on a rules change

**Decision.** Two leftovers on job `46b1c941` after D65 shipped
(`1955dad`).

1. **Find Named Person reads a view that exposes `domain`.** Shared RPC
   `public.ew_read_source` (email-waterfall
   `supabase/migrations/003_ew_source_rpcs.sql`; used by
   find-named-person-waterfall `people_waterfall/source.py`) SELECTs the
   columns it is given. People waterfall's map is `domain` / `website`
   only, and `count_source_with_domain` hardcodes `domain is not null`.
   `lp.emcor_ingested_leads` (and the other lane tables) store the host
   as `company_domain`. Topup CREATE OR REPLACE VIEWs
   `lp.<tag>_ingested_leads_ew` (`t.*, domainSql as domain`) and hands
   that name to `resolve_people` / `enrich_waterfall`. No ALTER of the
   live lane table. Migration `0020_ingested_ew_domain_view.sql` is the
   durable function; it is **unapplied** until Josh says so. The other
   repos are not edited. If that side should grow `company_domain` as a
   domain candidate, the change is
   `people_waterfall/source.py` `FIELD_CANDIDATES["domain"]` and
   `count_source_with_domain` (use the mapped column, not the literal
   `domain`). Ask Josh before touching those files.
2. **A done step reopens when its rules hash changed, or when
   `force=true`.** `run_steps.counts.rules_hash` is the version the step
   last ran under (`STEP_RULES` in `src/jobs/rules.ts`). Normalize's
   hash is `d66:role-inbox-maps-name`. A call whose stored hash is
   missing or different resets the step and runs it, so D65's Maps-name
   company fill reaches the 147 already-done holds. `force=true` on a
   verb does the same for that verb's steps even when the hash matches.
   D65's queued / 0-of-N reopen stays.

**Why.** After #43: people waterfall failed with `column "domain" does
not exist in RPC ew_read_source on lp.emcor_ingested_leads`. Topup
passed the raw ingest table with no column map; `resolve_people` does
not accept `map`. Normalize after D65 returned `done` with the same
147 held — the step was already `done` under the pre-hash contract, so
the runner skipped (or re-ran the same stored hash) and the new
company fill never wrote. A rules hash plus `force` is the reopen
that D65's queued heuristic missed.

**Tradeoff.** The `_ew` view is created at call time; a role that
cannot CREATE VIEW in `lp` will fail the people step until 0020 is
applied. Writeback ALTER against the view falls back to the people
waterfall sidecar (`public.wf_people_status`); names still land in
`public.<tag>_wf_contacts`. `force` is a named opt-in, not a default.
Ask Josh if the view should be a generated column on the lane table
instead, or if people-waterfall should take `map`.

**Guard.** `src/guards/d66_people_domain_normalize_rerun.test.ts`. Ask
Josh.

## D67 — No runtime DDL; Maps company is `maps_raw.name`

**Decision.** Two leftovers on job `46b1c941` after D66 shipped
(`eb62bf6`).

1. **The service never CREATE / DROP / ALTER.** D66's
   `ensureEwDomainSource` ran `DROP VIEW` / `CREATE VIEW` in schema
   `lp`. `leadtopup_app` cannot CREATE there (`permission denied for
   schema lp`). We do not grant CREATE or USAGE extras on `lp`.
   `ew_read_source` (and `dw_read_source`) SELECTs identifier columns
   only — no aliases — so we cannot hand `company_domain AS domain`.
   People waterfall does not accept `map`. The fix is a one-time,
   non-destructive migration `0021_ingested_ew_domain_views.sql` that
   creates `topup.<tag>_ingested_leads_ew` (`select t.*, company_domain
   / email host as domain`) for every existing `lp.*_ingested_leads`
   that has no `domain` column, plus SELECT/UPDATE on those views to
   `leadtopup_app`. **Unapplied until Josh says so.** The service
   looks the view up (`to_regclass` / `information_schema.tables`) and
   fails with "apply 0021, ask Josh" when it is missing. 0020 is a
   no-op that drops `topup.ensure_ingested_ew_view` if it ever landed.
   The other-repo alternative, if Josh prefers that to applying 0021:
   `people_waterfall/source.py` add `company_domain` to
   `FIELD_CANDIDATES['domain']` and make `count_source_with_domain`
   use the mapped column. This repo does not edit that file.

2. **Normalize fills company from `maps_raw.name`.** After D66's
   rules-hash reopen the Maps-name fill matched 0 of 147. Read-only
   counts on `lp.emcor_ingested_leads` (job `46b1c941`): every held
   row has empty `title` and empty `company_name`. Ingest has no
   `place_id`, no `source_url_hash`, no `content_hash`. All 147 join
   `client_emcor.maps_raw` on `lower(email)`; `maps_raw.name` is
   populated on every join; `maps_raw.company` and `title` are empty.
   Sample names (10, no emails): Obexer's Water Sports; Howell Mountain
   Ace Hardware; American Canyon High School; American Canyon Middle
   School; Utica Park FitLot Outdoor Fitness Park; Bret Harte Theater;
   Dainty Montessori School by Olivina Educ; Haven Humane Society
   Adoption Center; Auberge du Soleil; The Pines Resort. Root cause of
   the empty ingest: `copyMapsPool` picked the first *existing* column
   (`company`) and `nullif` emptied it, never falling through to
   `name`. The copy now coalesces `company`, then `name`, then
   `title`. Normalize left-joins `maps_raw` on `lower(email)` and
   fills empty company from `name` (any row, not only role-inbox —
   `name` is the business). Role-inbox `title` fill stays as a
   fallback. Role-inbox locals grow by the generic roles on this job
   (`staff`, `customerservice`, `concierge`, `boxoffice`, `events`,
   `rentals`, `orders`, `recruiting`, `inquire`, `reservations`,
   `adoptions`, `parties`, `storage`). Brand-as-local and person
   locals are not added. First-name fallback stays off. Normalize's
   `rules_hash` is `d67:maps-raw-name-join` so the 147 reopen.

**Why.** After #44: Find Named Person failed with `permission denied
for schema lp` on the runtime CREATE VIEW. The 147 still held —
ingest never stored the Maps business name, so title→company wrote
nothing. 54 of 147 locals were already on the role-inbox list; the
company miss was the empty ingest columns, not the list. `ew_read_source`
cannot alias; a SECURITY DEFINER read function in topup would not be
called by people-waterfall (it hardcodes that RPC).

**Tradeoff.** 0021 covers the 17 `lp.*_ingested_leads` tables that
exist at apply time. A client added later needs another view in the
same shape — ask Josh; the service will not CREATE it. Writeback
UPDATEs the view (auto-updatable; `domain` is computed and is not
written). Applying 0021 is Josh's call. The other-repo FIELD_CANDIDATES
change is documented, not shipped here.

**Guard.** `src/guards/d67_no_runtime_ddl_maps_name.test.ts`. Ask Josh.

## D68 — Hold reads `company_n`; maps city is parsed; lane E ICP re-applies categories and drops schools

**Decision.** Three leftovers on job `46b1c941` after D67 shipped
(`2bf9f7c`).

1. **Hold and fill share `company_n`.** After normalize the merge
   value is `company_n` (recipe `required_fields`, staging copies it
   to Smartlead `company_name`). `MERGE_FIELD_COLUMN` and
   `QA_FIELD_COLUMN` map `company_name` → `company_n` (and
   `first_name` → `first_name_n`). The hold SQL coalesces
   `company_n` then `company_name`. An empty raw `company_name` is
   filled from `company_n` so a later check cannot read the empty
   source column. Read-only on the 147 `qa_hold` rows: `company_n`
   filled 147, `company_name` empty 147, `merge_field_empty` has
   `company_n` 0 / `company_name` 0 (they stay held for
   `first_name_n` 147, `location` 147, `job_title` 147).

2. **Maps city is parsed.** `maps_raw.city` is `City, ST` (147 of
   147 holds have a comma; the state column is already set). Ingest
   writes the city token and keeps/derives state. Normalize splits
   the same shape before geocode (`city_state_split`). Against
   `topup.ref_cities`: raw city geocodes 0 of 147; after the split,
   140 of 147.

3. **Lane E ICP re-applies `main_category` and drops schools.**
   D59 left scrape categories off the companion union (pool 18,322
   vs ~8,972 with the receipt's 25). The 147 include 10
   preschool–high school rows (lane D) plus strays whose ingest
   industry is outside that 25. On `v_lane_e_*`, categories match
   `maps_raw.main_category` (not `source_category`, the scrape
   bucket). Preschool through high school are excluded by an
   explicit category list plus name keywords (`montessori`,
   `charter school`, `junior high` included; bare `school` and
   college are not). Lane D views are untouched. `private school`
   stays on the receipt list and is still dropped on lane E.
   Size-equivalent read-only SQL (companion ∪, plan
   `custom-1789679826`, 25 cats, school exclude): pool 8,973
   (was 18,322); distinct emails 3,616; already live 2,434;
   already ingested 486; already contacted 1,827; used union
   2,625; email net-new 991. Count-style `pool − used` net-new
   6,348. Full `size()` suppress-by-reason was not replayed.
   Normalize's `rules_hash` is `d68:hold-city-icp` so the 147
   reopen.

**Why.** After #45: company fill wrote `company_n` and left
`company_name` empty. Every hold still failed geocode because the
city column carried `City, ST`. The ICP companion had no category
filter, so schools and off-list industries entered the 147.

**Tradeoff.** Re-applying the 25 on lane E cuts the companion pool
from 18,322 to 8,973 (D59 named this cut and left it for Josh;
this entry takes it). Email net-new on that pool is 991, under
the 1,000 TAM floor — ask Josh whether to pull, widen, or stop.
School exclude is lane E only; a lane D campaign keeps those
rows. The 147 already ingested stay until a new pull; this does
not purge them.

**Guard.** `src/guards/d68_hold_city_icp.test.ts`. Ask Josh.

## D69 — Rerun replaces hold counts; size pool binds start at $11

**Decision.** Two leftovers on job `46b1c941` after D68 shipped
(`48c937f`).

1. **A reopen replaces step counts.** `finishStep` did
   `counts = counts || $new`. Normalize only writes `held_*` when
   the count is > 0, and only writes flags this run produced.
   After D68, the rows were right (`company_n` filled 147/147,
   `merge_field_empty` has `company_n` 0, `normalize_flags`
   `company.missing` 0, location empty 7) but the step still
   showed `held_company_n` 147 and `company.missing` 147 from the
   previous hash. `resetStep` now keeps only `approved_by`.
   `finishStep` replaces the payload. Normalize writes every
   `held_*` including zeros. The hold RETURNING uses the same
   coalesce as the check. Hash is `d69:hold-recompute-size`.
   Read-only: a recompute would report `held_company_n` 0.

2. **`size` pool binds start at `$11`.** Recycle SQL hardcodes
   `$2::int[]` as interested ids. D68's companion FROM uses
   `$1::text` and `$2::text[]` for plan_id and categories. One
   query cannot type `$2` both ways; the suppress pass threw and
   the catch returned 0 for every reason (old 18,322 pool dropped
   4,194). Pool `$n` now shifts by 10. A missing table still
   returns zeros; a bind error fails the size.

**Why.** After #46: geocode holds fell to 7. `job()` still showed
147 company holds. `size()` on the 8,973 pool reported 0 drops.

**Tradeoff.** `finishStep` no longer accumulates partial count
keys across attempts — `mergeStepExtra` / `mergeStepCounts` stay
for in-flight markers. A size query error is `failed` with
`last_error`, not a silent zero. Ask Josh if a missing ingest
table should stay a soft zero.

**Guard.** `src/guards/d69_hold_recompute_size.test.ts`. Ask Josh.
