---
name: "campaign-topup"
description: "Top up an existing SalesGlider Growth Smartlead campaign with more of the same people, by replaying how its list was built. Use whenever Cayden or Josh says top up, refill, add leads, get more like these, or the campaign is running dry, for any client and any source (getleads, Maps, PermitStack, parcels, SERP, engagers). The leadtopup / Top_Up service is retired (D110); top ups run the Grok Bot babysitter flow (skills/grok-bot-babysitter): read the lane's row in topup.list_build_records and its transcript (written by record-list-build), replay the same tools, get a named yes before anything paid, load, and write the build record, pull receipt and provenance."
---

# Campaign top up

You are running a top up for one Smartlead campaign. The campaign already has leads, and the way they were pulled is written down in Supabase project `azpapwtnrbzywlnxxecz` (campaignintelligence). The leadtopup / Top_Up service and its recipe tools are retired (D110). The flow is the Grok Bot babysitter: follow `skills/grok-bot-babysitter` step by step. This file only adds what that flow needs from the rest of the skills. Counts only in chat, never lead rows.

## 0. Inputs
- `client_tag` (peterson, peterson_earthworks, bcp, culture_fits, parlay, goliath, techevo, insight, powergryd, emcor, vasco, salesglider) and the Smartlead `campaign_id`.
- How many leads are wanted. If not stated, aim for what the campaign consumed in the last two weeks of sending.

## 1. Read how it was built (free, always first)
Babysitter step 2. Read `topup.client_playbook` for the client's history, the campaign's row in `topup.list_build_records` (written by `record-list-build`), and the transcript at its `transcript_path` in bucket `list-build-transcripts`, server side, never into chat. The transcript's tool calls, in order, with their arguments, are the method.

Then read what has changed since, newest first, and apply it on top:
```sql
select id, client_tag, created_at, summary, transcript_path
from topup.process_changes
where client_tag is null or client_tag = '<client_tag>'
order by created_at desc;
```
A global row (`client_tag` null) applies to every client; a client row applies to that client only.

Stop and tell Josh instead of pulling when:
- There is no `list_build_records` row or no transcript for the campaign. Never guess a filter, source, title list or split.
- The record says the build was reconstructed (no recorded filters). That is a first pull, not a top up: size it with `tam-sizing` and get Josh's sign off on the segment.
- The campaign is below the working bar (1 interested per 2,000 sends, or a variant with 1,000 plus sends clearing it).

**If the transcript used LeadMagic** (a people roster tier or a `leadmagic` email tier): LeadMagic was removed from the stack Oct 8 2026. Replay the route with AI Ark in its place (AI Ark preview with titles for people; Email Finder Waterfall with `max_tier='prospeo'` and `skip_tiers='leadmagic'` for email), say in the build record that the vendor was swapped, and compare yield to the original build.

## 2. Replay, quote, and wait
Babysitter steps 3 to 5: replay the search once with the same tools and filters (no VALID email filter on exports), land it in LeadPipe, remove everyone the client already has, then quote the count and the cost. getleads and Supabase are free. Nothing paid runs until Josh or Cayden says yes to that count and that cost, by name.

## 3. After the yes
Babysitter step 6, using the skills named: `icp-website-gate`, Email Finder Waterfall for rows with no email, Email Verifier Progression on everything (nothing enters Smartlead unverified), normalization (`name-city-normalization`, `company-name-normalization`, `conversational-location`, `sports-team-assignment`, `sports-offer-season` to confirm the league), the 200 row QA per step from `merge-field-qa`, then the split the transcript used.

## 4. Load
Stage to the same campaign via `stage_leads_from_url` with `auto_import=true`; `upload_count` must equal what you submitted. Read three leads back at different offsets before declaring it loaded. Do not change copy or settings.

## 5. Write it down (not optional, the bot writes all three)
1. The build record in `topup.list_build_records` (`record-list-build`; babysitter step 7). This is what the next top up reads.
2. The pull receipt in `topup.pull_receipts` (`first-pull-receipt`), `granularity = 'build'`, a new `build_label` (for example `<client>_<lane>_topup_<yyyymmdd>`), the real filter object in `company_filters`, `basis_receipt_ids` set to the receipt for the build you replayed.
3. Provenance (`lead-provenance`): register the staging table in `topup.provenance_sources` emitting that label, run `select * from topup.stamp_provenance('<client_tag>');`, and check `select * from topup.provenance_gaps where verdict like 'fix%';` is empty for this campaign.
4. If anything about the process changed during this session, write a `topup.process_changes` row (`record-list-build`, the addendum section).

## 6. Report
Client, campaign id, build replayed, leads found, verified, imported, spend, receipt label, build record id. One short paragraph. Josh does not want a summary of steps. Josh flips ACTIVE by hand.

## Do not
- Do not infer the method from tags or labels; read the transcript. No transcript, no pull.
- Do not widen bands, add titles or change the ICP without Josh; a top up repeats, it does not redesign.
- Do not touch copy, mailboxes, schedule or campaign status.
- Do not use PDL, Clay, LeadMagic, BillionVerifier or a standalone MillionVerifier connector.
- Do not move lead rows through chat; file URLs only.