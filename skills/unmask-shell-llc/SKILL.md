---
name: unmask-shell-llc
description: Turn an address-named shell LLC into the real operating company behind it, using the parcel mailing address rather than the entity name. Use whenever a lead list contains entities like "1445 ROSS AVE LLC", "100 GLASS SITE LLC", or any owner name that is a street address, a numbered entity, or a single-purpose holding company with no web presence. Also use when Josh says unmask the LLCs, find who is behind these entities, resolve the shells, or when a name-based domain resolve returns under 5% on a list of property owners. Measured Sept 2026 on the Peterson earthworks build.
---

# Unmasking shell LLCs

## The core insight

A single-purpose real estate LLC has no website, no employees, no LinkedIn, and no Google Maps listing. Every name-based method fails on it. Measured: **1% resolve rate** on 761 permit-owner LLCs via Maps name search.

But the LLC has to receive its tax bill somewhere, and that somewhere is the operator's actual office. **The mailing address is the identity, not the name.** Measured on the same list: **63% parcel hit, then 49 to 66% of those resolved to a real named business.**

One operator often controls dozens of shells from one suite. Resolving the address once resolves all of them.

## What does not work, and why

| Method | Rate | Why it fails |
|---|---|---|
| Maps search by entity name | 1% | "1445 Ross Ave LLC" is not a business anyone searches for |
| Texas Comptroller officer match, general shells | 19% | Single-purpose LLCs list a registered agent, a law firm, not a manager |
| Comptroller on concentrated owners | 9.5% | Sophisticated owners nest LLCs inside LLCs; 8 of 27 "officers" were themselves LLCs |
| SERP the entity name | untested, expect near zero | No indexed web presence to find |
| getleads / AI Ark / LeadMagic | 0% | All LinkedIn-derived; these entities have no LinkedIn |

Do not spend money on any of these before running the address method.

## The method

**Step 1. Get a job or parcel address for the entity.**
From a permit record (`address_street`, `address_city`) or directly from the parcel record. Permit `owner_address` fields are often present in the schema but empty; do not rely on them.

**Step 2. Join the address to the parcel roll to get the owner mailing address.**
Normalize both sides hard before comparing:

```sql
upper(regexp_replace(address, '[^A-Z0-9]', '', 'gi'))
```

Match on normalized street plus city. Expect roughly 50 to 65% to find a parcel.

**Step 3. Free pass first. Join the mailing address to operators you already have.**
Before spending anything, check whether the mailing address already matches a known domained operator in your own data. On the Peterson build this alone resolved **3,350 of 11,063 entity landowners for $0**.

**Step 4. Maps address search on the remainder.**
`resolve_places` with `strategy='address'`, `min_confidence=0.5`, name column pointed at the mailing address. Free under the Maps ultra plan.

**Deduplicate by normalized mailing address before calling.** 8,662 rows collapsed to 7,503 distinct addresses on the real run; skipping this wastes roughly 15% of the requests.

Expected: **66% return a real business name.**

**Step 5. Get the domain.**
Maps `details_only` does not reliably write back the website (known bug as of Sept 2026, see the loop warning below). Instead take the business names to a name-to-domain resolver: DiscoLike `bulk-match-company-to-domain` with name plus city plus state, up to 1,000 per call, returns `match_confidence`.

**Step 6. Feed name plus company plus domain to the email waterfall as normal.**

## Guardrails learned the hard way

**Never run `resolve_places` with `details_only=true` and a `where` clause that depends on the job's own output.** `where='website is null'` is self-refilling when the write-back fails. One run looped on the same 168 rows for seven hours and burned **65,558 Maps requests for zero rows written**. Check `done` against `total` at the first poll; if `done` exceeds `total`, kill it.

**Poll every background job within five minutes of starting it.** Do not leave one running overnight unchecked.

**Person-named owners do not work with this method.** Measured: **0 of 10,352** person-named landowners had a mailing address matching a business. They mail to houses. Route those to direct mail or phone, not email.

**Filter for ICP before resolving.** 68% of person-named vacant-land owners held exactly one parcel. A person with one empty lot is not a commercial sitework buyer. Use a 3+ parcel floor on individuals.

## Expected yield, end to end

Starting from 11,000 entity landowners:

| Stage | Survivors |
|---|---|
| Free operator-address join | 3,350 |
| Maps address resolve on the rest | ~4,900 named businesses |
| Domain resolution on those names | pending measurement |

Roughly half the entity population becomes reachable, for close to zero vendor spend.
