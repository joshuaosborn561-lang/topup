# Patch: standard site-people name-pick filters (D111)

`topup.site_dm_pick` is a view on project `azpapwtnrbzywlnxxecz`. It
is not in this repo. Until the view is updated, the Grok Bot babysitter
applies the same filters in SQL after reading the view, every run,
as `skills/site-people-dm` says.

## Drop these picks

Use the evidence quote, `page_url`, title, Maps listing counts, and
`site_people_text.body`.

1. **Old year / history page.** Drop a founder or any-role pick when
   the evidence or page path looks like history, not a current roster:
   year ranges `19xx-yy` / `19xx–19yy`, `founded in`, `since 19`,
   `est. 19`, `former`, `originally`, `first pastor`, path
   `/history`, `/our-story`, `PAGE /history`. Keep a current pastor
   or owner named on a staff or leadership page.
2. **Franchise HQ / national company.** Drop the domain when this
   pull has 3 or more Maps listings on that domain, or the site text
   names no address in the client's territory.
3. **Plain real estate agent.** Drop title agent / realtor /
   salesperson unless the title also has broker, owner, principal, or
   managing broker.
4. **Name not in site text.** Drop when `site_people_text.body` for
   that domain does not contain the person's surname (and, if the
   surname is short, the full name). Gemini invented it, or it came
   from a directory.
5. **Cheap current-local-DM check.** On what remains, call
   `site-people?mode=ask&looking_for=the%20current%20local%20decision%20maker`
   (or Gemini Flash-Lite). Keep only yes. Vault keys only; never
   Claude via the API.

## Suggested view predicates (additive, after the existing rank)

```sql
-- history / old-year (applied to evidence and page_url)
and not (
  coalesce(evidence, '') ~* '(former|originally|first pastor|founded in|since 19|est\.?\s*19)'
  or coalesce(evidence, '') ~ '(19[0-9]{2}\s*[-–]\s*[0-9]{2,4})'
  or coalesce(page_url, '') ~* '(history|our-story|ourstory)'
)
-- plain agent without broker/owner
and not (
  coalesce(title, '') ~* '\m(agent|realtor|salesperson)\M'
  and coalesce(title, '') !~* '\m(broker|owner|principal|managing)\M'
)
```

Franchise HQ and "name in site text" need the pull's Maps counts and
`site_people_text.body`; keep those in the post-view SQL the skill
already runs, not inside the view, so a directory site is not
hard-coded.

Do not put people names in chat while writing or testing this.
