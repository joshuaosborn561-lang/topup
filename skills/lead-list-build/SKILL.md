---
name: "lead-list-build"
description: "The SalesGlider Growth soup to nuts procedure for building or topping up a lead list for any client and any source, in thirteen steps from ICP to a live campaign. Use whenever Josh asks to build a list, top up a campaign, refill a lane, pull leads for a client, or asks where a list build stands, regardless of whether the leads come from getleads, Google Maps, PermitStack, parcels, public records, or a hand filled queue table. This is the spine that every other lead skill hangs off of; it names which skill governs each step, which tool runs it, what gate must pass before the next step, and who owns the decision (code, Cayden, or Josh). Always follow this order. Skipping or reordering steps is how bad lists have shipped."
---

**Read `topup.bot_rules` first.** Before any top-up or list build, in Supabase project `azpapwtnrbzywlnxxecz`:

```sql
select category, client, rule from topup.bot_rules where status = 'active' order by category;
```

Those rows win over skill text where they conflict. A new durable rule is inserted there (supersede the old row; never delete).

# Lead list build, soup to nuts

Thirteen steps plus the gate at 5.5 and the receipt at 11.5. Steps 3 through 12 are mechanical and belong to the Grok Bot babysitter (`grok-bot-babysitter`; or to Claude when the bot is not running that lane). Steps 1, 9 when new copy is needed, and 13 are Josh's. Never advance a step until its gate passes. Report every count as net useful output, never rows processed.

Rules that apply to every step: no lead rows in chat; counts and up to ten company names only; data moves server to server; estimate and get approval before any paid call (credit prices live in `grok-bot-babysitter` under Credit pricing; quote from there, do not invent rates); pass `client_tag` on every job; confirm the Supabase project before writing (`azpapwtnrbzywlnxxecz` campaign and lead data, `kemvxzhcxvynmoutwdrh` parcels, `klomihumrgwoixbzxypr` CRM); one session at a time on a client's tables. LeadMagic is out of the stack as of Oct 8 2026: never call it, and never let a waterfall job reach a LeadMagic tier.

## Step 0. Read what changed (code, free, every build)

Before planning anything, read the process change rows so the build follows how things are done now, not how they were done when the client's pull skill was written:
```sql
select id, client_tag, created_at, summary, transcript_path
from topup.process_changes
where client_tag is null or client_tag = '<client_tag>'
order by created_at desc;
```
Global rows (`client_tag` null) apply to every client; client rows apply to that client only (a title taken out, a lane retargeted, a label set tuned). Where a summary is not enough, read its transcript from Storage bucket `list-build-transcripts` at `transcript_path`, server side, never into chat. The `record-list-build` skill writes these rows; if this session changes the process, it writes one at the end too.

## Step 1. Nail the ICP for the lane (Josh)

What: titles, headcount bands, geography, industries, offer family, gift tier. Decide the cells up front: band × gateway (SEG or OTHER) × gift (team or AirPods) × offer.
Source: the client's lead pull skill (`parlay-lead-pulls`, `culture-fits-lead-pulls`, `techevo-lead-pulls`, `goliath-lead-pulls`, `salesglider-lead-pulls`) plus the latest client call in Fireflies. ICP drift is common; the call wins over the skill and the skill gets updated.
Gate: every cell has a campaign or Josh knows one must be built. Josh signs off on the segment before anything is pulled.

## Step 2. Size it (code)

What: count the segment on more than one free or near free source before pulling. getleads `count_contacts`, DiscoLike counters, AI Ark preview counts, Maps or PermitStack counts for physical lanes. Run the partition check that proves the filters bind. Trust a number only when two sources agree.
Then: subtract what has already been sent to this ICP (`public.leads`, `leads_staging`) to get projected net new.
Skill: `tam-sizing`.
Gate: projected net new is above the useful floor (default 200). If thin, present widening options with counts; Josh decides. Never widen unasked, never declare a pool exhausted.

## Step 3. Pull (code, paid tiers approved by Josh)

Two flavors. Both end with rows in a table, never in chat.

LinkedIn native lanes (Parlay, BCP, Culture Fits, TechEvo, Goliath, Insight, SG lanes): getleads `export_contacts` with `company_size` as exact band labels like `["51 to 200"]`, no `email_status` filter (Josh: export without VALID, verify everything anyway), industries validated against the catalog (commas shred silently). Poll, take the S3 URL. If getleads under delivers on the companies, cascade: AI Ark people discovery on the misses via `/people/preview` with titles always passed (1 credit per 100 results; audit titles after, it returns whoever appears first at a domain when no title is sent), title filter in SQL, then Email Finder Waterfall (`max_tier='prospeo'`, `skip_tiers='leadmagic'`) on the named people. FullEnrich last and only if stamped on.
Skill: the client pull skill, `leadgen-mcp-routing`.

