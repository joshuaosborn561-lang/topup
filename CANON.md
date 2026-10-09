# Canon — what this service does

Canon as of **D50** (2026-10-09). One page of current truth. When a new
decision lands in `DECISIONS.md`, this file is updated **in the same PR**;
the meta guard in `src/guards/meta.test.ts` enforces both.

`DECISIONS.md` is the append-only ledger of *why*. Derive behaviour from this
page; each rule cites its decision numbers.

## Mission

Client Smartlead campaigns stay topped up with verified, normalized leads
without a human babysitting the pipeline — **any campaign, from any source**
(D18). The MCP is the console (D48): every run is a record, every decision
that costs money or changes a list is a card the operator resolves over
MCP, Slack is optional and nothing depends on it, and the service does
only what a build record says (D9, D15, D47).

## The line (D18)

> If a task does not require judgement, the service does it. If it requires
> judgement, the service brings it to me in Slack with everything I need to
> decide.

- **Mechanical (service):** runway/health watch (Slack includes the last-pull recipe counts — D40), counting, approved pulls,
  ingest, suppression, cascade steps within budget, verification and the
  stall runbook, normalization, QA rules, routing, staging, importing with
  the count assert, merge field checks, receipts, ledger, digest, free
  retries and resumes, splits under the spend rules, registering a cloned
  campaign, keeping missing-piece groups current.
- **Judgement (Josh, on a card):** which segment / whether to widen; whether
  a low campaign is worth topping up; spend of $5 or above; whether a pilot's
  yield justifies scaling; copy for a new cell; ICP changes; a client's
  expanded titles; flipping a campaign active.
- **Routine (Cayden):** QA holds, uploading customer lists, resuming parked
  runs, acknowledging receipts.
- Unclear → judgement column, ask. Nobody automates a decision to save a card.

## The spine (D24, D25)

The business process is the thirteen steps of `skills/lead-list-build/SKILL.md`
and the service is those steps, the gates between them, and the ledger that
records which step a lane is on. The skills are in the repo at `skills/` and
are the specification; `SKILLS_INDEX.md` says which parts are stale, and the
index wins over a stale skill. A lane is always on exactly one step, named by
**number and the skill's title** ("Step 6 — Verify") in every card, log line
and ledger row — `src/spine/steps.ts` is the only table of steps and a guard
fails when it differs from the skill's headings or `Gate:` lines. Code runs
3–12; Josh owns 1, 9 when copy is needed, and 13; Cayden clears holds in 8.
Step 5 applies campaignintelligence positives as the global list
(90 days after the reply) and optional customer domains; an empty
customer list does not halt (D37). A step's gate
halts the run, records
why, posts one card, and waits; silence never means yes. The receipt is the
last gate. `trigger` is step 1 (the recipe is the signed-off segment),
`ingest` 4, `stage` 10.

Gates live today (D25, D26, D46). **Step 2**: the band filter must bind
(bands + other bands = all, within 1%); every campaign gets the policy
layer's verdict; a campaign with under 1,000 net new is `tam_filled` and
skipped while the rest continue; a run with no qualifying campaign closes
as sized with the report. Nobody is paged to widen a pool. **Step 3**: zero rows delivered stops
the run. **Step 4**: rows read = rows exported; titles audited against the
recipe as whole phrases, off-title flagged for step 8. **Step 5**: report raw, removed by reason, net new; prior contact is a send
by this client in the last 90 days (D35 item 2; older recycles unless
positive / DNC / wrong person). Never put someone in two live
campaigns of the same client (D36 item 2). **Step 6**: sendable count
and reject rate are reported; nothing sendable stops the run; a reject rate
far above the lane's norm (`verify.reject_rate_norm`, Josh's number; 2× and
10 points over, on 50+ verdicts) stops it and says the source is bad. **Step
7**: every merge field the copy uses (`required_fields`) is populated or the
row is **held** (`qa_hold`, `qa_flags.merge_field_empty`); the run goes on
and reports the held count. No team is not a hold; it is the AirPods tier.
**Step 8**: every hold cleared by a tap (accept, purge, reroute). **Step 9**:
every target campaign is this client's in the mirror; unmatched leads wait
as `pending_campaign` for Josh. **Step 10**: every routed row has a staging
row for this run. **Step 11**: Smartlead's imported count equals rows
submitted. **Step 12**: every merge tag in the copy resolves on every staged
lead. Two flavours of step 3 (LinkedIn-native vs physical, routed per
`leadgen-mcp-routing` step zero — getleads is never the rooftop fallback);
one pipeline from 4 on. Puzzle pieces and email enrichment run after
suppress, immediately before verify (D29), so a suppressed person is not paid
for.

