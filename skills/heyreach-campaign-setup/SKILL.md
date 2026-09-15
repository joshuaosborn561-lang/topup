---
name: heyreach-campaign-setup
description: "Stand up a HeyReach LinkedIn campaign to Josh's standard for SalesGlider Growth: run the activity gate first, normalize, push only active leads, then build the standard branching sequence (connection request, accepted branch with two messages, not-accepted branch through view profile and open-profile check into InMail). Use whenever Josh asks to set up or build a LinkedIn campaign, mirror an email campaign onto LinkedIn, push or top up leads into HeyReach, run the activity test before uploading, reuse 'the usual branching', or says 'same copy as the email'. Also use before starting any HeyReach campaign. This is the LinkedIn half of campaign setup... the email half is smartlead-campaign-settings. Always use this skill instead of hand-building a sequence, because the node topology, delays, and merge field names below were read from live campaigns and the API rejects several obvious alternatives."
---

# HeyReach campaign setup

The LinkedIn twin of `smartlead-campaign-settings`. Same job, different channel: gate
the list, normalize it, push only what survives, build the sequence, then start.

Every value below was read from Josh's live campaigns through the API, not invented.

## Order of operations

Do not reorder these. Steps 1 through 3 are covered by other skills and are listed
here so the whole job is visible in one place.

1. Build or pull the list into `lp.*`
2. Dedupe against master, met-with (Fireflies), replies, and DNC ... `global-suppression`
3. **Activity gate** ... `heyreach-activity-gate`, summarized below
4. **Normalize** ... `name-city-normalization` and `company-name-normalization`
5. **Route to the right workspace** ... `heyreach-workspace-routing`. The MCP connector
   only reaches SalesGlider. Anything else goes through the edge function.
6. Create the list, push the leads
7. Build the sequence
8. **Then** start the campaign

Step 8 last, always. Starting a campaign against an empty or not-yet-populated list
flips it to FINISHED and locks it. That is unrecoverable and it has already happened
once (campaign 557688, 2,357 leads pending, zero sent).

## Step 3, the activity gate in operation

Summary only. `heyreach-activity-gate` is the authority ... if the two ever disagree,
that skill wins.

Nobody reaches a HeyReach list without a published post inside the window. The check
runs the Apify actor `harvestapi/linkedin-profile-posts` behind a Supabase edge
function, so lead rows never pass through chat.

```
POST https://azpapwtnrbzywlnxxecz.supabase.co/functions/v1/li-activity-check
     ?days=30&limit=<100 to 250>
     &dry=1        estimate only... returns pending, postedLimitDate, estimated_cost_usd
```

- **`dry=1` first, always.** State the dollar figure and wait. Apify is a paid vendor
- **30 days, published posts only.** Hard cap, set deliberately. Do not soften it into a
  tier or a sort order
- Batch 100 to 250 per call. The edge function dies at 150 seconds, so loop invocations
  rather than raising `limit`
- Results cache 14 days. Re-running the same list inside that window is free and returns
  `pending: 0`
- Roughly **15%** survive. Plan seats and volume off the survivor count, not the raw list
- It sees posts, reposts, and quote posts. It does **not** see comments or reactions the
  person left elsewhere. Say "no published post in 30 days", never "inactive on LinkedIn"

**Wiring gap, this will bite.** `li_activity_pending` currently reads only from
`lp.sg_heyreach_keep`. Any other client needs a new `p_source` branch added to the
function, pointed at that client's table, keeping the left join against
`lp.li_activity` so already-checked profiles are skipped. Check this before promising a
timeline on a new client's first LinkedIn campaign.

If the gate returns zero active, that is a failed run. Say so. Do not push an empty
list, which locks the campaign per step 8 above.

## Merge fields

Push normalized values into **custom fields** `first_name_n` and `company_n`. Never the
built-in `{FIRST_NAME}` / `{COMPANY}` fields, which LinkedIn sync silently overwrites
with whatever the profile says.

**The column names do not match. Rename on the way in.** The normalization skills write
`_normalized` columns; HeyReach expects the short names the live sequences read:

| Source column, after step 4 | HeyReach custom field | Sequence token |
|---|---|---|
| `first_name_normalized` | `first_name_n` | `{first_name_n}` |
| `company_name_normalized` | `company_n` | `{company_n}` |

Getting this wrong fails silently and expensively. Missing custom fields do not error
... HeyReach just falls back to `fallbackMessage` on every lead and sends
de-personalized copy at full volume. **Verify by pulling one lead back after the push
and confirming both fields are populated**, before starting the campaign. A successful
push response is not verification.

The Financial Advisors campaign (528443, Jul 2026) still uses `{FIRST_NAME}` and
`{LOCATION}`. That predates the rule. Do not copy it as a pattern.

**Every node carrying a personalization variable needs a `fallbackMessage` or the API
rejects the whole sequence.** The fallback is the same copy with the personalization
removed, not generic filler. Live pattern: `Hey {first_name_n},` becomes `Hey,` and the
clause naming the company drops out entirely.

