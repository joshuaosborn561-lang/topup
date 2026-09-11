---
name: lead-list-build
description: The SalesGlider Growth soup to nuts procedure for building or topping up a lead list for any client and any source, in thirteen steps from ICP to a live campaign. Use whenever Josh asks to build a list, top up a campaign, refill a lane, pull leads for a client, or asks where a list build stands, regardless of whether the leads come from getleads, Google Maps, PermitStack, parcels, public records, or a hand filled queue table. This is the spine that every other lead skill hangs off of; it names which skill governs each step, which tool runs it, what gate must pass before the next step, and who owns the decision (code, Cayden, or Josh). Always follow this order. Skipping or reordering steps is how bad lists have shipped.
---

# Lead list build, soup to nuts

Thirteen steps. Steps 3 through 12 are mechanical and belong to the top up service (or to Claude when the service does not exist yet for that lane). Steps 1, 9 when new copy is needed, and 13 are Josh's. Never advance a step until its gate passes. Report every count as net useful output, never rows processed.

Rules that apply to every step: no lead rows in chat beyond ten sample rows; data moves server to server; estimate and get approval before any paid call; pass `client_tag` on every job; confirm the Supabase project before writing (`azpapwtnrbzywlnxxecz` campaign and lead data, `kemvxzhcxvynmoutwdrh` parcels, `klomihumrgwoixbzxypr` CRM); one session at a time on a client's tables.

## Step 1. Nail the ICP for the lane (Josh)

What: titles, headcount bands, geography, industries, offer family, gift tier. Decide the cells up front: band × gateway (SEG or OTHER) × gift (team or AirPods) × offer.
Source: the client's lead pull skill (`parlay-lead-pulls`, `culture-fits-lead-pulls`, `techevo-lead-pulls`, `goliath-lead-pulls`, `salesglider-lead-pulls`) plus the latest client call in Fireflies. ICP drift is common; the call wins over the skill and the skill gets updated.
Gate: every cell has a campaign or Josh knows one must be built. Josh signs off on the segment before anything is pulled.

## Step 2. Size it (code)

What: count the segment on more than one free or near free source before pulling. getleads `count_contacts`, DiscoLike counters, LeadMagic and AI Ark counts, Maps or PermitStack counts for physical lanes. Run the partition check that proves the filters bind. Trust a number only when two sources agree.
Then: subtract what has already been sent to this ICP (`public.leads`, `leads_staging`) to get projected net new.
Skill: `tam-sizing`.
Gate: projected net new is above the useful floor (default 200). If thin, present widening options with counts; Josh decides. Never widen unasked, never declare a pool exhausted.

## Step 3. Pull (code, paid tiers approved by Josh)

Two flavors. Both end with rows in a table, never in chat.

LinkedIn native lanes (Parlay, BCP, Culture Fits, TechEvo, Goliath, Insight, SG lanes): getleads `export_contacts` with `company_size` as exact band labels like `["51 to 200"]`, `email_status ["VALID"]` only, industries validated against the catalog (commas shred silently). Poll, take the S3 URL. If getleads under delivers on the companies, cascade: AI Ark people discovery on the misses (audit titles after, it returns whoever appears first at a domain), then LeadMagic bulk `employee_finder`, title filter in SQL, then `work_email_finder` (nine times cheaper than `search_people`). FullEnrich last and only if stamped on.
Skill: the client pull skill, `leadgen-mcp-routing`.

Company first lanes (Peterson roofing, Earthworks, Vasco, trades): the source gives a business or a name, not an email. Google Maps Scraper (outcome mode, `estimate_only` first) by category and geography, PermitStack by permit type and date and county, parcels by use code and county, IRS 990 and Texas Comptroller officers for names. Then walk it: `unmask-shell-llc` for address named owners; Domain Waterfall for domains (`domain-waterfall`); Find Named Person or getleads by domain or LeadMagic employee finder for people with the client's titles (`people-waterfall`, `serp-dm-discovery`, `hard-to-find-dm-discovery`); Name to Email first, then Email Finder Waterfall in `source_table` plus `writeback` mode for addresses. Bank every name with no email (`unresolved-name-routing`). Run a pilot of about 100 through the full cascade before scaling and report cost per usable lead.
Gate: useful output counted, titles audited, spend within the approved ceiling.

## Step 4. Ingest (code)

What: LeadPipe `lp_run ingest_csv` from the URL into `lp.<tag>_ingested_leads` with a `source_label` naming the lane and run. Take Contact City not Work City. Confirm `city, state, industry, employee_range` landed.
Gate: row count equals the export count.

## Step 5. Suppress and dedupe (code)