## The service is the memory (D19, D20)

Every lane has a state record, an event log and a queue registry in
`topup.lane_state / lane_events / queue_registry`. It answers: which step and
since when, and the gate that is unmet if it halted there; what is queued where (counts by `lead_status`, every registered
queue with what its rows still lack — domain, person, email — and the next
method); blocked on whom and what they must do; spend this run and this
month by vendor; the one-line event log with what the service intends next;
runway and health of every campaign the lane feeds.

Read it with `/where <client> [lane]`, the `lane_state` MCP tool, or the
daily ops digest (13:00 UTC), which only names lanes whose state changed or
whose health crossed a line. Claude sessions hand work to the service with
`register_queue_table` and `lane_note` over MCP (owner token).

Health, from the hourly Smartlead mirror: **silent** (ACTIVE, untouched
leads, no sends in 7 days), **empty**, **low** (that campaign's runway
under the recipe floor), **bouncing** (over 5%). Those flags stay on the
board. **Client-wide** days (D38, D45) stay on that board: rem across
ACTIVE campaigns ÷ (unique inboxes × MESSAGE_PER_DAY when named, else the
7-day send rate). LI is rem ÷ 40. **n/a days do not pass the floor.** A
client with ACTIVE campaigns and no rate is needy, not healthy. Client
under-7 still shows on the daily digest. The **start signal** is each
campaign. An empty or low campaign that is still working is filled so
its sends do not stop, even when a sibling still has leads. A campaign
that still has runway is not refilled.

## Build order (D23)

1. Done: ledger, `/where`, digest, verify → normalize (D17).
2. **This build:** a getleads lane end to end, steps 2 → 12 (D26), and the
   runway watch that starts a run on its own (D27).
3. Physical lane cascade with the **yield card** and the **pilot of ~100**;
   nothing scales without the second tap (D21). Peterson roof owners first.
4. Vendor server fixes and attribution.

Before the service calls a vendor server it is documented from its code in
`docs/servers.md`, and Josh reviews that first (D22).

## First pull (D31, D32, D33)

The first list for a campaign is built in Claude. After that pull (and
after every service import, step 11.5) a **new** row goes into
`topup.pull_receipts` — never an in-place update. **Lane** rows are the
filter book (titles, bands, Maps runs, permits). **Build** rows are one
`source_label` / batch and its measured size. Propose the build with the
best imported count, not the method on the lane row. `tam_count` is
`count_contacts` or a Maps/permit **company** count; `rows_found` is the
export. Those are not the same number. If the latest receipt is
`claude_backfill` or `claude_backfill_build`, **recount** before
proposing — a blank `tam_count` is not TAM, and backfill `rows_found` is
the old export. `other` is not a value on `company_source`,
`domain_source`, `person_source`, or `email_source`; a receipt that
would have needed it is a bug. Named company signals
(`serp_tool_mention`, `theirstack_tech_signal`, `linkedin_engagers`,
`linkedin_import`, `web_visitor_pixel`, `job_posting_signal`,
`public_records`) carry rerun parameters in `company_filters`. Domain
also has `theirstack`; person also has `leadmagic_employee_finder`.
The 15 remaining “Josh to confirm” lanes are segment sign-off (step 1),
done once. Peterson C1 (`c1_general_contractors`) is off that list —
counts were measured; it is the first top-up the service can run once
Maps/PermitStack are wired (physical still parks until then). Campaign
ids must already exist in `public.campaigns`. Mixed ICPs are two lane
rows. A lane with no receipt and no file recipe cannot be invented.
A receipt is enough — infer the pull from tags and notes (D45). A
file recipe is the override when one exists.

