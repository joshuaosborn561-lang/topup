---
name: "icp-website-gate"
description: "Run every new lead pull (email, call or LinkedIn) through our own homepage fetch plus Jev to cut companies that are not the client's ICP, after TAM sizing and the initial pull and before any paid enrichment or verification."
---

# ICP website gate: fetch the site, let Jev pick the category, cut the junk

Use this on every list SalesGlider builds, for any client and any channel: cold email pulls from getleads or AI Ark, Maps and PermitStack builds, caller lists, top ups, HeyReach lists. It runs once the TAM is sized and the first pull has landed in a table, and before anything paid happens to those rows (email finding, mobile finding, verification, imports). It is step 5.5 of `lead-list-build`. Call lists also follow `caller-list-numbers`, which uses this same gate.

Why: filters on industry, titles and keywords let through a lot of companies that aren't the buyer. On Cayden's call lists about 22% of companies were junk: suppliers, rental yards, GCs, consultants, franchises, homeowner-only shops. Last night's DiscoLike check had passed 60 of 107 that Jev correctly flagged as GCs, dealers and rental companies. Cutting them before enrichment saves the enrichment money and the send reputation.

## Order
1. **TAM sized** (`tam-sizing`, `getleads-tam-counting`) and Josh has signed off the segment.
2. **Initial pull** lands in a build or ingest table with a domain per company. No domain? Run `domain-waterfall` or DiscoLike bulk match first (about $0.0038 per company; match by distinct company, not per contact row).
3. **Free SQL pass.** If the source gives industry or a description, drop anything described as supplier, distributor, wholesaler, manufacturer, rental, engineering, consulting, staffing or software. Only where those are not the client's buyer: for Deep Roots manufacturers are the buyer.
4. **Fetch the sites ourselves (free).** Insert distinct domains into `client_salesglider.icp_site_text (domain, batch)` with a batch name per client and list. Call the `icp-site-fetch` edge function (key `Sf4Ht8Mz2Qa6`) with `?batch=<name>&n=100&w=30`, up to 3 calls side by side, until `remaining` is 0. Rows are claimed safely, so parallel calls never overlap. Speed measured Oct 9 2026: about 2,300 sites in 3 minutes. It saves the homepage plus up to 2 subpages (commercial, services, products, about). About 96 to 97% of sites come back readable.
5. **Jev picks a category.** Call `icp-llm` (key `Il5Gm3Jv8Rx2`) with `mode=run&batch=<name>&model=jev:typesafe/jev-1.13|<variant>&n=300&w=20`. After the claiming patch in `docs/patches/icp-llm-row-claim.md` is deployed, run 3 to 5 calls side by side on the same batch; rows are claimed with an expiring `in_progress` lease, so copies do not double-grade or double-pay. Until that patch is live, one call at a time per batch (the live function still has no row claiming). Repeat until `remaining` is 0. It uses `openrouter_api_key` from the vault and OpenRouter's Decisions API. Results go to `client_salesglider.icp_llm_results` with `fit`, `prob`, the chosen label in `reason` and the raw answer in `answers`. A restart resumes only rows with no finished result and no live lease.
6. **Fallback for unreadable sites.** Call `icp-disco-fallback` (key `Df7Kb2Wn5Hq8`) with `mode=submit&batch=<name>&icp=<salesglider|emcor|deeproots>`, then `mode=collect&task=<id>&batch=<name>` every 20 seconds. Results land in `icp_llm_results` as model `discolike:website`. One DiscoLike task at a time, never concurrent. For a new client, add its ICP text to the function first, written under `Mandatory:`, `Reject if:` and `Nice-to-have:`.
7. **Write the verdict onto the lead rows**, never delete: add `icp_gate` (yes or no), `icp_gate_label` and `icp_gate_at` columns to the build table (or `call_contacts` for call lists). Only `icp_gate = 'yes'` moves on to enrichment, verification, routing and import. Flagged rows stay in the table, so the decision can be audited or reversed.
8. **Look, but do not halt the pipeline.** Show Josh the label counts and up to 10 flagged and 4 passed sample rows (domain, label, a short site snippet). If one label swallows a big share, the label set is wrong: fix it before going further (see EMCOR below). Start the 200-row ICP sample in a separate pass the moment verdicts exist, and start people / email / verify on `icp_gate = yes` in the same session. Do not wait on the sample. A fail holds only before Smartlead import (`lead-list-build` step 11), never mid-pipeline.
9. **First run for a client or source:** have 50 verdicts checked against the real websites by a separate agent before trusting the gate at scale. Write the accuracy into this skill.

## Label set must exist before any run

