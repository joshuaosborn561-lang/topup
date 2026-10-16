---
name: "heyreach-activity-gate"
description: "Gate every HeyReach lead upload on recent LinkedIn activity (a like, comment or post in the last 30 days). Use whenever Josh pushes, uploads, loads or tops up leads into HeyReach for any client or lane, asks who is active on LinkedIn, mentions dead prospects or low accept rates. Paid Apify, estimate and get approval first."
---

# HeyReach activity gate

Every HeyReach upload passes through this gate first. A LinkedIn campaign sent to
someone who has not opened the app in months is not a copy problem and no sequence
rewrite fixes it. The gate answers one question per lead: did this person like,
comment on, or publish anything on LinkedIn in the last 30 days?

## When this runs

Run it before any lead reaches a HeyReach list. That includes new lists, top ups to
existing lists, and lists rebuilt after a dedupe pass. It applies to every client
lane, not just SalesGlider's own outbound. It also runs when Josh wants to split an
email list into "both channels" versus "email only" for a multi touch sequence.

Do not use it as an email verification step. Smartlead campaigns have their own
path through Email Verifier Progression.

## The rule

**Active = a like (reaction), a comment, or a published post in the last 30 days.**
Any one of the three counts. Josh changed this on Oct 16 2026 from the Aug 2026
"published posts only" rule, because posts alone badly undercount: most buyers react
and comment but never post.

**The likes and comments check is the primary check. The posts check is optional.**
On the first Insight run (200 IT buyers, Oct 16 2026) 106 were active by likes or
comments and only 1 had posted, and that one had also reacted. Posts added nothing.
Run the posts check only when Josh asks for it, or on a lane where people are known
to post without engaging (for example founders who publish a lot).

If a run would drop most of a list, say the number out loud before pushing anything.
Josh decides whether to proceed, widen the window, or work the inactive set on a
different channel. Do not let the gate quietly decide a campaign is too small.

## Measured numbers

| Run | Profiles | Active | Rate | Cost |
|---|---|---|---|---|
| Staffing owners, posts only, Aug 2026 | 100 | 15 | 15% | $0.20 |
| SG staffing, posts only, Oct 15 2026 | 2,000 | ~400 | ~20% | ~$4 |
| Insight IT buyers, posts only, Oct 16 2026 | 1,800 | 108 | 6% | ~$3.60 |
| **Insight IT buyers, likes + comments, Oct 16 2026** | **200** | **106 (103 liked, 25 commented)** | **53%** | **$0.26** |

Planning assumptions until a bigger run says otherwise:
- Likes and comments check: roughly half of a B2B list is active. Cost is about
  **$0.0013 per profile** (only hits are charged, about $0.26 per 200).
- Posts check: 6% to 20% active depending on the lane, $0.002 per profile charged on
  every profile checked, hit or miss.

At 25 to 35 connects a day per sender seat, a 50% active rate on a big list is months
of sending. Tell Josh the active count and how long one seat takes to work it before
he staffs seats or buys volume.

## Architecture

Lead rows never pass through chat. Everything moves server to server on
azpapwtnrbzywlnxxecz.

```
source (topup.sl_campaign_leads by gate tag, or lp.* tables)
        |
        v
public.li_engagement_pending(source)   unchecked urls; skips anything checked
        |                               in the last 14 days and anything running
        v
li-engagement-check  mode=start         claims urls (status running), starts two
        |                               Apify runs async and returns at once
        v
Apify harvestapi/linkedin-profile-reactions   profiles, maxItems 1, postedLimit month
Apify harvestapi/linkedin-profile-comments    profiles, maxItems 1, postedLimit month
        |
        v
li-engagement-check  mode=collect       folds finished runs to one row per profile
        |
        v
lp.li_engagement     profile_url, last_reaction_at, last_comment_at, checked_at, status
lp.li_engagement_runs  one row per batch: urls, both run ids, result counts, cost
```

Optional posts check (old path, still live):

```
public.li_activity_pending(limit, source) -> li-activity-check -> lp.li_activity
(last_post_at, posts_found, active_30d), Apify harvestapi/linkedin-profile-posts
```

### Running the likes and comments check

