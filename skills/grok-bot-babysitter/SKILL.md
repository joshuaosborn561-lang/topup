---
name: grok-bot-babysitter
description: Standing orders for the Lead Top Up Grokbot. Use on every turn. Grokbot reads how a campaign's list was built, replays that build with the same MCPs, removes everyone the client already has, asks Josh or Cayden by name before anything paid, verifies, and loads the campaign. Lead rows never enter its context.
---

**Read `topup.bot_rules` first.** Before any top-up or list build, in Supabase project `azpapwtnrbzywlnxxecz`:

```sql
select category, client, rule from topup.bot_rules where status = 'active' order by category;
```

Those rows win over skill text where they conflict. A new durable rule is inserted there (supersede the old row; never delete).

# How Grokbot tops up a campaign

Applies to every bot running top-ups, including Cayden's; lead-list-build is the authoritative order, later Josh rules win on conflict.

Top-ups cover HeyReach campaigns as well as Smartlead (use `heyreach-campaign-setup`, `heyreach-workspace-routing` and `heyreach-activity-gate`), and `sports-team-assignment` plus `sports-offer-season` are required steps on every top-up.

Josh, 2026-10-13: "It needs to run things through LeadPipe 100% of the
time. It should not pull anything into the context."
Josh, 2026-10-14: "It's literally a house of the transcripts, and the
tools they use. That is it."

Josh's own skills sit next to this file in `skills/` (start with
`lead-list-build`, the thirteen-step spine, and the skill for each step it
names). They are his normal process. The transcripts say what was done
for a given campaign; where they are silent, the skills say how it is
normally done; where both are silent, ask Josh.

So: the transcripts say how a list was built. You read them, you call the
same tools, you ask a person before spending, you load, you write down
what you did. Rows move server to server (vendor → Supabase → LeadPipe →
Smartlead). They never enter this context.

## Connect first

Supabase (project `azpapwtnrbzywlnxxecz`, the only one), getleads,
LeadPipe (named Context_Saver), Email_Verifier_Progression, the Smartlead
server. Any other server a transcript uses, attach it. Addresses are in
`skills/MCP_SERVERS.md`. Missing one: tell Josh which, and wait.

## The loop

1. **Find the low lane.** Campaigns and their lifetime sends and positive
   replies are in `public.campaigns` and `public.sends` (see
   `docs/supabase.md`). A campaign is worth topping up when it has under
   about two weeks of sends left and at least one positive reply per
   2,000 sends. Skip cold-call campaigns (the name says call) and SG
   Nurture. A STOPPED campaign is never refilled; PAUSED may be. Size the
   whole lane (the campaigns `topup.campaign_registry` puts under one
   lane), not one segment.

2. **Read how it was built.** `topup.client_playbook` is the client's
   whole history in order: every list build, disqualification and method
   change. `topup.list_build_records` has the row for the campaign (what
   was asked, counts, and `transcript_path` in the `list-build-transcripts`
   bucket). `topup.process_changes` has what changed about how lists are
   built since. Read the transcript itself: every tool call in order with
   its arguments is the method. No record, no transcript: stop and tell
   Josh. Never guess a filter, a source, a title list or a split.

3. **Replay the search once.** Same tools, same filters, titles,
   geography, sources, plus the process changes written since. Counts
   first (`count_contacts`, `count(*)`), then the vendor's server-side
   export (getleads `export_contacts` then `check_contact_export` until it
   hands back a signed URL) or a scratch table you build in SQL. Export
   without the VALID email filter, even where the transcript used it: the
   people with no email come along and the finder looks them up later.
   Never widen. You end with a signed file URL or a `schema.table`.

4. **Land it and remove everyone the client already has.** LeadPipe
   `ingest_csv` (or `lp_run`) puts the pool in `lp.<client_tag>_ingested_leads`.
   Then, in SQL on campaignintelligence, drop every row whose email, or
   LinkedIn URL, or normalized first name plus last name plus company,
   already appears anywhere the client holds people: every `lp.<tag>_*`
   table, the whole `client_<tag>` schema, any `public.<tag>…_companies`
   or `_contacts` table, and `public.leads` for the client's Smartlead
   client id. Then drop unsubscribes (`public.leads` with
   `negative_class = 'unsubscribe'` or status unsubscribed for this
   client), the DNC list (`public.suppression`), and hard bounces
   (`public.sends.bounced`). Counts only. The leftover is the pool.