## What this build runs (D26, D27, D28, D38)

The **watch** is the normal start. Every six hours (and once on boot) it
reads the Smartlead mirror for every recipe, campaign by campaign. The
needy signal is that campaign's own runway under `runway.floor_days`
(empty or low). Client-wide rem / capacity (D38, D45) stays on the board
and does not block a dry campaign. Watchdog nearly-done alone does not
start a run. **Working** means
under 1 interested per 2,000 sends on every build (1 interested
in under 2,000 sends is acceptable; a variant with 1,000 sends
can clear that rate; D11, D35 item 12, D44). Each dry campaign that is
still working
opens a run by itself — no `/topup`, no card. The run targets those
campaigns only, so leads go where sends would otherwise stop. A
campaign that needs leads and fails the policy (under the bar, paused,
dropped, retired, excluded, not ACTIVE, another client's) does not start
and gets no card: the queue and the lane log say why (D46). `/working on`
is Josh's override for the bar. `/topup` and MCP `start_topup` are the
override for everything else. When the
watch flags a campaign as needing leads (go or ask), Slack includes the
`topup_recipe` count summary — builds, interested per build,
`any_reconstructed`, `leads_without_method` — so the human starts from
the last pull, not from tags (D40). A
non-SalesGlider client under **2 email days** flags a client-holistic DM
mock (filters, net-new, $, title-segment); SalesGlider is excluded unless
Josh asks. Paid spend still waits on Josh.

A run is locked in Postgres so there is only ever one per lane (D12). It
walks steps **1 → 13** in the skill's order, every time, whether the watch
or `/topup` started it (D28). Step 1 reuses the saved recipe when the ICP
is already signed off — it does not ask Josh again. Size, pull, ingest,
suppress, verify, normalize, QA, route, stage, import and pre-launch run on
the new rows. Step 13 posts the flip reminder and never sets ACTIVE.

The stages:

1. **trigger** — the saved recipe is the signed-off ICP. Every cell still
   needs a campaign of this client; missing cells or foreign campaigns halt.
   No card when the saved ICP is complete.
2. **size** — the planner (D48). Every target campaign is judged by the
   policy layer first (D46). The ones that qualify are grouped into pools,
   one per distinct query, and each pool is counted once, concurrently,
   under the client's vendor cap: getleads `count_contacts` with the
   partition check and AI Ark People Preview together for LinkedIn-native
   ICPs (within 10% is the TAM; one missing is `single_source`, never a
   mismatch); the stored Maps or permit pool from the build record for
   non-LinkedIn ICPs, never a getleads number. Long city and industry
   lists are sliced before any call. BCP adds the COO fallback per
   campaign. Net new is the sampled overlap with emails this client sent
   in the last 90 days (D35 item 2) plus anyone in a live campaign (D36);
   the client total is never subtracted. Counts and pilot scores are
   cached per query fingerprint and reused while fresh. Each pool is split
   across its campaigns by need. Every vendor call, sent or not, is on the
   step with its outcome. One line per campaign with its gate and reason.
3. **pull** — routed by the target campaigns' ICP and source
   (`leadgen-mcp-routing` step zero). The watch starts a **client-holistic
   DM pull** (same persona the client has been sending to), then route
   segments by title / mail class / gift into existing campaigns (D38,
   D30 persona stays per campaign at route time). getleads on a LinkedIn-native
   campaign runs `GetleadsPull` with that campaign's bands/titles (or the
   union when the run's targets share a persona). getleads on a physical
   campaign parks (do not fall back). maps / permits / AI Ark park until
   those adapters are wired. The watch passes the recipe's campaign ids,
   not only the empty SEG one; a `/topup` with no ids sizes the whole lane.
4. **ingest** — LeadPipe `ingest_csv` under a run-scoped `source_label`; rows
   claimed for the run; `company_size` / `vertical` filled; title audit
   against the union of the target campaigns' titles.
5. **suppress** — one SQL pass, response based only: positive reply, DNC,
   wrong person, suppression list, bounced, client prior contact, same
   offer other client, client customer domain. Prior contact is a send
   by this client in the last 90 days (D35 item 2). Anyone already in
   a live campaign of this client is also held (D36 item 2). DNC and
   wrong person stay blocked forever. Positive replies from any client
   expire 90 days after the reply and are the global list for every
   client (D37). An empty customer domain list does not halt. Same-offer
   suppression still halts, not skips, when the registry has no
   `offer_key` for the lane.
   Then **puzzle** (name / no domain → Domain Waterfall; domain / no name →
   Find Named Person; names banked in `public.name_bank`) and
   **find_emails** (DiscoLike find emails is the first rung and is not a
   leadtopup client yet; Name to Email is paused; Email Waterfall
   `source_table` + writeback). Both sit immediately before verify.
6. **verify** — LeadPipe signed CSV (row count must match), Email Verifier
   Progression, 60s polls, the stall runbook; `mv_status, n2b_status,
   mail_class, verify_path, ev_status, lead_status` per row. Sendable is `mv
   ok` or `catch_all + N2B deliverable`; nothing else (D10). Every
   sendable domain must have a mail class; the service's MX lookup
   fills gaps the verifier CSV left blank (D34). Insight
   (`drop_gateway_catchalls`) drops SEG catch-alls instead of routing
   them (D36 item 58).
7. **normalize** — `first_name_n, company_n, location, local_sports_team`
   and flags from the four skill-script ports (D25); empty required merge
   field → hold. `topup.ref_cities` via `npm run seed:cities`, once.
8. **qa** — `topup.qa_rules` named by the recipe (Postgres regex; purge
   before hold); one summary, one card per rule with ten samples of company
   and title; taps accept, purge or reroute (reroute only where the recipe
   maps the target to a campaign of this client).
9. **route** — cell = band × mail class × gift tier; first matching rule;
   campaign must be this client's in `public.campaigns`; no match →
   `pending_campaign` and a card to Josh (continue without, or abort).
10. **stage** — `public.leads_staging` with normalized `first_name` /
    `company_name`, `job_title`, `vendor`, `source_dedupe_key`, `imported = false`.
    Dedupe on `(campaign_id, lower(email))` against staging and the
    mirror; the md5 key is a write convention, not the guard (D34).
11. **import** — Smartlead `start_lead_import` per campaign, poll
    `get_lead_import_status`, count assert; a mismatch stops before the next
    campaign. Restart-safe through `run_steps.vendor_job_id`.
12. **post_import** — merge tags from `get_sequences` against staged
    coverage (the `check_merge_tags.py` port), settings findings from
    `get_campaign`, runway before → after; one pre-launch post per run.
13. **flip** — posts the step 13 line: Josh sets ACTIVE by hand and watches
    day one. The service never starts, pauses, or stops a campaign. Then the
    run closes as `done` with the **receipt** (the funnel plus one line per
    campaign). The watch starts the next fill when the **client** is under
    the runway floor and still working (D38).

`/health` reports counts by `lead_status`, spend by vendor, stall events,
open cards, open runs and which integrations are configured. It is
`ok: false` (HTTP 503) when a required `topup` table is missing (D34).

## Money (D9)

- Auto cap **$5** per step; spend of **$5 or above** asks with the worst case in
  dollars and waits for Josh. Daily backstop **$25** across vendors.
- Worst case comes from `src/spend/prices.ts` × batch size. Never a
  vendor's number.
- One `topup.spend_ledger` row per vendor call, free or paid.
- A bill more than 10% over the approval stops the run and pages the ops channel (`C0C135EB76H`).
- Verifier resume is free. A split is spend.
- Banned: PDL (including wrappers), LeadMagic job change detector,
  BillionVerifier, Clay, Hunter (D8, D35 item 14). FullEnrich off per
  recipe until Josh stamps `owner_approved_at` (D7).

## People (Slack, D2)

- Owner = Josh, operator = Cayden, by Slack user id in Railway variables.
- Owner-only taps: approve/decline spend, top up anyway / leave it, split,
  continue without pending leads, anything that changes a recipe. Operator
  taps never spend and never change a recipe; the reply is "This needs Josh."
  Step 5 does not wait on a customer-domain-list card (D37). The
  heading stays `(code)`.
- Commands: `/where`, `/topup` (override — the watch is the normal start), `/holds`, `/runs`, `/working` (owner),
  `/suppress` (explains the 90-day global positive list).
- `/mcp` is Streamable HTTP over HTTPS at
  `https://leadtopup-production.up.railway.app/mcp` (D40, D41, D48). **No
  login.** Anyone who can reach the URL gets the whole surface, and the
  surface is small: `client_overview, topup_queue, campaign_history, size_client,
  approval_briefing, start_topup, run_status, list_runs, abort_run,
  resume_run, list_holds, resolve_hold, loads_paused, lane_state,
  lane_note, add_client_domains` (domains only). **No tool returns a lead
  row or a file URL.** `sample_rows`, `variant_stats`, `campaign_registry`,
  `recipe_get`, `missing_piece_groups`, `register_queue_table`,
  `topup_recipe`, `topup_campaign_builds` and `topup_provenance_gaps` are
  retired; `campaign_history` is the live pull record (`topup.recipe()`,
  `topup.campaign_builds`) plus the build records and the lifetime
  reply count. `resolve_hold` refuses operator approval of spend of $5 or
  above. `start_topup` takes `client_tag` + `campaign_id` (optional
  `count`) or `client_tag` + `lane`. A file recipe is the override;
  otherwise the pull is inferred from `topup.pull_receipts` tags and
  notes (D45), every ACTIVE campaign the registry puts on the lane joins
  it, and each campaign is pulled from its own build record (D47, D49). `topup_recipe` is how the last list was actually pulled
  (`include_vocab` default false). `topup_queue` pages (`limit`,
  `offset`, `client_tag`) and is the same lead-refill lines
  `#campaign-watchdog` posts (empty, low, nearly-done 90%), ranked
  empty-first then shortest runway, each with the recipe count
  summary, `sends_last_14d`, and the working bar. It includes camps
  the client-wide watch would skip (D38 still governs auto-start).
  Cayden's flow is `client_overview` for the client, or `topup_queue`
  across clients (gates already applied) → `campaign_history` for each
  campaign to top up → `size_client` (pilot and size, one call per
  client) → read the one-line-per-campaign report → `approval_briefing`
  to Josh → `start_topup` once approved and loads are open. Check
  `run_status` once per message — do not poll every two minutes in chat.
  No Slack, no Cursor (D43, D44, D45). These live tools are not on
  LeadPipe.
  `client_tag` on the recipe tools is the live list from
  `topup.client_map` at boot (refreshed per request). Adding a client is
  a row in that table, not a hardcoded enum and not a service bump (D42).
- Counts and ids only. Ten sample values on a card at most, never emails.

## Grok bot (D39)

Grok bot is the **babysitter**. Skill: `skills/grok-bot-babysitter`. It
starts a run, reads **campaignintelligence tags** (receipts, recipes,
`lane_state`), posts a card, and drops a link. It does not see lead rows.
It does not reconstruct the thirteen steps in chat.

- **Where the work lives.** The Railway service walks steps 1–13 (D24,
  D28) after `start_topup`. Rows move **MCP → Supabase** (`source_table`
  + writeback), edge functions (`skills/supabase-csv-endpoint`), and
  LeadPipe (`skills/leadpipe` — `lp_run ingest_csv` from a URL, `lp_export`
  signed_url + count, `lp_sample` ≤10). They do not enter Grok bot context.
- **What it may call.** Service MCP (`start_topup`, `lane_state`,
  `run_status`, `list_runs`, `list_holds`, `recipe_get`, `topup_queue`,
  `topup_recipe`,
  `topup_campaign_builds`, `topup_provenance_gaps`, …). Open
  `topup_queue` (the #campaign-watchdog lead-refill list), pick the top one, read `topup_recipe`, run
  `start_topup(client_tag, campaign_id)` (D43, D44, D45). Read
  `topup_recipe` before any top-up (D40). LeadPipe (`lp_plan`, `lp_run`,
  `lp_status`, `lp_export`, `lp_sample`, `lp_inventory`,
  `lp_ensure_client`, `lp_list_clients`). Slack cards. Allow list is
  `src/grok/allowlist.ts`.
- **What it must not call.** `export_contacts`, `search_contacts`,
  GetLeads enrich/batch-result tools, Apify `get-dataset-items`,
  `find_dms_by_title` (~$0.10/company), `SELECT` of email / name / phone
  / linkedin_url, inline `enrich_waterfall` rows, child-agent GetLeads
  fires, CSV paste, opening a signed URL, a self-routine that re-reads
  lists. Ban list is the same file.
- **How it knows what to start.** Every campaignintelligence tag, not
  four legs. Source legs (`company_source`, `domain_source`,
  `person_source`, `email_source`, `email_max_tier`, `email_tier`)
  **and** `company_detail`,
  `evidence`, `confidence`, `build_label`, `feed_pattern`, `icp_kind`,
  `persona`, `company_filters`, `segment`, `how_i_did_it`. Physical
  (`icp_kind = physical`) must also read `company_filters` keys
  `maps`, `maps_runs`, `permits`, `geo`, `source_tool`,
  `titles_wanted`. Tables: `topup.pull_receipts`,
  `topup.campaign_method`, `topup.campaign_recipe`, `topup.feed_map`,
  `topup.lead_provenance`, `topup.provenance_sources`,
  `topup.provenance_gaps`. COUNT tags; never SELECT email. Not
  `public.leads` alone, and not a chat walk of `skills/lead-list-build`.
  A file recipe is still the override when one exists. When none
  exists, the service infers the pull from those stamps and notes
  (D45). Grok does not invent a recipe in chat.
- "Here's what it found" is a count, a job id, and a signed URL the bot
  does not open. Ten masked samples on a card stay the ceiling (D2).
- Scheduled pulses are Railway crons. Grok bot does not set a self-routine
  that re-reads lists.

## One policy layer (D46)

Every rule a top-up decision depends on lives in `src/policy` and nowhere
else, and `evaluateCampaign` gives one verdict per campaign with a one-line
reason. The queue, the watch, the size step and the start path all call it,
so they cannot disagree. In order: the never-top-up list (SG Gabe Calls
4085158, SG Cayden Calls, SG Nurture 3122546); client `goliath` is ignored
until told otherwise; Parlay outside 4049046–4049064 is retired; Insight
Google SADA is dropped and Insight OEM Channel Reps is paused, and neither
starts, not even from the watch; only ACTIVE campaigns are targets and a
lane targets only its own Smartlead client's; the reply bar is **1
interested per 2,000 sends, measured per campaign on lifetime sends** — a
campaign with zero positives never qualifies however few sends it has, and
1 reply under 2,000 sends is acceptable (D44); a recipe with no company
filter is never sized from titles alone; a pilot (200–300 vendor rows)
must score 80% or more on every dimension it can score, a missing export
column is "not scored"; a pool more than 20× the build it repeats or above
a known market cap (about 40,000 MSPs) is a suspect filter; a non-LinkedIn
ICP sizes only from its stored pool, and a pool that cannot be read is
`tam_source_missing`, never a filled market at TAM 0 (D50); two
LinkedIn-native counts within 10% agree, a gap of 10% to 25% uses the
lower count (`mismatch_minor`), and a gap over 25% uses the AI Ark count
only when a 250-row pilot passes 80% on title and industry
(`ai_ark_wider`), otherwise the getleads count (`getleads_only`); neither
gap parks (D50); and under **1,000 net new** is `tam_filled`.
Spend: free proceeds, under $5 is Cayden, $5 or above is Josh, and over
the $25 day is Josh too. Parking is per campaign, never per run: a
campaign that fails is skipped with its reason and the rest continue.
The report and the briefing say the gate and the reason for every
campaign. Nothing widens, adds a title or an industry, or switches vendors
on its own.

## Build records (D47)

The build record is the memory. Every pull, past and future, is a
`BuildRecord` (`src/builds`): the vendor, the exact query (titles or job
function plus seniority, industries, description terms, headcount bands,
geography including the fence, email status, max per company, fallback
personas in order), the source kind (a vendor search, or a stored Maps or
permit pool with its count), the campaigns it fed, what it yielded, the
method note, and whether the method was reconstructed after the fact. It
is joined to lifetime sends and positives per campaign. The next pull for a
campaign repeats the build that earned its replies; failing that the latest
build the service can repeat; failing that the record says the method
cannot be reconstructed and names who to ask. Nothing is guessed from lane
labels or client defaults. `campaign_history` is how the operator reads it.

## The planner and the surface (D48)

Clients and campaigns are independent, so they size in parallel, bounded by
the per-client vendor cap and the daily spend cap. Within a client,
campaigns that share a query share a pool: counted once, split by need,
never the same person planned into two campaigns. Queries are planned under
the vendor timeout (city fences in slices of 45, industry lists in slices of
12) and the slices run concurrently; a timeout is not discovered and
retried. Counts before exports, always; the pilot is a few hundred rows;
net new is sampled and scaled, with the method recorded; counts and pilots
are cached per query fingerprint on the size step. Every vendor call, sent
or not, is written to the step with its outcome and no rows. A run can be
aborted or resumed from the MCP at any step (`abort_run`, `resume_run`);
abort cancels running steps, returns claimed rows and closes the cards. The
MCP surface is the fifteen tools above and none of them returns a row.
Slack posts are dropped, never required, when no token is set.

## Starts read the tags; the babysitter sees a client in one read (D49)

There is no hand-written method per campaign. A lane's campaigns are the
ACTIVE rows `topup.campaign_registry` puts on that lane for that client;
they join the inferred routing even when the receipt that named the lane
lists older ids (Parlay keeps its Sept 29 rule). Each campaign is then
sized and pulled from its own build record (`topup.campaign_builds`,
`campaign_method`: the source legs, `company_filters`, the method note).
A campaign with no repeatable record is skipped with the missing tags
named; nothing is guessed. `client_overview(client_tag)` is one read per
client for the babysitter: every campaign with its flag, gate, reason,
chosen build and tags, plus open runs and the loads switch, counts only.
`campaign_history` carries the `tags` block (`campaign_method` legs,
`missing_tags`, `lead_provenance` counted by build label and confidence).
The step 2 gate is the policy's floor: at least 1,000 net new per
campaign, else TAM filled (D46).

## The lane on the registry, the stored pool, and a count gap (D50)

`size_client` and `start_topup` open the lane `campaign_registry` names
for that campaign. The first recipe whose routing mentions the id does
not win, and an id on no lane is reported without a run on another lane.
Campaigns that share one stored Maps or permits pool split `plan_rows` so
the sum does not exceed `tam_left`. Abort returns rows left in
`verifying`, `claimed`, `reserved`, or `pulling` and reports how many.
A LinkedIn count gap is resolved as the policy says above. Both filter
sets and both counts stay on the campaign line. Ask Josh.

## Never (D1–D6, D8, D13, D14, D39, D48)

- Never write to a Supabase project other than `azpapwtnrbzywlnxxecz`.
- Never hardcode a secret. Never call a vendor in a test.
- Never start, pause, stop or delete anything in Smartlead; never remove an
  API-added block-list entry.
- Never send getleads numeric headcount bounds or comma industries. Pull
  every email status; we verify anyway (D35 item 15). The client refuses
  a filter that carries both `company_size` band labels and a numeric
  employee bound (D34). `count_contacts` is count filters only — exact
  band labels, titles, geo. `max_per_company` is an export cap; the size
  step must not send it (D43).
- Never patch around a broken vendor server; bound the damage by batch size
  and say so in the PR.
- Never trust "processed" or a zero-verdict resume as a verification.
- Never run more than one replica.
- Never add an MCP tool that returns a lead row or a file URL (D48).
- Never pull lead rows into Grok bot context. No export payloads, no
  CSV paste, no child-agent GetLeads fire into chat, no walk of the
  thirteen-step skill in that context. Counts, ids, and a link only
  (D39). Use LeadPipe and csv-endpoint; do not open the signed URL.

## The merged list (D35)

Josh's rulebook of how lists are built. The full 78 items live in
`skills/merged-list/SKILL.md`. Service behaviour that this decision
changes:

- **Item 2.** Prior contact is a send by this client in the last 90 days.
  DNC / wrong person are forever. Positives expire 90 days after the
  reply (D37). Never put someone in two live campaigns of the same
  client (D36).
- **Item 4.** Empty customer list does not halt (D37). The global list
  is campaignintelligence positives.
- **Item 8.** Gift-lane QA hold includes insurance. Default stay in.
- **Item 12.** Variant volume floor is 1,000 sends.
- **Item 14.** Hunter is banned with PDL / BillionVerifier / Clay.
- **Item 15.** getleads pulls every email status. Omit `email_status`.
- **Item 19.** Parlay bands are 11–50, 51–200, 201–500. The shipped
  recipe still pulls 11–50 and 51–200 and counts 201–500 as widening
  until those cells have campaigns.
- **Item 26.** TechEvo NE IT DM includes New York and New Jersey.
- **Item 27.** Florida IT DM is statewide. SFL owners lane stays metro.
- **Item 53.** Earthworks improved commercial owners: 2+ parcels; all
  3,958 operators in scope.
- **Item 58.** Insight drops gateway catch-alls; it does not segment them.
- **Item 65.** SalesGlider 11+; PE alone may use a 5+ numeric floor
  with no `company_size` bands.
- **Item 71.** Name to Email is paused. DiscoLike find emails is the
  cheap first rung (not a leadtopup client yet).
- **Item 75.** Stall runbook unchanged (resume, split, quarantine;
  zero-result resume is a stall).

## Where things are

| Thing | Place |
|---|---|
| State | `topup.*` on campaignintelligence; migrations in `supabase/migrations` |
| Skills | `skills/` — Josh's skills, the specification; `skills/merged-list` is the 78-item rulebook (D35); `skills/leadpipe` and `skills/supabase-csv-endpoint` move rows without chat; `skills/grok-bot-babysitter` is D39; `skills/SKILLS_INDEX.md` says what is stale (D25) |
| Live pull recipe | `topup.recipe()` and `topup.campaign_builds` via MCP `campaign_history` on `https://leadtopup-production.up.railway.app/mcp` (D40, D48), joined to the build records (D47). `topup_queue` is the watchdog lead-refill list with the policy gate applied (D43, D44, D46). `client_tag` from `topup.client_map` at boot (D42). On this service, not on LeadPipe. |
| Policy | `src/policy/` — every rule, `evaluateCampaign`, the spend audiences (D46) |
| Tags | `src/builds/tags.ts` — `campaign_method` legs and `lead_provenance` as counts; `src/mcp/overview.ts` — `client_overview` (D49) |
| Build records | `src/builds/` — `BuildRecord`, `chooseBuildForCampaign`, `campaignHistory` (D47) |
| Planner | `src/plan/` — pools, slices, the fingerprint cache, the vendor-call log, `planSize`, the approval briefing (D48) |
| Spine | `src/spine/steps.ts` (the thirteen steps, from the skill), `src/spine/gate.ts` (`GateUnmet`, step 6 and 7 rules) |
| Stages | `src/stages/<stage>/` one per step, `src/stages/common.ts` the shared attempt/finish/park discipline, `PIPELINE_STEPS` in `src/orchestrator.ts` |
| Vendor clients | `src/clients/` — getleads, Smartlead (D6 allow list), LeadPipe, verifier; every one documented in `docs/servers.md` first |
| Lane ledger | `src/ledger/` (`lane.ts` state, `health.ts` campaign lines, `render.ts` `/where` + digest text) |
| Servers | `docs/servers.md` — every vendor server from its code (D22) |
| Recipes | `recipes/<client>/<lane>.json`, validated at boot, mirrored to `topup.lane_recipes` |
| First-pull receipts | `topup.pull_receipts` — lane + build rows (D32); named sources only, no `other` (D33); Claude and step 11.5 insert, never update; `skills/first-pull-receipt` |
| Rails | `src/spend/` |
| Runbook | `src/stages/verify/runbook.ts` (pure) |
| Cards | `src/slack/cards.ts`; state in `topup.cards` |
| Guards | `src/guards/*.test.ts` — each names its decision and who to ask |
