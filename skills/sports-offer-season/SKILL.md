---
name: sports-offer-season
description: Decide which ticket offer (MLB or NBA) every SalesGlider sports ticket campaign should be running on a given date, and run the switch when a season ends. Use whenever Josh asks which offer to run, whether it is baseball or basketball season, to switch campaigns to NBA or back to MLB, to swap the local sports team field, or why a campaign is still offering tickets to a finished season. Also use before building any new ticket offer campaign, before topping up a ticket campaign, and any time the date is within two weeks of a regular season ending. Pairs with sports-team-assignment, which does the actual team lookup.
---

# Sports offer season

Ticket offers follow the season that is actually being played. Nobody wants tickets to a
season that just ended.

## The rule (set by Josh, Sept 23 2026)

| When | Offer | Assignment run |
|---|---|---|
| MLB regular season running | MLB tickets | `--league mlb` |
| Day after the MLB regular season ends, until the NBA regular season ends | NBA tickets | `--league nba` |
| Day after the NBA regular season ends | back to MLB | `--league mlb` |

Both leagues fall back to college exactly the same way (sports-team-assignment). Education
lanes stay `--pro-only` in either season. Rows with no team still route to the AirPods tier.

**Open question, default in force until Josh says otherwise:** the switch happens at the end
of the regular season. Josh mentioned "two weeks before" once and it was not settled whether
that means switch two weeks early. If he confirms two weeks early, move every flip date in
the calendar below back 14 days.

The postseason does not count. Playoff tickets are not the offer.

## Calendar

| Season | Regular season | Offer window |
|---|---|---|
| MLB 2026 | ends Sun Sept 27 2026 | MLB through Sept 27 |
| NBA 2026 to 27 | Tue Oct 20 2026 to Sun Apr 11 2027 | NBA Mon Sept 28 2026 to Sun Apr 11 2027 |
| MLB 2027 | not yet published | MLB from Mon Apr 12 2027 |

Selling NBA tickets in the three weeks before tip off is fine. The tickets get fulfilled
weeks after the reply anyway.

**Check dates every year, never trust this table past its season.** Web search the official
schedule before each flip.

**2027 labor risk.** MLB's collective bargaining agreement expires Dec 1 2026. If Opening
Day 2027 is delayed or not scheduled by April 11 2027, do not flip to MLB. Ask Josh; the
default is to hold NBA ticket campaigns on the AirPods tier rather than offer baseball
tickets to games that may not happen.

## Copy must stay league neutral

The switch only works because the copy never names a league. Every ticket campaign uses:

- Subject: `{{{Local_Sports_Team}} tix|{{Local_Sports_Team}} tickets}` (subject-line-offer-naming)
- Body: `{{Local_Sports_Team}} tickets`, never "baseball," "ballgame," "this season," a
  team name, or a stadium
- Campaign name: `Tickets`, not `MLB`, `NBA`, or a team name

A campaign with a team typed into the copy (TechEvo "Red Sox," Vasco "Mets or Yankees" as of
Sept 2026) needs a copy rewrite at every flip, shown to Josh in full before upload. Fix it
once by moving to the merge field.

## Which leads get the new team

**Only leads with Smartlead status `STARTED`,** meaning no email sent yet.

Leads already `INPROGRESS` keep their old team. Their E1 promised that team, and a follow
up that renders a different team breaks the thread. PowerGRYD's E2 subject is
`re: {{Local_Sports_Team}} tix`, so changing an in progress lead there would visibly
contradict E1. Most other campaigns thread E2 with a blank subject, but the rule is the same
everywhere.

Never write a blank team. If the new run returns blank for a lead, keep the old value.

## The switch procedure (all server to server, no lead rows in chat)

Everything runs on campaignintelligence (`azpapwtnrbzywlnxxecz`).

1. **Audit live sequences.** `public.sequence_steps` does NOT store variant bodies, so it
   under reports merge tags. Read live sequences with a DO block calling `http_get` on
   `/campaigns/{id}/sequences` (key from vault `smartlead_salesglider`, 1.5s spacing, retry
   429s with backoff), writing flags to `public.sports_offer_audit`: uses
   `Local_Sports_Team`, hardcoded team names, sport words, and whether steps 2+ use the
   field.
2. **Export `STARTED` leads.** Edge function `sports-switch-k7q2` `action=export` with
   campaign ids pulls `/campaigns/{id}/leads-export`, keeps `STARTED` rows, and upserts to
   `public.sports_switch_leads` with the full lead payload in `raw` (the update endpoint needs
   it) and the current team in `old_team`.
3. **Resolve location.** Smartlead `location` is usually the conversational metro (the
   conversational-location output: "the NYC," "DFW," "the Bay," "Chicagoland") with no
   state. Map conversational names to an anchor city, then pick the state by choosing the
   same named city nearest the old team's venue. If there is still no location, use the old
   team's venue as the location. `action=geo` serves campaign id, lead id, location, old
   team only.
4. **Assign.** Run sports-team-assignment logic for the new league in the container, then
   `action=load` writes `new_team` back. Leave `new_team` null where it equals the old team
   or came back blank, so nothing pointless is pushed.
5. **Test one lead, then read it back.** `action=push` with `lead_id`, then `GET /leads/?email=`
   server side. Confirm the team changed, every other custom field is unchanged, and the first
   name is intact.
6. **Push the rest by cron.** `sports_switch_push` runs `public.sports_switch_tick()` every
   minute, about 400 leads per tick, `prio` order (campaigns whose E2 uses the team first,
   then ACTIVE, then PAUSED). It unschedules itself when nothing is left.
7. **Rename campaigns** that carry a league in the name.
8. **Report** counts only: exported, changed, unchanged, kept old, pushed, failed.

## Measured on the Sept 23 2026 MLB to NBA switch

- 144 open campaigns read, 29 needed field updates, 39,416 `STARTED` leads exported.
- 33,892 changed teams, 5,162 kept the same team (mostly college), 362 unresolved kept
  their old value.
- Pushing is the slow step: one Smartlead call per lead, roughly 5 hours at the rate limit.