Read `topup.icp_variants` for this `client_tag` (and lane, when a client has more than one ICP) **before** inserting domains or calling `icp-site-fetch` / `icp-llm`. The row must name a variant that already exists in `icp-llm` JEV_Q and PASS, written for that client's ICP.

- No row, or a row that only points at another client's variant: park. Tell Josh which client is missing a label set. Do not invent labels. Do not copy Parlay, SalesGlider, or anyone else as a stand-in.
- TechEvo has no TechEvo label set yet. Park. Do not invent one. Do not run `itbuyer` / `itbuyer2` as if it were TechEvo's ICP.
- A new set still gets the 50 site blind check on its first run.

## ICP sample bar (false passes only)

Josh's hold-if-over-2-percent-wrong rule still applies. For this gate the 2 percent line counts **false passes only**: a company that is not the buyer, scored `icp_gate = yes`. Track false cuts (a real buyer scored `no`) as a separate rate and report both. A high false-cut rate is a label-set problem to take to Josh; it does not by itself hold import. Folding false cuts into the 2 percent line is how a conservative gate looks like a QA fail.

## Label sets (variants in `icp-llm` JEV_Q)
A variant is ONE `choice` question: a passing label that describes the real buyer, plus one label per kind of junk that client's lists attract. Only the passing label (PASS map) is a yes.
- **SalesGlider `choice`**: commercial_trade_contractor passes. Others: residential_trade_contractor, general_contractor, supplier_manufacturer_rental, consultant_engineer, franchise_or_chain, other_not_contractor.
- **EMCOR / Mesa `emcor2`**: buyer_with_own_facility passes (anyone who runs their own building and pays for heating and cooling). Others: hvac_or_building_services_contractor (competitor), other_construction_contractor, national_chain_or_public_corporation, homeowner_or_home_based, no_physical_facility. Geography comes from list data, not the label.
- **Deep Roots `deeproots`**: independent_manufacturer passes. Others: dealer_distributor_wholesaler, contractor_or_trade, trucking_logistics, subsidiary_chain_or_franchise, farm_or_consumer_service, other. Size and geography come from list data.
- **Any other client** (Parlay, Culture Fits, Goliath, TechEvo, BCP, Peterson, Nutter, PowerGRYD, Vasco, new clients): write the variant from the client's ICP before the first run, add it to JEV_Q and PASS in `icp-llm`, add the row in `topup.icp_variants`, and redeploy. Until that is done, the gate parks. Culture Fits, for example: managed_service_provider passes; VAR or reseller, software vendor, telecom or cabling only, IT staffing, consultancy, internal IT department are the junk labels. TechEvo: none written yet; park; do not invent.

## Writing labels that work
- **Category pick, not yes or no.** On Cayden's 200 (191 scored, checked against real sites): a single yes or no Jev question scored 88%, a stack of narrow yes or no questions 87%, the category pick 92.7%. Flash-Lite with a long prompt scored 89%; DiscoLike's own checks scored 83 to 85%.
- **The passing label describes the buyer broadly.** Don't make it a short list of examples. EMCOR v1 listed building types, and Jev dumped plants, clinics, a self storage operator and a vet hospital into "other": 58% flagged. v2 said "any organization that runs its own building" and dropped the catch-all label: 12% flagged, and the flags made sense.
- **Avoid a vague catch-all** ("other, or too thin to tell") unless the junk really is miscellaneous. Jev uses it as a default.
- **Tune on half, score on the other half.** Never tune labels and score them on the same rows.

## Cost (Oct 2026)
- Site fetch: free (Supabase function time only).
- Jev: about $0.11 per 1,000 sites, input tokens only. 50,000 sites is about $5.50.
- DiscoLike fallback: about $0.0038 per unreadable site, roughly 3 to 4% of a list.
- Rule of thumb: the whole gate costs about $0.25 per 1,000 domains. Estimate it in the plan anyway and tell Josh the figure; under $5 a run can go ahead with the pull approval.

## Safety rules
- The project database (azpapwtnrbzywlnxxecz) has a hard cap of 60 connections, shared with the live Allo hooks and Gabe's email router. Edge functions open one connection per call (or use `idle_timeout`). Never fire more than 3 parallel fetch calls. Jev: one call at a time until the claiming patch is live; then 3 to 5 `icp-llm` calls on the same batch, never more than 5. If you see "remaining connection slots are reserved", stop all runs, terminate idle `postgres.js` connections older than 20 seconds via `pg_terminate_backend`, and check that the Allo hooks returned 200 in that window.
- No lead rows in chat: counts, labels and at most 10 sample domains with a snippet.
- Never remove numbers from a caller's Allo queue or leads from a live campaign on this gate's say-so without Josh approving the counts first.
- Never use Claude via the API to classify. Jev (OpenRouter) and Josh's Gemini key are fine.