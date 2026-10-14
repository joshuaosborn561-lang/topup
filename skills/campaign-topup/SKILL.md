---
name: "campaign-topup"
description: "Top up an existing SalesGlider Growth Smartlead campaign with more of the same people, starting from the written recipe of how its leads were pulled last time. Use whenever Cayden or Josh says top up, refill, add leads, get more like these, or the campaign is running dry, for any client and any source (getleads, Maps, PermitStack, parcels, SERP, engagers). Replaces the Grokbot flow as of Sept 29 2026; Cayden runs it, Josh approves spend above $5 and signs off the segment. Reads the campaign recipe from the topup service (topup_recipe, or topup.recipe in Supabase until the MCP tool ships) first, never infers the method from tags, and ends by writing the next receipt so the one after can be repeated the same way."
---

# Campaign top up

You are running a top up for one Smartlead campaign. The campaign already has leads, and the way they were pulled is written down in Supabase project `azpapwtnrbzywlnxxecz` (campaignintelligence). Your job is to read that, get more of the same people, load them, and write down what you did. Counts only in chat, never lead rows.

## 0. Inputs
- `client_tag` (peterson, peterson_earthworks, bcp, culture_fits, parlay, goliath, techevo, insight, powergryd, emcor, vasco, salesglider) and the Smartlead `campaign_id`.
- How many leads are wanted. If not stated, aim for what the campaign consumed in the last two weeks of sending.

## 1. Read the recipe (free, always first)
Call `topup_recipe(client_tag, campaign_id)` on the topup service MCP (repo joshuaosborn561-lang/topup; HTTPS MCP at https://leadtopup-production.up.railway.app/mcp with the operator bearer token, added as a custom connector in claude.ai). If that tool is not in your tool list yet, run the same thing through the Supabase connector on azpapwtnrbzywlnxxecz:
```sql
select topup.recipe('<client_tag>', <campaign_id>);
```
The topup service owns the recipe (what was done and why). LeadPipe only executes pulls. Campaign watchdog only flags a campaign that needs one; when it does, it hands you this recipe.
Read every entry in `builds`. Each has a `method` paragraph, the source tags, `company_filters`, counts and `interested`. Decide from that, not from the label names.

**Then read what has changed since that recipe was written.** The recipe says how the list was built last time; the process may have changed since. Read the process change rows, newest first, and apply them on top of the recipe:
```sql
select id, client_tag, created_at, summary, transcript_path
from topup.process_changes
where client_tag is null or client_tag = '<client_tag>'
order by created_at desc;
```
A global row (`client_tag` null) applies to every client (for example: every pull now goes through the ICP website gate before anything paid). A client row applies to that client only (a title taken out, a lane retargeted, a label set tuned). If a summary is not enough to act on, read its transcript from Storage bucket `list-build-transcripts` at `transcript_path`, server side, never into chat. The `record-list-build` skill is what writes these rows.

Stop and report instead of pulling when:
- `leads_without_method` > 0: register the missing table or write the missing receipt first (lead-provenance skill). Do not guess.
- `any_reconstructed` is true: the paragraph describes a pre labeling build with no recorded filters. This is a first pull, not a top up: size TAM with the tam-sizing skill and get Josh's sign off on the segment before spending.
- The campaign is below the working bar (1 interested per 2,000 sends, or a variant with 1,000 plus sends clearing it): topping up a campaign that does not work wastes money. Tell Josh and stop.

Pick the build to repeat: the one with the best interested rate at meaningful volume. If several builds fed the campaign by different routes, repeat each route separately and write one receipt each.

**If the recipe names LeadMagic** (a person source of `leadmagic_employee_finder` or an `email_max_tier` of `leadmagic`): LeadMagic was removed from the stack Oct 8 2026. Repeat the route with AI Ark in its place (AI Ark preview with titles for people; Email Finder Waterfall with `max_tier='prospeo'` and `skip_tiers='leadmagic'` for email), say in the receipt that the vendor was swapped, and compare yield to the original build in your report.

## 2. Plan
`lp_plan` with `client_tag`, the source from the paragraph, and the filters from `company_filters` (bands as exact labels like `"51 to 200"`, never min or max). The plan is free. Read back the estimated cost.
- getleads and Supabase: run without asking.
- Anything paid (AI Ark, Prospeo, FullEnrich, Email Waterfall, Verifier, Maps, Apify): state the dollar figure. Under $5 total, proceed. $5 or more, wait for Josh.

## 3. Pull
`lp_run` with `approve_cost_usd` as the ceiling. Poll `lp_status`. Success is `useful_output_count`, never rows processed. Zero useful output is a failure; say so.

Then, in this order, using the skills named: global-suppression (rebuild, 90 day prior contact for this client, same offer never twice to one person), the ICP website gate (`icp-website-gate`, every distinct domain, before anything paid; only `icp_gate = yes` moves on), Email Verifier Progression on everything (MillionVerifier then No2Bounce; nothing enters Smartlead unverified), the enrichment skills the campaign's merge fields need (name-city-normalization, company-name-normalization, conversational-location, sports-team-assignment when there is a Local_Sports_Team field, sports-offer-season to confirm which league), merge-field-qa.

## 4. Load
Import to the same campaign via `stage_leads_from_url` with `auto_import=true`; `upload_count` must equal what you submitted. Read three leads back at different offsets before declaring it loaded. Use the smartlead-campaign-settings skill only if settings drift is suspected; do not change copy.

## 5. Write it down (not optional)
1. Build receipt in `topup.pull_receipts`, `granularity = 'build'`, a new `build_label` (for example `<client>_<lane>_topup_<yyyymmdd>`), and a self contained `how_i_did_it` (first-pull-receipt skill). Copy the real filter object into `company_filters`. Set `basis_receipt_ids` to the receipt you repeated.
2. Register the staging table in `topup.provenance_sources` emitting that label (lead-provenance skill), run `select * from topup.stamp_provenance('<client_tag>');`, and check `select * from topup.provenance_gaps where verdict like 'fix%';` is empty for this campaign.
3. Read back `topup_campaign_builds` (or `select * from topup.campaign_builds where smartlead_campaign_id = <id>`) and confirm your new build appears with its paragraph.
4. If anything about the process changed during this session (not just the counts), write a `topup.process_changes` row with the transcript (record-list-build skill, the addendum section).

## 6. Report
Client, campaign id, build repeated, leads found, verified, imported, spend, receipt label. One short paragraph. Josh does not want a summary of steps.

## Do not
- Do not infer the method from tags when the paragraph exists; do not pull when it does not.
- Do not widen bands, add titles or change the ICP without Josh; a top up repeats, it does not redesign.
- Do not touch copy, mailboxes or schedule.
- Do not use PDL, Clay, LeadMagic, BillionVerifier or a standalone MillionVerifier connector.
- Do not move lead rows through chat; file URLs only.