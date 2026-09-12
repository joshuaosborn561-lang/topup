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
| D2 | Live |
| D3 | Live |
| D4 | Live |
| D5 | Live |
| D6 | Live |
| D7 | Live |
| D8 | Live |
| D9 | Live |
| D10 | Live |
| D11 | Live |
| D12 | Live |
| D13 | Live |
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
| D27 | Live |
| D28 | Live; pipeline list superseded by D29 |
| D29 | Live |

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
