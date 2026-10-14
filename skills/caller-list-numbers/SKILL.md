---
name: "caller-list-numbers"
description: "Build a cold calling list for any caller or client: pull owner contacts from any provider, confirm ICP fit with DiscoLike's website check, then verify email and mobile before loading to Allo."
---

# Caller list build: contacts, ICP check, verified email and mobile

Use this whenever Josh asks for numbers, contacts or a new list for a cold caller (Gabe, Cayden, or anyone), for any client. The contact source can be any provider. What never changes is the order: get contacts, confirm the company fits the ICP with DiscoLike's website check, then verify email and phone, then load.

## Standing rules (Josh)
- Every calling-specific pull runs a DiscoLike website check against the client ICP. It runs before any paid email or phone lookup, so no money is spent on companies that don't fit. LinkedIn presence is never a fit test; the company's own website is.
- Owners only (owner, founder, president, CEO, principal, partner) unless the client's ICP names a different buyer.
- Every number loaded must be a Veriphone-verified mobile. Every email that will be sent must pass MillionVerifier, with catch-all and unknown going to No2Bounce.
- Never add to a list the caller is already working. New lists are new Allo queues named `<Client>2 <Timezone>` (then `<Client>3`, and so on). One queue per time zone.
- Dedupe against every caller list, every number any caller has dialed, public.suppression, and anyone in that client's Smartlead campaigns in the last 90 days.
- No lead rows in chat. Everything runs server side in Supabase edge functions on azpapwtnrbzywlnxxecz; chat sees counts, costs and at most a few sample reasons.
- Paid steps: estimate first, state the cost, get approval, then run with a hard spend stop. Test on 10 before a full run and report cost per finished contact.
- LeadMagic is out of the stack as of Oct 8 2026. Never call it, and pass `skip_tiers` so no waterfall reaches a LeadMagic tier.

## Steps

1. **Count the gap.** Current callable on the caller's list = list total minus suppressed, wrong number and written no. Target (usually 350 per client day for Gabe) minus callable = new contacts needed. Build that plus about 10% buffer.

2. **Get contacts from any provider.** Pick the source with the leadgen-mcp-routing skill or whatever Josh names (getleads, AI Ark, Google Maps plus People Waterfall, PermitStack, Apollo, and so on). Pull owners at companies in the client's segment into a build table `client_<tag>.<list>_build` via an edge function. Pull about 10 to 15x the target, since the ICP check and the phone and email steps each cut the pool. Capture a has-mobile signal if the provider offers one.

3. **Free dedupe in SQL** before spending anything else: by normalized company name and by domain against every caller list and the routing base, drop non-owner titles, keep one person per company.

4. **Make sure every company has a domain.** If the provider didn't return one, use DiscoLike bulk match (`POST https://api.discolike.com/v1/bulkmatch`, multipart CSV in `file`, `name_column`, `state_column`, `city_column`, `country_column`, `min_match_confidence=70`, `local_mode=true`; header `x-discolike-key` = `lp.get_vault_secret('discolike_api_key')`; poll `GET /v1/bulkmatch/status/{task_id}`; map back with an `input:` id column). It returns fewer results than rows sent: resubmit the rows with no result once. Then dedupe again by domain against caller lists, recent campaign leads and suppressed domains.

5. **DiscoLike website ICP check (required).** `POST /v1/validate/icp` with `icp_text`, ALL domains in one call, `context_mode: website`. Poll `GET /v1/discogen/status/{task_id}`; results keyed by domain with `fit`, `confidence`, `reasoning`. Write the ICP text from the client's memory file: who fits, signs of fit on a website, and an explicit NOT-a-fit list. Read 4 yes and 4 no reasons before moving on. Only `fit = yes` continues. Note what the check does not judge (employee count, title) and enforce those from the source data.

6. **Find email and phone** for the fit companies' owners with whatever provider fits (the source provider, Email Finder Waterfall with `max_tier='prospeo'` or `'fullenrich'` and `skip_tiers='leadmagic'`, AI Ark, Prospeo, FullEnrich). Run 10 first, measure cost per finished contact, get approval for the rest.

7. **Verify phone:** Veriphone every candidate number; keep only `mobile`. If a provider returns several numbers, check up to 3 and keep the first mobile.

8. **Verify email:** Email Verifier Progression (MillionVerifier, then catch-all and unknown to No2Bounce). If No2Bounce is out of credits, say so and use Prospeo as the fallback. Contacts without a deliverable email can still be called; the router just won't email them.

9. **Pick and load.** Best fits up to the target, split by time zone from company state. Load each zone as a new Allo queue `<Client>2 <Timezone>` via `POST /v2/api/dialing-queues` assigned to the caller, `voicemail_handling: NO_SKIP`. Allo's API can edit any queue by id (`/v2/api/dialing-queues/{id}/numbers`), not just the current one.

10. **Register and wire up.**
    - Insert into `client_salesglider.call_contacts` with `lead_source`, `phone_source`, a new `list_batch`, and `website_verdict` from DiscoLike, so sources can be compared on conversion and wrong-number rate (see the call-list-tracking skill).
    - Insert into `client_salesglider.caller_email_routing_base` and `gabe_email_verify`, so the caller's first voicemail sends Email 1 and later voicemails thread the follow-ups.
    - Remove anyone loaded from that client's other email campaigns so the caller owns them.

11. **Report:** counts per zone, money and credits spent per provider, what was dropped at each step, and anything borderline the website check passed.

## Costs to plan with (Oct 2026)
- DiscoLike: about $0.0038 per record for bulk match and for the ICP check, plus Josh's connected AI key for the check (about $5 to 10 per 1,000 domains). Starter plan, $99 monthly cap plus carryover: check `account-status` first and tell Josh what's left.
- Veriphone: inside the 50K a month quota.
- MillionVerifier plus No2Bounce: about $1 per 100 emails.
- Contact providers vary. Measured on AI Ark: preview 1 credit per 100 rows, profile plus email 1 credit when found, mobile 5 credits per call, about 7 to 8 credits per finished contact. AI Ark credits were doubled Oct 8 2026 when LeadMagic was dropped.

## Per-client ICP notes for step 5
- SalesGlider: US specialty trade contractors that do or want commercial work, 11+ employees for call lists. Not GCs, residential-only, suppliers, manufacturers, engineers, franchises.
- EMCOR / Mesa Energy: commercial buildings in the Sacramento area that need HVAC service (property management, plants, local businesses, education, healthcare). Not HVAC competitors, national chains or franchises.
- Deep Roots Capital: owner-run manufacturers in ND, SD, MT, MN, 11 to 300 employees, not for sale. Small pool: say so early if the target can't be reached and ask before widening geography.

## Known gotchas
- Never pull bulk contact rows through an MCP tool that returns them into chat (DiscoLike bulk match, provider search tools). Use REST from an edge function.
- Supabase selects cap at 1,000 rows: batch submits.
- Strip `\u0000` and lone surrogates from provider strings before writing to Postgres.
- Provider phone responses are often nested arrays: flatten every string before checking.
- AI Ark preview masks last names and hides domains; full name comes from export, domain from DiscoLike match. AI Ark search (not preview) costs 0.5 credits per result: never bulk pull through it.
- After a build, disable one-off edge functions (deploy a 410 stub) and tell Josh which functions stay live.