Company first lanes (Peterson roofing, Earthworks, Vasco, trades): the source gives a business or a name, not an email. Google Maps Scraper (outcome mode, `estimate_only` first) by category and geography, PermitStack by permit type and date and county, parcels by use code and county, IRS 990 and Texas Comptroller officers for names. Then walk it: `unmask-shell-llc` for address named owners; Domain Waterfall for domains (`domain-waterfall`); people from the company's own site first (`site-people-dm`), then Google-indexed LinkedIn (`serp-dm-discovery`), then Find Named Person (`people-waterfall`) with DiscoLike optional (`skip_tiers=discolike`; site-people and serp-dm come first). getleads by domain or AI Ark preview with titles still fine for LinkedIn-native leftovers; `hard-to-find-dm-discovery` on what is still empty. Email Finder Waterfall in `source_table` plus `writeback` mode for addresses. Bank every name with no email (`unresolved-name-routing`). Run a pilot of about 100 through the full cascade before scaling and report cost per usable lead.
Gate: useful output counted, titles audited, spend within the approved ceiling.

## Step 4. Ingest (code)

What: LeadPipe `lp_run ingest_csv` from the URL into `lp.<tag>_ingested_leads` with a `source_label` naming the lane and run. Take Contact City not Work City. Confirm `city, state, industry, employee_range` landed.
Gate: row count equals the export count.

## Step 5. Suppress and dedupe (code)

What, in one SQL pass, response based only: positive repliers, do not contact, wrong person from any client; `public.suppression`; the client's own customer domain list (must be applied before anything loads, ask Cayden for it if missing); bounces from any client; anyone already in any of this client's campaigns via `leads_staging` (older copy wins, it has send history; Smartlead only dedupes inside one campaign); anyone who already received the same offer from another client. Other clients emailing the same person with a different offer is allowed.
Skill: `global-suppression`. Never dedupe against all of `public.leads`; that killed 87 percent of a good pull.
Gate: report raw, removed by reason, net new. Net new is the number from here on.

## Step 5.5. ICP website gate (code, near free, before anything paid)

What: every distinct domain in the pull goes through our own site fetch plus Jev's category pick against the client's label set (skill `icp-website-gate`). Jev about $0.11 per 1,000 domains; DiscoLike fallback about $0.0038 per unreadable domain, plan for about 10% unreadable. That site-unreadable fallback is a different call from DiscoLike in the people finder. The client's variant is in `topup.icp_variants`; a client with several ICPs needs one variant per lane. A client with no label set parks until one is written, and every new label set gets a 50 site blind check by a separate agent on its first run. Write `icp_gate`, `icp_gate_label`, `icp_gate_at` on the rows; never delete.
People after the gate: `site-people-dm` and `serp-dm-discovery` run first. DiscoLike in the people finder (`people-waterfall`) is optional; pass `skip_tiers=discolike` unless Josh asks for that tier.
Gate: only `icp_gate = yes` moves on to verification, enrichment, routing and import. Show Josh the label counts; if one label swallows a big share, fix the label set before going further.

## Step 6. Verify (code, paid, estimate first)

What: serve the rows as a public CSV URL (`supabase-csv-endpoint`), Email Verifier Progression `start_verification`, poll every minute. Stall runbook: at 90 percent plus with no progress for 12 minutes, `resume_verification` once (free); if still stuck, split the remainder in halves and resubmit (that can bill, so it follows the spend rule); down to 50 rows; residue is quarantined, never sent. A resume that reports zero results and merges everything to rejected is a stall, not a verdict. Write `mv_status, n2b_status` back. Classify gateway domains by MX record and set `mail_class` SEG or OTHER.
Sendable: MillionVerifier ok, or catch all plus No2Bounce deliverable. Nothing enters Smartlead without this step. BillionVerifier and standalone MillionVerifier are not in the stack.
Gate: sendable count and reject rate reported. A reject rate far above the lane's norm means the source is bad, stop and say so.

## Step 7. Normalize (code)

What: four scripts, in this order, each writing a new column, never overwriting the raw one: `name-city-normalization` (first names and cities), `company-name-normalization` (conversational company names), `conversational-location` (Naperville to Chicagoland; a city that cannot be mapped to a metro (NO_GEOCODE) falls back to the raw normalized city, never blank), `sports-team-assignment` (MLB or NFL by distance, college fallback, pro only mode for education; ambiguous nicknames go null and route to the AirPods tier).
Mandatory QA after each normalization or assignment step (first names, cities, company names, conversational location, sports teams, ICP gate labels from step 5.5, campaign routing from step 9): pull 200 random rows per step, check them by a separate pass, and report the error rate per step. Hold the batch if any step exceeds 2 percent errors until it is fixed. Never post rows in chat; counts and up to 10 company names only. The checks per field are in `merge-field-qa`.
Gate: every merge field the copy uses is populated or the row is held.

## Step 8. QA (code purges silently, Cayden clears holds)

What: purge junk titles, students, associates on PE lanes, retail, school districts, and verticals outside the ICP. Hold regulated industries on gift campaigns (banks, credit unions), acronym or broken company names, unresolved teams. Reroute nonprofits and churches to the EOS style offer, never to ticket analytics. The 200-row separate-pass QA from step 7 is the look before moving on; do not post rows.
Gate: holds cleared or excluded; counts of purged and held reported. Error rate per QA'd step reported; hold the batch if any step is over 2 percent.

