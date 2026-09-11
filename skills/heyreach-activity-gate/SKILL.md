---
name: heyreach-activity-gate
description: Gate every HeyReach lead upload on recent LinkedIn activity, so only people who published a post, repost, or quote post in the last 30 days get loaded into a list. Use this whenever Josh pushes, uploads, loads, or tops up leads into HeyReach for any client or any lane, even when he does not mention activity, filtering, or "active" at all. Also use when he asks who has been active on LinkedIn, wants to filter a list by activity, mentions dead or inactive prospects, asks why accept rates are low, or says to check if people actually use LinkedIn. Runs the li-activity-check edge function against the Apify actor harvestapi/linkedin-profile-posts. Paid, roughly $0.002 per profile, so always estimate and get approval first.
---

# HeyReach activity gate

Every HeyReach upload passes through this gate first. A LinkedIn campaign sent to
someone who has not opened the app in eight months is not a copy problem and no
sequence rewrite fixes it. The gate answers one question per lead: did this person
publish anything on LinkedIn inside the lookback window?

## When this runs

Run it before any lead reaches a HeyReach list. That includes new lists, top ups to
existing lists, and lists rebuilt after a dedupe pass. It applies to every client
lane, not just SalesGlider's own outbound.

Do not run it on email lanes. Smartlead campaigns have their own verification path
through Email Verifier Progression and this gate tells you nothing about
deliverability.

## The rule

**Hard cap: 30 days, published posts only.** No post inside the window means the
lead does not get uploaded. Josh set this deliberately in Aug 2026 after seeing the
alternative tiering approach. Do not silently soften it to a tier or a sort order.

If a run would drop most of a list, say the number out loud before pushing anything.
Josh decides whether to proceed, widen the window, or work the inactive set on a
different channel. He does not want the gate quietly deciding a campaign is too
small to run.

## Measured numbers, Aug 2026

From the first production run against the staffing owners list, 100 profiles:

| Metric | Value |
|---|---|
| Active in last 30 days | **15%** |
| Cost per profile checked | $0.002 |
| Cost for 100 profiles | $0.20 |
| Cost for a 2,400 lead list | roughly $5 |
| Posts returned outside the window | 0 |

15% is the planning assumption until a later run says otherwise. A 2,400 lead list
becomes roughly 360 uploadable leads. At 35 connects a day that is about ten days of
sending, not two months. Tell Josh this before he staffs seats or buys volume based
on the raw list size.

## Architecture

Lead rows never pass through chat. Everything moves server to server.

```
lp.sg_* source table (profile urls)
        |
        v
public.li_activity_pending()      picks unchecked urls, skips anything
        |                          checked in the last 14 days
        v
li-activity-check edge function   calls Apify, folds results to one
        |                          verdict per profile
        v
lp.li_activity                    profile_url, last_post_at, posts_found,
        |                          checked_at, active_30d
        v
filter active_30d = true
        |
        v
heyreach-list-push edge function  normalizes and pushes to the list
```

### Running it

```
POST https://azpapwtnrbzywlnxxecz.supabase.co/functions/v1/li-activity-check
     ?days=30&limit=<batch size>
     &dry=1                        estimate only, returns pending count and cost
```

Always call with `dry=1` first. It returns `pending`, `postedLimitDate`, and
`estimated_cost_usd`. State that dollar figure to Josh and wait for approval,
because Apify is a paid vendor.

Batch at 100 to 250 per invocation. The edge function has a 150 second ceiling and
larger batches time out, the same failure the HeyReach push hit. For a full list,
loop invocations rather than raising the limit.

Results cache for 14 days. Re-running the same list inside that window costs nothing
and returns `pending: 0`.

### Wiring a new source

`li_activity_pending` currently reads from `lp.sg_heyreach_keep`. For another
client, extend the function with a new `p_source` branch pointing at that client's
table. Keep the left join against `lp.li_activity` so already-checked profiles are
skipped.

## What this gate cannot see

It reads what a person **published**: posts, reposts, quote posts. It does not see
comments or reactions they left on other people's content. The actor's
`scrapeComments` and `scrapeReactions` options pull engagement *on* their posts, not
activity *by* them elsewhere.

So a prospect who never posts but comments every day reads as inactive here. That is
a real false negative rate and it is why the 30 day window matters more than a
tighter one. If Josh ever wants comment and reaction coverage, that needs a
different actor reading the profile's recent activity feed, and it should be priced
separately.

Do not describe gate output as "inactive on LinkedIn". Describe it as "no published
post in 30 days". The distinction is the difference between a fact and a guess.

## Reporting

Report the outcome as useful output, never rows processed:

```
Checked 2,357. Active in last 30 days: 354 (15%). Uploading 354.
Cost: $4.71.
```

If the active count is zero, that is a failed run, say so plainly rather than
pushing an empty list. An empty HeyReach list will also flip a started campaign to
FINISHED and lock it, which is unrecoverable.

## Order of operations

1. Build or pull the lead list into `lp.*`
2. Dedupe against master, met-with (Fireflies), replies, and DNC
3. **Activity gate, this skill**
4. Normalize first name and company (`name-city-normalization`,
   `company-name-normalization`)
5. Push to HeyReach with normalized values in `first_name_n` and `company_n` custom
   fields, never the built in name fields, which LinkedIn sync overwrites
6. Create list, push leads, **then** start the campaign, never before