## The sequence

Identical across Staffing Owners v2 (557698, Aug 2026) and Financial Advisors (528443,
Jul 2026), different verticals a month apart. Treat it as the default.

```
CONNECTION_REQUEST          blank note, withdraw after 7 days
├─ accepted     → MESSAGE  M1, +3 HOUR
│                  ├─ replied  → END  +1 DAY
│                  └─ no reply → MESSAGE  M2 bump, +2 DAY
│                                 ├─ replied  → END  +1 DAY
│                                 └─ no reply → END  +1 DAY
└─ not accepted → VIEW_PROFILE  +1 DAY
                   └─ CHECK_IS_OPEN_PROFILE  +1 DAY
                        ├─ open     → INMAIL  +0 HOUR, M1 body + subject
                        │              ├─ replied  → END  +5 DAY
                        │              └─ no reply → END  +5 DAY
                        └─ not open → END  +21 DAY
```

**The connection request note is blank.** Both campaigns. Empty `messages` array, empty
fallback. Do not write one.

Nobody gets discarded for failing to accept. They fall through to the open-profile
check and, if open, get the same pitch as a free InMail.

### Delays

| Edge | Delay |
|---|---|
| CONNECTION_REQUEST | 0 HOUR |
| accepted → M1 | 3 HOUR |
| M1 → M2 | 2 DAY |
| any reply → END | 1 DAY |
| not accepted → VIEW_PROFILE | 1 DAY |
| VIEW_PROFILE → CHECK_IS_OPEN_PROFILE | 1 DAY |
| open → INMAIL | 0 HOUR |
| INMAIL → END | 5 DAY |
| not open → END | 21 DAY |

## Copy

**Same copy as the email campaign, adapted.** LinkedIn is not a separate offer. M1
carries the same hook, the same proof figure, and the same soft close the email uses.
The live staffing M1 even names the email out loud: an "I emailed you a while back,
figured LinkedIn was worth a shot too" line. Keep that when the same person is in both
channels. It reads as persistence, not as a second unrelated pitch.

What changes on the way over from email:

| Element | Email | LinkedIn |
|---|---|---|
| Spintax | Required, `spintax-generator` | **None.** Neither live campaign uses it. Send fingerprint is not a LinkedIn problem |
| Opt-out | PS block, `salesglider-unsubscribe` | **Do not use it.** The bump ends with a plain "Am I even relevant here, or should I take you off my list?" |
| 90-word ceiling | Enforced | Not enforced. Live M1s run longer |
| Subject line | Every step | InMail only. Bare offer name, lowercase, `subject-line-offer-naming` (live: "roles to fill") |
| Signature | `%signature%` on every variant | None. The sender profile is the signature |

**The InMail body is M1 verbatim.** Same text, plus a subject. Do not rewrite it for the
channel. Caps: subject 200 chars, body 1,900.

**Show Josh the full copy for approval before pushing it into a sequence.** Same rule as
Smartlead: approve first, upload second, never the reverse.

## API constraints

These reject the whole sequence, not just the offending node:

- Any node following an action needs `actionDelay` of at least 3 hours
- `CHECK_IS_OPEN_PROFILE`, `CONNECTION_REQUEST`, and `FIND_EMAIL` can each appear only
  once per path
- `MESSAGE` only works on the accepted branch. They have to be a connection first
- Personalization without a `fallbackMessage` is rejected
- Campaign name is capped at 50 characters

`create_campaign_from_template` clones sequence and schedule into a DRAFT and is the
fastest path when the copy is not changing. It cannot take a custom sequence ... use
`create_campaign` or `update_campaign_sequence` for that.

## Reporting

Report useful output, never rows processed:

```
Checked 2,357. Active in last 30 days: 354 (15%). Uploading 354. Cost: $4.71.
Sequence built on campaign <id>, DRAFT. Not started.
```

## Open decisions, do not guess

**Withdraw window.** Live campaigns disagree: 7 days on Staffing Owners v2, 25 days on
Financial Advisors. Default to 7 as the more recent call, but say which one is being
used before building.

**The Smartlead fallthrough is not built.** The designed ladder (Aug 2026) had the
not-accepted branch continue `FIND_EMAIL → SEND_LEAD_TO_SMARTLEAD` so nobody exits
without being tried on email. Neither live campaign has it ... both dead-end at `END`
after 21 days. Both nodes are native. Do not add them silently; ask.

**InMail first vs connection request first was settled by the live builds.** Connection
request goes first, InMail is the fallback for non-accepters with open profiles. The
earlier open question about burning InMails up front is closed unless Josh reopens it.

## Source of truth

Sequence topology, delays, merge fields, and copy pattern read from campaign 557698
(Staffing Owners v2, Aug 2026) and 528443 (Financial Advisors, Jul 2026) via
`get_campaign_sequence`, Aug 2026. Activity gate numbers come from
`heyreach-activity-gate`. The empty-list-locks-campaign failure is campaign 557688.
