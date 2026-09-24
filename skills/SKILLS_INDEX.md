# Skills index

These are the skills Josh has built for SalesGlider Growth. Each folder holds a `SKILL.md` and sometimes a `scripts/` folder. They are the institutional knowledge of the business, written from measured results. Read the skill for a stage before writing code for that stage. Where a skill and the brief disagree, the brief wins and you flag it in the PR.

No skills are marked stale as of D39. The Sept 10 notes on `parlay-lead-pulls` and `conversational-location` were fixed in this repo: the bad master-dedupe SQL is gone, and conversational-location writes `city_normalized` with a blank on NO_GEOCODE. The merged list (`skills/merged-list`) is the 78-item rulebook; the six pending taps are yes. Positives expire 90 days after the reply and replace the customer-list upload (D37).

**Grok bot (D39):** read `grok-bot-babysitter` before any pull skill. Do not
execute `lead-list-build` or a `*-lead-pulls` skill in Grok chat. Start
`start_topup` or hand a CSV URL to LeadPipe. Rows move through `leadpipe`
and `supabase-csv-endpoint`.

## Grok bot and row movement (D39)

* `grok-bot-babysitter` ... Standing orders for Cursor Grok / Slack Cursor on this repo. Allow list / ban list. Infer the job from campaignintelligence tags; do not reconstruct the thirteen steps in chat.
* `leadpipe` ... Store and job runner (Context Saver). `ingest_csv` from a URL, `lp_export` signed URL + count, `lp_sample` ≤10. Counts only. `find_dms_by_title` is ~$0.10/company and is Josh-only.
* `supabase-csv-endpoint` ... Table → public CSV URL and result CSV back in, via edge function. Rows never pass through chat.

## Rulebook

* `merged-list` ... Josh's 78-item list of how every client's lists are built (D35, D36). The six taps are yes.

## After a first pull (so leadtopup can repeat it)

* `first-pull-receipt` ... After Claude builds the first list, write one row to `topup.pull_receipts` (campaignintelligence). Named sources only (`other` is not a value). Lane vs build. Recount before proposing when the latest writer is `claude_backfill` or `claude_backfill_build`. No lead rows. D31–D33.

## Lead pulls per client (these become recipes)

* `parlay-lead-pulls` ... Randy Haba, MSP, IT decision makers. Filter book is the live `it_dm_tickets` lane receipt; the service recipe is `recipes/parlay/it_dm.json`. Suppression is `global-suppression`. Do not delete against `public.leads`.
* `culture-fits-lead-pulls` ... TJ Jackson, MSP owners and C suite. Pool exhaustion reality and corrected getleads parameters.
* `techevo-lead-pulls` ... Corey Tapper. NE IT DM includes NY/NJ. Florida IT DM is statewide; SFL owners stay metro. Small company COO fallback.
* `goliath-lead-pulls` ... Dave Ackley, cybersecurity MSSP. Every lane targets the IT decision maker, not the C suite.
* `salesglider-lead-pulls` ... Josh's own lanes: trades, staffing, PE deal origination. 11 plus employee minimum, PE lane exception, dead lanes.
* `earthworks-lead-pulls` ... Own tag. 180 miles of Dallas. Four lanes. Improved commercial owners: 2+ parcels, 3,958 operators. No getleads.
* `insight-lead-pulls` ... Director+ at 201–2,000 with IT dept ≤15. Gateway catch-alls dropped, not segmented.

## Sourcing and cascade for physical and hard ICPs

* `leadgen-mcp-routing` ... which vendor or server for which job, with measured hit rates and cost per useful output. LinkedIn native versus physical ICP decision. Read this first.
* `tam-sizing` ... size the universe before building a list. Free count endpoints, partition check, two vendor agreement rule. Runs before any pull.
* `domain-waterfall` ... company name plus location to domain. Acceptance gate and sink check.
* `unmask-shell-llc` ... address named shell LLC to the real operating company via the parcel mailing address.
* `people-waterfall` ... company to named decision maker with the client's titles. Title over seniority rule, company match check, name bank.
* `hard-to-find-dm-discovery` ... buyers absent from B2B databases: dealership service departments, trades, local operators. SERP method, two stage email resolution, the catch all problem. Every number measured on a 604 rooftop build.
* `serp-dm-discovery` ... Google indexed LinkedIn profiles via the Apify google search scraper. Fire all batches in parallel, strict company match, current employer audit.
* `unresolved-name-routing` ... never discard a name with no email. Name bank and the resolution ladder.

## Suppression and verification

* `global-suppression` ... the suppression scope (response based, corrected Aug 25), per session rebuild, and the Smartlead block list rule (API added entries are customer requests, never delete).
* `supabase-csv-endpoint` ... (also listed above) serve a table as a public CSV URL for tools that need a file URL (verifier, staging), and read result CSVs back server side. The service should generate signed URLs itself instead of building an RPC per run, but the read back pattern here is the one to keep.

## Normalization (port these into the service, scripts included)

* `name-city-normalization` ... `scripts/normalize_names_and_cities.py`. Strip titles and suffixes, prefer nicknames, fix casing, consolidate informal variants only.
* `company-name-normalization` ... conversational company names. Never overwrite the original column. Rules are inline in the SKILL.md.
* `conversational-location` ... `scripts/conversational_location.py`. Naperville to Chicagoland. Writes `city_normalized`. Never overwrite raw `city`. NO_GEOCODE is a blank location, never a broken sentence.
* `sports-team-assignment` ... `scripts/assign_team.py`. MLB or NFL by distance with college fallback, pro only mode for education lanes. Ambiguous college nicknames go to null, which routes the lead to the AirPods tier.

## Campaign side

* `smartlead-campaign-settings` ... `scripts/check_merge_tags.py`. How a campaign is built and the pre launch QA gate: staffing floor, warmup gate, placement gate, schedule, plain text, tracking off, stop on reply, AI categorization, bounce autopause OFF, mailbox linking, merge tag gate, `upload_count` must equal submitted, null `client_id` breaks reporting.
* `salesglider-cold-email-copy` ... the house copy standard. The service does not write copy. If an agent is ever asked to, it uses this and shows Josh the copy in full before upload.
* `spintax-generator` ... `scripts/check_spintax.py`. 20 bodies per slot, 2 subject variants, inline syntax only, under 90 words on the longest path.
* `subject-line-offer-naming` ... subject is the bare name of the gift, two variants.
* `salesglider-unsubscribe` ... the spun reply based opt out PS that ends every email.

## LinkedIn (out of scope for version one, same leads feed it later)

* `heyreach-campaign-setup`, `heyreach-activity-gate`, `heyreach-workspace-routing`.
