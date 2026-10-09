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
