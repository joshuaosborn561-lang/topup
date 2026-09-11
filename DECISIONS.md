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
| D17 | Live — Phase 1 scope; retire when route/stage/import land |

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