What, in one SQL pass, response based only: positive repliers, do not contact, wrong person from any client; `public.suppression`; the client's own customer domain list (must be applied before anything loads, ask Cayden for it if missing); bounces from any client; anyone already in any of this client's campaigns via `leads_staging` (older copy wins, it has send history; Smartlead only dedupes inside one campaign); anyone who already received the same offer from another client. Other clients emailing the same person with a different offer is allowed.
Skill: `global-suppression`. Never dedupe against all of `public.leads`; that killed 87 percent of a good pull.
Gate: report raw, removed by reason, net new. Net new is the number from here on.

## Step 6. Verify (code, paid, estimate first)

What: serve the rows as a public CSV URL (`supabase-csv-endpoint`), Email Verifier Progression `start_verification`, poll every minute. Stall runbook: at 90 percent plus with no progress for 12 minutes, `resume_verification` once (free); if still stuck, split the remainder in halves and resubmit (that can bill, so it follows the spend rule); down to 50 rows; residue is quarantined, never sent. A resume that reports zero results and merges everything to rejected is a stall, not a verdict. Write `mv_status, n2b_status` back. Classify gateway domains by MX record and set `mail_class` SEG or OTHER.
Sendable: MillionVerifier ok, or catch all plus No2Bounce deliverable. Nothing enters Smartlead without this step. BillionVerifier and standalone MillionVerifier are not in the stack.
Gate: sendable count and reject rate reported. A reject rate far above the lane's norm means the source is bad, stop and say so.

## Step 7. Normalize (code)

What: four scripts, in this order, each writing a new column, never overwriting the raw one: `name-city-normalization` (first names and cities), `company-name-normalization` (conversational company names), `conversational-location` (Naperville to Chicagoland; NO_GEOCODE rows get a blank location, never a broken sentence), `sports-team-assignment` (MLB or NFL by distance, college fallback, pro only mode for education; ambiguous nicknames go null and route to the AirPods tier).
Gate: every merge field the copy uses is populated or the row is held.

## Step 8. QA (code purges silently, Cayden clears holds)

What: purge junk titles, students, associates on PE lanes, retail, school districts, and verticals outside the ICP. Hold regulated industries on gift campaigns (banks, credit unions), acronym or broken company names, unresolved teams. Reroute nonprofits and churches to the EOS style offer, never to ticket analytics. Look at ten sample rows before moving on.
Gate: holds cleared or excluded; counts of purged and held reported.

## Step 9. Route to campaign (code; Josh when copy is needed)

What: assign each lead to the campaign for its cell (band × mail class × gift × offer). Campaign names follow `Client Offer ICP Gift`. A cell with no campaign parks the leads and asks Josh. Building a campaign means: `smartlead-campaign-settings` (plain text, tracking off, stop on reply, AI categories as an integer array, bounce autopause the string "100" meaning off, schedule, current pod mailboxes, `client_id` set, never inherit a template's mailboxes), copy through `salesglider-cold-email-copy`, `subject-line-offer-naming`, `spintax-generator`, `salesglider-unsubscribe`, shown to Josh in full before upload.
Gate: every lead has a campaign id whose client matches.

## Step 10. Stage (code)

What: insert into `public.leads_staging` with `source_dedupe_key = md5(campaign_id || '|' || lower(email))`, `imported = false`, `purge = false`, plus `job_title, company_size, vertical, location, local_sports_team, first_name_n, company_n`. Never stage the same rows twice.
Gate: staged count equals routed count.

## Step 11. Import (code)

What: Smartlead `start_lead_import` from staging (or `stage_leads_from_url`), in chunks. The only success test is `upload_count` equals submitted. A mismatch stops that campaign's import and is reported.
Gate: counts match on every campaign.

## Step 12. Pre launch check (code, wizard helps)

What: `scripts/check_merge_tags.py` from `smartlead-campaign-settings` on every campaign that received leads; signatures present on every linked mailbox; plain text, tracking off, bounce autopause off, AI categories set, schedule Mon to Thu in the client's window, pod mailboxes linked at the staffing floor, placement test passed if the campaign is new. The deliverability wizard converges most of this after the fact; the merge tag gate and settings are still checked at load time.
Gate: receipt posted: campaign, imported, runway before and after, spend by vendor, holds, "ready for ACTIVE."

## Step 13. Flip active and watch day one (Josh)

What: Josh sets the campaign ACTIVE by hand. Nothing automated ever starts, pauses, or stops a campaign. Watch bounces and interested replies (categories Interested and Meeting Request only, never raw reply rate) on the first sending day. Bounce over 5 percent on day one means stop and find the source.

## Where a build stands

When asked where a list build is, answer with the step number, the counts at that step, what gate is unmet, and who it is waiting on. Never reconstruct from chat history if the service ledger or the tables can answer.
