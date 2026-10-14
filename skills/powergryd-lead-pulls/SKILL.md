---
name: powergryd-lead-pulls
description: Pull or top up leads for PowerGRYD / PowerPSA (Jesse Miller, vCISO program for MSPs). Use whenever Josh asks for PowerGRYD leads, Jesse leads, MSP owner or MSP security lead pulls for Jesse, vCISO or fractional CISO pulls, or includes PowerGRYD in a multi client pull. Encodes the three lanes from Jesse's calls, the competitor cut, the Culture Fits overlap rule, and why the vCISO lane needs AI Ark.
---

# PowerGRYD lead pulls

Client: Jesse Miller, PowerPSA / PowerGRYD (teaches MSPs and solo consultants to run a profitable vCISO program). Smartlead client "PowerGryd", client_id 592842. client_tag `powergryd`. ICP source of truth: `topup.client_icp` where client_tag = 'powergryd'.

## Lanes

| Lane | Who | Size |
|---|---|---|
| msp_owners | CEO, Owner, President, Founder at US MSPs that already sell cybersecurity; COO or CTO only at larger MSPs (about $7M to $8M revenue and up) | 25 to 100 employees, $3M to $10M revenue (Jesse's sweet spot 25 to 75) |
| msp_sec_leads | anyone with security in the title inside those same MSPs: Security Operations Manager, Security Lead, Security Manager, Director of Security or Information Security, occasionally CISO | same MSP band |
| vciso | individual people who identify as vCISO, virtual CISO or fractional CISO, solo or 1 to 5 person practices ("people like Mike Trpkosh"), not companies | 1 to 5 people |

OPEN: band floor. Josh's Sept 22 instruction was 20 to 100 and the Sept 22 build standardized on 20 to 100; client_icp records Jesse agreeing to 25 to 100 on the call. Ask Josh which floor to use before the next owner or security lead pull.

## Rules

- PowerGRYD may email the same MSP owners Culture Fits hits. Different sale, so do not dedupe against TJ's loads. The only conflict rule is the same offer reaching the same person from two clients.
- Additional contacts at the same MSP are emailed with their own lane's copy, not held back.
- A vCISO on an MSP's payroll is the security lead persona, not the independent vCISO lane.
- Sports ticket offer uses the local MLB team (run `sports-offer-season`), not NFL.

## Exclusions

- Anyone who coaches or consults MSPs or vCISOs on sales: competitor, DQ (Cayden was told to DQ these).
- Reply only freebie seekers: DQ, do not reply.
- ICP gate cuts, owner and security lanes (tag powergryd): enterprise_consultancy_or_integrator, it_staffing_or_recruiting, msp_vendor_or_software, operating_company_not_it_provider, solo_or_too_thin, telecom_cabling_or_hardware_only.
- ICP gate cuts, vCISO lane (tag powergryd_vciso): large_consultancy_or_audit_firm, operating_company_not_security, security_product_vendor. MSPs that land in the vCISO lane are flagged on purpose.
- Federal contractors were never discussed; no ruling either way.

## How the lanes were pulled (Sept 22 and Oct 2 2026)

- MSP owners: getleads people exports on owner titles, US, LinkedIn employee bands, company_description in ["managed service provider", "managed IT services", "MSP", "managed services provider"], then SQL read the company text to keep real MSPs.
- MSP security leads: getleads keyword title pull plus a 20 title security list filtered by company_description.
- vCISO: people search, not company search. getleads on headline, title and bio (vCISO, fractional CISO, virtual CISO) found 421; AI Ark headline people search found 1,544. AI Ark is required for this lane (estimate first, preview endpoint for bulk sizing). Then a current employer check.
- Names without a valid email go to the name bank (`unresolved-name-routing`), then Email Finder Waterfall max_tier prospeo.
- getleads removed the specialties and company_headline filters before Oct 1 2026. The Sept builds used them; do not try to repeat those exports. Use company_description, and expect timeouts on broad descriptions.

## Pipeline

Follow `lead-list-build`. Size on getleads, AI Ark and Prospeo per `tam-sizing`. Ingest with `lp_run ingest_csv` client_tag `powergryd`, master dedupe (excluding the Culture Fits overlap as above), `icp-website-gate` (variant `powergryd` or `powergryd_vciso`), Email Verifier Progression, `merge-field-qa`, import. HeyReach lanes go through `heyreach-activity-gate` and `heyreach-campaign-setup`. End with `first-pull-receipt` and `record-list-build`.