```
GET https://azpapwtnrbzywlnxxecz.supabase.co/functions/v1/li-engagement-check
    ?mode=dry&source=sl:<tag>              pending count for the source
    ?mode=start&source=sl:<tag>&limit=N   claim N (up to 1000) and start both runs
    ?mode=collect                          fold every finished batch, report counts
```

1. `mode=dry` first. Multiply pending by about $0.0013 and state the dollar figure
   to Josh. Any spend over $5 needs his approval.
2. Check the Apify monthly cap has room: read
   `https://api.apify.com/v2/users/me/limits` through the Apify MCP resource reader.
   `limits.maxMonthlyUsageUsd` minus `current.monthlyUsageUsd` is the headroom. A run
   that hits the cap fails with "Monthly usage hard limit exceeded"; a raised cap can
   take about a minute to take effect.
3. `mode=start` in batches. One 200 profile batch takes about 9 minutes on Apify, so
   start several batches at once (Apify allows 128 concurrent runs) rather than one
   big batch. Every start claims its urls, so parallel starts never double charge.
4. Poll `mode=collect` every minute or two until `still_running` is 0.
5. A failed or aborted run releases its urls back to pending on collect. A batch
   stuck in running for 2 hours is picked up again automatically.

Never use a synchronous Apify call here. Both actors take minutes per batch and the
edge function dies at 150 seconds, which charges Apify and writes nothing (that
happened twice on Oct 16 2026).

Results cache for 14 days. Re-running the same list inside that window costs nothing.

### Reading the verdict

```sql
select e.profile_url,
       (e.last_reaction_at is not null or e.last_comment_at is not null
        or coalesce(a.posts_found,0) > 0) as active_30d
from lp.li_engagement e
left join lp.li_activity a
  on lower(regexp_replace(a.profile_url,'^https?://(www\.)?',''))
   = lower(regexp_replace(e.profile_url,'^https?://(www\.)?',''))
where e.status = 'done';
```

### Wiring a new source

Both pending functions read Smartlead campaign leads with `source = 'sl:<tag>'`,
where the tag comes from `topup.gate_campaign_map` (for example `sl:sg_staffing`,
`sl:insight`). They skip ICP gate cuts and unsubscribes. For a lane that is not in
Smartlead, add a branch to the pending function that reads that table, and keep the
left join against the results table so checked profiles are skipped.

Leads with no LinkedIn URL cannot be checked. Find URLs first, server to server:
`li-url-lookup` (getleads email to LinkedIn, free on the unlimited plan, 100 emails
per call), then `li-url-aiark` on the misses (AI Ark `/people` on full name plus
company domain, about 0.43 credits per lead). On Insight buyers (Oct 16 2026) getleads
found 40%, AI Ark found about 75% of the rest, 85% coverage overall, about $7.50.

## What this gate cannot see

- Private or restricted activity, and anything LinkedIn hides from logged out views.
- `postedLimit: month` filters by the date of the post that was liked or commented
  on. The recorded `last_reaction_at` and `last_comment_at` are the action dates.
- Profile views, DMs and scrolling. Someone who reads every day but never taps like
  still reads as inactive.

Describe the output as "no like, comment or post in 30 days", not "inactive on
LinkedIn". The first is a fact, the second is a guess.

## Reporting

Report useful output, never rows processed:

```
Checked 12,549. Liked, commented or posted in 30 days: 6,400 (51%). Cost: $16.30.
```

If the active count is zero, that is a failed run. Say so plainly rather than
pushing an empty list. An empty HeyReach list will also flip a started campaign to
FINISHED and lock it, which is unrecoverable.

## Order of operations

1. Build or pull the lead list
2. Dedupe against master, met with (Fireflies), replies, and DNC
3. Find LinkedIn URLs for leads missing one (getleads, then AI Ark)
4. **Activity gate, this skill** (likes and comments; posts only if asked)
5. Normalize first name and company (`name-city-normalization`,
   `company-name-normalization`)
6. Push to HeyReach with normalized values in `first_name_n` and `company_n` custom
   fields, never the built in name fields, which LinkedIn sync overwrites
7. Create list, push leads, **then** start the campaign, never before