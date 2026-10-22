---
name: "site-people-dm"
description: "Find the named decision maker at a company from its own website: fetch people pages, Gemini lists every named person, SQL picks the DM, DiscoLike fills the gap. Use for churches, local owners, any physical ICP."
---

# Site people: capture everyone on the website, pick the DM in SQL, fill the gap with DiscoLike

Use this whenever a list has domains and you need named people, especially buyers who are not in B2B databases: churches, local property owners, owner operated shops, local businesses. It is the Top_Up `site_check` people question (D72, D73), run directly through the `site-people` edge function (v5, Oct 12 2026).

The principle (Josh, Oct 12 2026): capture EVERY person the website names first, then decide who to call. Never let a role prompt decide who gets captured. Picking the DM is a separate, cheap step done in SQL. DiscoLike then runs ONLY on the sites SQL could not pick (the gap step, step 6). This combination is the most effective DM method measured to date.

It finds people, not emails. Hand the picked people to Email Finder Waterfall afterwards, then Email Verifier Progression.

## Where it fits

After domains exist, before any paid people or email step. For rows with no domain, run Domain Waterfall (`domain-waterfall`, max_tier discolike, estimate first) first; about $0.002 per row, resolved 59 of 100 church owners in the Oct 12 pilot.

## How to run it

Project `azpapwtnrbzywlnxxecz` only. Edge function `site-people`. The HTTP `k=` value lives in vault secret `site_people_key` (not in git; the old hardcoded key in the function source is being moved there — `docs/patches/site-people-vault.md`). Base URL `https://azpapwtnrbzywlnxxecz.supabase.co/functions/v1/site-people?k=<vault site_people_key>`. Fetch, extract and ask already claim rows with an expiring lease; a restarted call resumes only unfinished domains and does not re-pay Gemini or Jev.

1. **Load domains.** Insert distinct, lower cased domains with no `www.` into `topup.site_people_text (domain, batch)`, one batch name per client and list, `on conflict do nothing`. Domains in `topup.site_domain_blocklist` (directories, listing and social sites) are never picked from, so drop them at load.
2. **Fetch (free).** `&mode=fetch&batch=<name>&n=70&w=8`, up to 3 calls in parallel, repeat until `remaining` is 0. v5 fetches the homepage, up to 8 people looking pages linked from it (team, leadership, staff, pastors, elders, board, directory, about, contact and similar), then a second hop of up to 4 strong people pages linked from those (staff pages often hang off About). Up to 20,000 characters per people page, 120,000 per site, plus schema.org Person data.
3. **Extract (Gemini, near free).** `&mode=extract&batch=<name>&n=50&w=10`, up to 2 calls in parallel, repeat until `remaining` is 0. Model `gemini:gemini-3.1-flash-lite`, key from vault `gemini_api_key`. Writes EVERY named person (up to 80 per site, all levels) with title, quote and page to `topup.site_people`, plus `org_name` and `org_type` per site to `topup.site_extractions`. org_type is one of church, school, nonprofit, association, government, property_company, business, directory_or_unrelated, unknown.
   - Big pages are never cut: text over ~25k chars is split into ~25k chunks (one Gemini call each, max 12 per site; a truncated chunk is halved and retried once) and the people are merged. `site_extractions` keeps `failure_kind` (fetch_failed, truncated, bad_json, llm_unavailable, other), `page_chars`, `chunks`, `chunk_capped`. To see big staff pages vs failing fetches: `select * from topup.site_extraction_failures;`
   - Extract gives each site at most 3 failed attempts (`site_extractions.attempts`), then sets `gave_up_at` and never re-picks it. If Gemini answers 402/403 (out of credit or blocked) the call returns HTTP 424 `{"error":"llm_unavailable"}`: stop, do not re-call until the key is fixed.
   - To re-extract a site, set its `site_extractions.error` to a non null value (for example `redo`), set `attempts = 0, gave_up_at = null`, and reset `site_people_text.http_status` to null for a refetch. Do not delete rows; `site_people` upserts, so earlier captures are kept and a rerun can only add people.
4. **Pick the DM in SQL (free), then apply the standard name-pick filters (every run, not EMCOR-only).** Read `topup.site_dm_pick`: one row per domain with the best ranked person, `rnk`, `ties` and `org_type`. It skips org_types school, nonprofit, association, government, directory_or_unrelated, and blocklisted domains. All title matching is whole word (`\m...\M`), so Director never matches Rector and Vice President never matches President.
   - Church ladder: 1 Senior, Lead or Head Pastor, Pastor, Reverend, Rector, Priest, Bishop. 2 Executive Pastor. 3 Church or Business Administrator, Facilities, Property, Operations, Executive Director.
   - Everyone else: 1 Owner, Founder, Co-founder, Principal, Managing Partner or Member, Proprietor. 2 President, CEO. 3 Facilities, Property Manager, Real Estate, Asset or Portfolio Manager. 4 General Manager, Director of Operations, COO.
   - Always ignored: Vice, Assistant, Associate, Youth, Student, Children, Kids, Worship, Music, Emeritus, Retired, Former, Interim, Intern, Deputy, Volunteer, and any name without a surname.
   - `ties > 1` means several people share the top rank (common at churches). Keep the pick and treat the others at that rank as backup contacts.
   - **Standard filters, every run, after the SQL pick and before any paid email:**
     1. Drop a founder or any-role pick tied to an old year or a history page. That includes year ranges (`1970-73`, `1970–1973`), and words `former`, `originally`, `first pastor`, `founded in`, `since 19`, `est. 19` on the evidence quote or the page path (`/history`, `/our-story`, `PAGE /history`). A current pastor or owner named on a staff page stays. After `20261015220000_site_dm_pick_standard_filters.sql` is applied, the view does this (and the next-ranked eligible person wins). Until then, apply it in SQL after reading the view.
     2. Drop franchise HQ / national-company domains: the same domain on 3 or more Maps listings in this pull, or the site names no address in the client's territory. Always post-view (needs this pull's Maps counts).
     3. Drop a plain real estate agent (agent, realtor, salesperson) who is not also broker, owner, principal or managing broker. After the same migration, the view does this. Until then, apply it in SQL after reading the view.
     4. Drop a name that does not appear in `site_people_text.body` for that domain (Gemini invented it, or it came from a directory). Always post-view.
     5. Then a cheap-model check (Gemini Flash-Lite or Jev, vault keys only; never Claude via the API): "is this the current local decision maker?" Keep only yes. `mode=ask` with `looking_for=the current local decision maker` is that check.
   - These filters are the EMCOR lesson, now default. Do not skip them on churches, trades, or LinkedIn-native leftovers.