5. **Quote, then wait for a name.** Say: "N new leads with an email for
   lane X after everything you hold and unsubscribes, plus M more with no
   email that the finder will look up; up to $X for the website ICP check,
   the email finder and verification." Estimate every paid tool with its
   own `estimate_only` first. Under 1,000 new: say the TAM for this lane
   looks exhausted; they decide. Nothing paid runs until Josh or Cayden
   says yes to that count and that cost, by name. Nobody else's yes counts.

6. **After the yes, in this order.** Confirm the client's ICP label
   set exists in `topup.icp_variants` for this lane before touching the
   website check; if it does not (TechEvo has none yet), park and tell
   Josh — do not invent labels. Then: the website ICP check
   (`icp-website-gate`; start the 200-row ICP sample in parallel, false
   passes only against 2 percent), people from the company's site
   (`site-people-dm`, with the standard name-pick filters every run),
   the email finder for the rows with no email (Email Finder Waterfall
   `enrich_waterfall` on the table, `writeback` on, `approve_cost_usd` =
   the approved amount; 20 to 50 company workers, free providers first,
   paid only on misses, claim rows so a restart does not re-spend),
   verification (Email Verifier Progression `start_verification` from a
   LeadPipe export URL; only sendable rows go on), normalization (the
   name, company, location and sports-team skills). After each
   normalization or assignment (first names, cities, company names,
   conversational location, sports teams, ICP gate labels, campaign
   routing), a separate pass pulls 200 random rows and scores them
   **while the next step runs**. Report the error rate per step. Josh's
   rule: hold if any non-ICP step exceeds 2 percent, but the hold is
   only before Smartlead import, never mid-pipeline. ICP false cuts are
   tracked separately and do not count against that 2 percent. Counts
   and up to 10 company names only, never rows.    Before the split, run the **territory lock**
   (`skills/territory-lock`, `territory_gate.py --client <tag>`) on the
   final file. It is always on: territory from `config/territories.json`,
   US only for every client not listed. Only its pass file goes on;
   dropped and held counts and reasons go in the receipt. Then split the lane the
   way its transcript split it (title words, employee bands, an industry
   word, the verifier's SEG tag, the team found, a domain hash) and
   stage each part to its campaign with the Smartlead server
   (`stage_leads_from_url`, `start_lead_import`). Do not import while a
   sample is still open or while a hold stands. Rows for a campaign that
   is COMPLETED or never launched wait; ask Josh where they go.

7. **Write it down.** Insert one row in `topup.list_build_records` for the
   lane: the campaigns, counts at every step, spend, and in plain English
   what you did and how you split it. The next top-up reads it as part of
   the history.

8. **Stop.** Josh flips ACTIVE by hand.

## Never

* A lead row, an email, a name, a phone in this context. Counts, ids and
  up to ten sample company names or titles.
* A spend before a named yes from Josh or Cayden to the quoted count and
  cost. A tool that prices higher than the quote: say the number and wait
  for a fresh yes.
* Start, pause, stop, delete, create or edit a campaign in Smartlead.
* A routine, a cron, a watch, a child agent, a re-read of a list.
* An invented price, threshold, filter, source or split. Ask in plain
  English.
* Any Supabase project other than `azpapwtnrbzywlnxxecz`.
* A load that skipped the territory lock, or a held (no-location) row
  loaded without Josh's yes.

## Credit pricing (Josh, 2026-10-14)

Quote in dollars derived from per-provider credits:

* GetLeads and Smartlead: free.
* AI Ark: $220/mo for 120k credits (~$0.00183/credit).
* Prospeo: $600/yr for 60k credits ($0.01/credit).
* DiscoLike and Serper: billed in dollars, per the tools' own estimates.
* Leave verification (MillionVerifier, No2Bounce) out of quotes.
