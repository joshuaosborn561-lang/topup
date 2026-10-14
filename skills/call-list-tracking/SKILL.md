---
name: "call-list-tracking"
description: "Register every cold call list in Supabase with where each number came from, its line type, size band, title, trade and verdicts, and measure which segments convert using live Allo outcomes. Use whenever a call list is built, rebuilt, topped up, or handed to any caller (Cayden, Gabe, Josh, or a future caller), whenever Josh asks which numbers or segments are converting, how a caller's list is performing, why a caller has no conversations, or whether the back half of a list is worse, and before any call list file goes to Allo. A list that skips this registry cannot be measured. Runs on azpapwtnrbzywlnxxecz, free."
---

# Call list tracking

Every number a caller dials must exist in one registry with its provenance, so outcomes can be cut by
source, phone source, line type, size, title, trade, zone and list. Built Oct 6 2026 after Cayden's
calls fell off and the cause (mislabeled getleads industry on the 11 to 50 segment) took hours to
reconstruct because nothing recorded where his numbers came from.

## The three pieces (project azpapwtnrbzywlnxxecz)

| Object | What it is |
|---|---|
| `client_salesglider.call_contacts` | One row per phone10 + caller + list_batch, with every attribute |
| `client_salesglider.call_conversion` | View joining call_contacts to Allo outcomes per number |
| `client_salesglider.call_attempts` | View numbering every call per number (attempt 1, 2, 3...) with its outcome and tags |
| `allo.calls` / `allo.calls_classified` | Allo call log synced by `allo.sync_calls`, classifier view for outcomes |

Cron `allo-sync-hourly` refreshes the newest 1,200 calls every hour and `allo-sync-nightly-full` resyncs all history at 3:15am Central so tags added later (a meeting booked days after the call) are picked up. Allo ignores the date filter on its search endpoint and always returns newest first. If outcome numbers look frozen, check
`select max(call_at), max(synced_at) from allo.calls` first. It was stale for 17 days once.

### call_contacts columns

`phone10, caller, list_batch, allo_list, lead_source, phone_source, line_type, line_type_checked_at,
first_name, last_name, title, title_bucket, company_domain, company_name, trade, website_verdict,
size_band, size_source, commercial_permit, state, timezone, added_at`

Primary key is `(phone10, caller, list_batch)`, so the same number can sit on two callers' lists and
both histories survive.

Value conventions, keep them consistent or the cuts break:
- `caller`: cayden, gabe, josh (Allo lines 863 = cayden, 913 = gabe, 214 = josh)
- `lead_source`: getleads, permitstack, people_waterfall, rvm_list, coach_lookup, unknown
- `phone_source`: getleads_cellphone, permitstack, waterfall_cellphone, or the vendor name the
  waterfall wrote (aiark, prospeo, fullenrich; leadmagic appears only on rows before Oct 8 2026,
  when LeadMagic was removed from the stack)
- `size_source`: getleads or discolike
- `title_bucket`: owner, exec, other, unknown
- `website_verdict`: the site classifier output (trade_commercial, trade_resi_only, gc_only,
  not_trade, unclear, thin_site, site_down)
- `list_batch`: `<source>_<yyyymmdd>` of the build, never reused

## Attempt tracking (which call they picked up on, which call booked)

`client_salesglider.call_attempts` is a view with one row per outbound call:
`phone10, caller, call_id, call_at, duration, outcome, real_convo, tags, attempt_no, meeting_tag,
interested_tag, not_interested_tag`.

`attempt_no` is the call's position in that number's full Allo history (1 = first ever dial, 2 = second,
and so on), counted across every caller and line, so a number Gabe calls after Cayden called it twice is
attempt 3. It is computed live from `allo.calls`, so it needs nothing loaded and stays current with the
hourly sync. Join it to `call_contacts` on `phone10` to cut attempts by list, size, title or source.

Read it like this whenever Josh asks how a caller or list is doing:

```sql
select case when attempt_no >= 5 then '5+' else attempt_no::text end attempt,
       count(*) dials,
       count(*) filter (where real_convo) conversations,
       count(*) filter (where meeting_tag) meetings
from client_salesglider.call_attempts
where caller = 'cayden'
group by 1 order by 1;
```

What to look for:
- How many numbers ever get a second or third attempt. On Oct 6 2026 Cayden had 3,767 first dials and
  only 63 second dials, while 2 of 8 meetings came from attempts 2 and 3 (74 dials). Flag low redial
  volume every time it shows up.
- Which attempt the first real conversation happens on, and which attempt the meeting tag lands on.
- Under a few hundred dials per attempt, call it directional.

## When a list is built or changed

1. Build the list to standard first (ways of working, Oct 5 and 6 2026): website confirms a
   commercial trade, Veriphone mobile only, owner title, size 1 to 10 or 11 to 50 only (51+ excluded),
   no website means drop, deduped against every other caller and against anyone already had a real
   conversation.
2. Insert every row into `call_contacts` with a new `list_batch` and the `allo_list` name the caller
   will see. Do this before the file is exported.
3. Export the Allo file from `call_contacts`, not from the build table, so the file and the registry
   can never disagree.
4. Never delete rows when a list is replaced. Add the new batch; old batches keep the history.

## Measuring

Always cut by segment, never report a single blended rate:

```sql
select list_batch, size_band, title_bucket, website_verdict, line_type,
       count(*) filter (where dials>0) dialed, sum(dials) dials,
       sum(human_pickups) pickups,
       count(*) filter (where had_conversation) conversations,
       count(*) filter (where meeting_booked) meetings
from client_salesglider.call_conversion
where caller = 'cayden'
group by rollup(1,2,3,4,5);
```

Rules for reading it:
- Success is conversations and meetings, never dials or pickups. A segment with pickups and no
  conversations is a list fit problem, not a caller problem.
- `had_conversation` comes from the classifier (3+ prospect turns, not voicemail, not a screener).
  Allo's own CONVERSATION funnel stage counts differently; say which one a number came from.
- Meetings only count if the caller tags `meeting_booked` or `demo` in Allo. If meetings look low,
  check tagging before blaming the list.
- Under about 300 dials per segment, call the result directional. One meeting moves the rate.
- To test "the back half of the list is worse", compare segments by list position within a single
  time zone session, not by clock time across the day. Callers work East to West, so day order
  confounds zone with position.

## Backfill

Every outbound number in Allo history was backfilled Oct 6 2026. Numbers that matched no surviving
source table carry `list_batch` `allo_backfill_unknown` (or `allo_backfill_<lane>` from the Allo
transcript classifier) and `lead_source` unknown. To refresh after new lines or callers are added:
sync Allo, insert any outbound phone10 not already in `call_contacts` for that caller, then Veriphone
the rows with null `line_type` through pg_net with the `veriphone_api_key` vault secret.

## Never

- Never hand a caller a list that is not in `call_contacts`.
- Never move lead rows through chat to build or check this. Everything is SQL on the server.
- Never trust the getleads industry tag as the trade. Use `website_verdict`.