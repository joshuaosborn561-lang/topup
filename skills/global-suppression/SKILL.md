---
name: global-suppression
description: Build and apply the SalesGlider Growth global suppression list before any lead load, campaign launch, or list top-up, across every client. Use whenever Josh asks to suppress, dedupe against prior sends, check the suppression list, or run a net-new count, and automatically before any lead import into Smartlead or HeyReach. Encodes the response-based scope corrected 2026-08-25, the per-session rebuild requirement, and the Smartlead block-list distinction that must never be deleted.
---

# Global suppression

## Scope (D63, 2026-10-09)

Suppress **per client only**. A block for one client never applies to another.
Applied inside `suppress` at pull time. No cron, no routine.

Suppress on this `smartlead_client_id`:

- Positive replies, for 6 months after the reply
- Current Do Not Contact and Wrong Person on this client
- Hard bounces on this client (forever: `s.bounced` or Sender Originated Bounce)
- `public.suppression` when `permanent` or `first_seen` is inside 6 months
  (older non-permanent unsubscribes expire — Josh accepts that risk)
- Anyone this client sent to in the last 6 months
- Anyone already in a live campaign of this client (D36)

After 6 months the person is eligible again for **this** client. The sending
inboxes that emailed them stay blocked forever for that person. Route and
stage carry `excluded_inboxes`. Report `expired_eligible` separately.

Do **not** suppress someone merely because another client emailed them, replied
positively, or unsubscribed. `same_offer_other_client` is not applied.
Never put someone in two live campaigns of the same client at once
(D36 item 2). An empty customer domain list does not halt a run.

**Any pool-exhaustion figure computed before 2026-08-25 used the old contact-history scope and
is understated.** Recount before telling a client their pool is dry.

## Rebuild every session

The sandbox filesystem resets between conversations. The suppression list does not persist.
Rebuild it at the start of any session that will load leads, by exporting reply data from
Smartlead across all clients and unioning with `public.suppression`.

Never assume a suppression file from a previous conversation is still on disk. Check, and if
it is absent, rebuild before any load. Loading against a stale or missing suppression list is
the failure mode this skill exists to prevent.

## Domain-level versus person-level

Person-level for reply-based suppression. One person asking out does not silence their whole
company.

Domain-level for: our own domains, client domains, creator and competitor domains on
engagement-sourced lanes, and anything Josh has explicitly added as a customer request.

## Smartlead block list, do not mishandle

Entries in the Smartlead block list carry a `source` field and the two kinds must be treated
differently:

- `source: "Smartlead.ai Bounce Detection"` ... bounces. These can be cleared.
- `source: "API"` ... manually added customer suppression domains. **Never delete these.**

Clearing an API entry silently re-enables sending to a domain a client asked us to stop
touching. There is no undo and no log that will make it obvious.

## Order of operations

1. Rebuild the suppression set for this session
2. Dedupe the incoming list against it
3. Dedupe against the target platform's existing leads, Smartlead or HeyReach
4. Report the net-new count as the real number, never the raw pull count
5. Then load

A pull of 3,000 that nets 180 after suppression is a 180-lead pull. Report it that way.

## Reporting

Net-new is the number that matters. State raw pulled, suppressed by reason, platform
duplicates, and net-new loaded. A load reported as its raw count is a misreport.
