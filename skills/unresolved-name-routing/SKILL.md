---
name: "unresolved-name-routing"
description: "Never discard a discovered decision maker just because the email is missing. Whenever any discovery source (AI Ark, SERP, getleads, DiscoLike, Maps, waterfall, manual) returns a NAME with no email or an invalid email, bank it in public.name_bank and route it through the resolution ladder... Email Finder Waterfall in person-to-email mode, then the hard-to-find methods, then the phone lane. Use whenever names come back emailless, when Josh says route the misses, work the name bank, or resolve the no-email names, and at the end of ANY discovery run before declaring it complete."
---

# Unresolved name routing

A found name is paid-for inventory. Discovery that ends with "no email" is not a dead
end, it is a handoff. This skill defines where those names go so no session ever
orphans them again (the Goliath displacement build banked 240 AI Ark leadership names
in one night that would otherwise have evaporated).

## The bank

Table: public.name_bank on the campaignintelligence Supabase project
(azpapwtnrbzywlnxxecz). Columns: client_tag, domain, first_name, last_name, job_title,
linkedin_url, source, status, resolved_email. Unique on (client_tag, domain,
first_name, last_name). Insert server to server via PostgREST with
Prefer: resolution=ignore-duplicates... never through chat.

Statuses: pending → waterfalled → hard_to_find → phone_lane. resolved rows get
status resolved and the email copied to resolved_email AND inserted into the client's
wf_contacts table so the targets view picks them up.

## The resolution ladder (run in this order, cheapest first)

1. **Email Finder Waterfall** (always first; Name to Email Finder was retired Sept 30 2026) enrich_waterfall with rows of
   {first_name, last_name, domain}, need=email. This is PERSON-TO-EMAIL mode, the
   thing the waterfall is actually good at... never feed it bare domains for this.
   It cascades getleads, Smartlead, AI Ark, Prospeo, FullEnrich internally. Pass
   `max_tier='prospeo'` and `skip_tiers='leadmagic'` until the service default drops LeadMagic
   (removed from the stack Oct 8 2026).
2. **LinkedIn URL to email** for any banked row that has a linkedin_url: getleads
   `getleads_get_emails_from_linkedin_batch` first (plan credit per success), then AI Ark
   `export_single` by `url` for the misses (paid, estimate first). Server side only. Then the
   current-employer audit from serp-dm-discovery: keep only hits whose email domain
   matches the target domain.
3. **hard-to-find-dm-discovery methods** for what remains: permutation against the
   company's known email pattern (any verified colleague email seeds the pattern),
   catch-all handling per that skill.
4. **Phone lane**: whatever survives all three tiers goes to Cayden with name, title,
   company, and the tech signal as the call opener. Update status to phone_lane and
   export his list from the bank, never from chat.

## Rules

- Bank at DISCOVERY time, in the same pass that processes the hits. Do not defer.
- Bank names with INVALID emails too (mailbox not found) — the name is still real.
- Cross-vendor agreement between ladder tiers = high-confidence on catch-all domains.
- A discovery run is not "done" until its no-email names are banked and tier 1 has
  been fired on them. Report bank counts alongside hit counts.