## Step 9. Route to campaign (code; Josh when copy is needed)

What: assign each lead to the campaign for its cell (band × mail class × gift × offer). Campaign names follow `Client Offer ICP Gift`. A cell with no campaign parks the leads and asks Josh. Building a campaign means: `smartlead-campaign-settings` (plain text, tracking off, stop on reply, AI categories as an integer array, bounce autopause the string "100" meaning off, schedule, current pod mailboxes, `client_id` set, never inherit a template's mailboxes), copy through `salesglider-cold-email-copy`, `subject-line-offer-naming`, `spintax-generator`, `salesglider-unsubscribe`, shown to Josh in full before upload.
Gate: every lead has a campaign id whose client matches.

## Step 10. Stage (code)

What: insert into `public.leads_staging` with `source_dedupe_key = md5(campaign_id || '|' || lower(email))`, `imported = false`, `purge = false`, plus `job_title, company_size, vertical, location, local_sports_team, first_name_n, company_n`. Never stage the same rows twice.
Gate: staged count equals routed count.

## Step 11. Import (code)

What: Smartlead `start_lead_import` from staging (or `stage_leads_from_url`), in chunks. The only success test is `upload_count` equals submitted. A mismatch stops that campaign's import and is reported.
Gate: counts match on every campaign.

## Step 11.5. Write the pull receipt (code, or Claude when the Grok Bot babysitter is not running the lane)

What: one row in `topup.pull_receipts` on `azpapwtnrbzywlnxxecz` per ICP you loaded. The retired leadtopup service is gone; the Grok Bot babysitter (`grok-bot-babysitter`) repeats a pull from `topup.list_build_records` via `record-list-build` (step 11.7), not from this receipt alone. Still write the receipt so the machine recipe and provenance stay linked. Counts and campaign ids only, never emails, names, or lead objects. Record: `client_tag`, `smartlead_client_id`, `lane` and `persona` in snake_case, `campaign_ids`, `icp_kind` (`linkedin_native` or `physical`), where the companies came from (`getleads`, `maps`, `permits`, `maps_and_permits`, `parcels`, `ai_ark`, `table`, or a named signal: `serp_tool_mention`, `theirstack_tech_signal`, `linkedin_engagers`, `linkedin_import`, `web_visitor_pixel`, `job_posting_signal`, `public_records`; never `other`, and a signal must carry its query shape in `company_filters`), the exact `company_filters` as jsonb with headcount as band labels, how the domain, person, and email got there (`already`, `getleads`, `domain_waterfall`, `people_waterfall`, `serp`, `hard_to_find`, `email_waterfall`, `none`), `email_max_tier` if a waterfall ran, `rows_found`, `rows_imported`, `tam_count`, `segment` (band, mail class, gift, offer key the campaigns expect), `yield_by_step` (companies, with domain, with person, with email, verified sendable, imported), `spend_cents`, `suppression_scope`, and `how_i_did_it` in one paragraph. Latest row per lane wins; a redo writes a new row. Two ICPs in one session means two rows. Never write to the parcels or CRM projects.
Gate: the row exists and its campaign ids all resolve in `public.campaigns` (a trigger enforces this). Reply to Josh with client, lane, source, campaign ids, counts. Then stop talking about the rows.

## Step 11.6. Make the leads traceable (code, or Claude when the Grok Bot babysitter is not running the lane)

Read the lead-provenance skill. Register the staging table in `topup.provenance_sources` before import, with a `build_label` equal to the receipt's `build_label`. After import run `select * from topup.stamp_provenance('<client_tag>')`. Gate: `topup.provenance_gaps` has zero `fix` rows for these campaign ids, and the campaign's row in `topup.campaign_recipe` shows the source mix you actually used. A campaign does not go ACTIVE until this passes.

## Step 11.7. Record the build, and any process change (Claude)

Run `record-list-build`: the build record with narrative and full transcript. If anything about the process changed in this session (a new step, tool, label set, a title cut for this client), also write the `topup.process_changes` row described in that skill, so step 0 of the next build picks it up.

## Step 12. Pre launch check (code, wizard helps)

What: `scripts/check_merge_tags.py` from `smartlead-campaign-settings` on every campaign that received leads; signatures present on every linked mailbox; plain text, tracking off, bounce autopause off, AI categories set, schedule Mon to Thu in the client's window, pod mailboxes linked at the staffing floor, placement test passed if the campaign is new. The deliverability wizard converges most of this after the fact; the merge tag gate and settings are still checked at load time.
Gate: receipt posted: campaign, imported, runway before and after, spend by vendor, holds, "ready for ACTIVE."

## Step 13. Flip active and watch day one (Josh)

What: Josh sets the campaign ACTIVE by hand. Nothing automated ever starts, pauses, or stops a campaign. Watch bounces and interested replies (categories Interested and Meeting Request only, never raw reply rate) on the first sending day. Bounce over 5 percent on day one means stop and find the source.

## Where a build stands

When asked where a list build is, answer with the step number, the counts at that step, what gate is unmet, and who it is waiting on. Never reconstruct from chat history if the service ledger or the tables can answer.