5. **Jev fallback (optional).** `&mode=ask&batch=<name>&only=sql_unpicked&n=200&w=10&looking_for=<url encoded role>`, ONE call at a time. Model `jev:typesafe/jev-1.13`. Keep picks with `prob >= 0.6` and the same title exclusions. It added 1 DM in the v5 pilot; skip it when step 6 runs.
6. **DiscoLike gap step (paid, about $0.0055 per domain).** On the source table, flag rows whose domain has no `site_dm_pick` row, whose org_type is not cut, and that are not blocklisted (for churches also skip org_type business and property_company, which usually means a wrong domain). Unreadable sites still go in, DiscoLike works from the domain. Then Find Named Person `resolve_people` with `min_tier=discolike max_tier=discolike`, `client_tag` of the client, `estimate_only=true` first, state the dollar figure, then run with `approve_cost_usd` at the estimate plus a small margin. Contacts land in `public.<tag>_wf_contacts`.
   - Audit titles in SQL afterwards and count only companies with a real DM title: owner, founder, president, CEO, principal, managing partner, property or facilities manager, general manager, COO; for churches pastor, senior or lead pastor, executive pastor, administrator, facilities, operations. Do not count VP, marketing, business development, assistant, worship, media, choir or interim titles.
7. **Read the result in SQL.** Report counts per segment and at most 10 sample rows (domain, org_type, title, rank). Never names or emails in chat.

## Acceptance rules

- `site_dm_pick` rows, DiscoLike gap contacts with an audited DM title, plus Jev fallback picks at `prob >= 0.6`.
- Check domain trust before paying for emails. Free check: the fetched site text contains an owner name token or the owner mailing zip or city (`site_people_text.body`). In the Oct 12 pilot 49 of 54 commercial picks and 30 of 32 church picks passed. Untrusted rows get a manual look or DiscoLike match before paid email. Add any directory found to `topup.site_domain_blocklist`.
- Large or public companies (for example a listed company's CEO or founder) are technically DMs but not roof buyers. Flag and either route to their facilities or real estate person or drop.
- Send kept people to Email Finder Waterfall with `site_extractions.org_name` (the real organization name), never the parcel LLC name, `need=email`.

## Measured

Peterson building owners, Oct 12 2026.

Earlier pilots (v4, Jev picks with one role prompt): churches 58 of 89 (65%), commercial 14 of 77 (18%); a commercial specific prompt lifted commercial from 9 to 33 on pilot 3, which is why picking moved to SQL. v4 capped capture at 12 people per site and 5,000 characters per page.

Pilot 3 rerun with v5 capture (194 domains): 1,489 people vs 615 (2.4x), max 80 per site. Upserts keep earlier captures, nothing is lost. org_type cut 28 sites. SQL pick on in ICP sites: churches 41 of 60 (68%), commercial 37 of 106.

Pilot 4, fresh owners, full method:
- Commercial, 150 owners with a known domain, 134 in ICP: website plus SQL pick 54 (40%); DiscoLike gap on the 80 misses found a real DM title at 26 more for $0.44. Combined 80 of 134 (60%).
- Churches, 100 owners with no domain: Domain Waterfall resolved 59 for $0.21; 55 in ICP after the website check. Website plus SQL pick 32 (58%); DiscoLike gap on 19 misses found a real pastor or admin at 7 more for about $0.10. Combined 39 of 55 (71%).
- Comparison: Find Named Person alone on pilot 1 found 31 of 89 churches (35%) and 29 of 77 commercial (38%).
- Cost: Gemini about $0.12 per 160 sites, fetch free, DiscoLike gap about $0.0055 per missed domain.

## Default order for physical ICPs

1. Domain Waterfall for rows with no domain.
2. `site-people-dm` steps 1 to 4 on every domain: capture all people, SQL pick.
3. DiscoLike gap step (step 6) on the domains SQL could not pick.
4. `hard-to-find-dm-discovery` (SERP on LinkedIn profiles) on what is still empty, if worth it.
5. Email Finder Waterfall on all picked people, with the real organization name.
6. Email Verifier Progression before anything loads.

## Safety

- The project database has a 60 connection cap shared with the live Allo hooks and Gabe's email router. Max 3 parallel fetch calls, 2 parallel extract calls, 1 ask call. If you see "remaining connection slots are reserved", stop all runs and clear idle connections as described in `icp-website-gate`.
- Delete statements on these tables get cancelled by the harness; re-run by flagging rows (error = 'redo', http_status = null) instead.
- Find Named Person and Domain Waterfall `where` clauses only take simple predicates; flag rows with a column value (for example `name_gate = 'fnp4'`) and pass that.
- Counts and up to 10 sample rows in chat only. Names, emails and evidence quotes stay in Supabase.
- Never use Claude via the API for extraction or picking. Gemini and Jev only.