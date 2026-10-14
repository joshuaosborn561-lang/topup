---
name: nutter-lead-pulls
description: Pull or top up leads for Nutter Group (Roger Nutter, retained healthcare executive search and interim leaders for hospitals). Use whenever Josh asks for Nutter leads, Roger leads, hospital CEO, CFO, CNO, board or HR lanes, the hiring signal lane, or 990 board members. Encodes the hospital universe Josh chose, the for profit cut, the board via 990 rule, and the PredictLeads signal lane.
---

# Nutter Group lead pulls

Client: Roger Nutter, Nutter Group LLC (retained healthcare executive search since 1988, interim leaders, one year placement guarantee). client_tag `nutter` (schema `client_nutter`). There is no `topup.client_icp` row, no `topup.client_map` row and no `list_build_records` row for Nutter yet. The build lives in `client_nutter` tables only; write a build record before the first top up or the Grok Bot has nothing to replay.

## Universe (Josh, Oct 1 and Oct 5 2026)

- Independent nonprofit hospitals at $50M plus (Josh rejected $80M plus as too small).
- Member hospitals of regional systems, not mega systems.
- Critical access hospitals.
- FQHCs.
- Government owned hospitals (district and county) added Oct 5.
- Out: for profit hospitals (Roger does not work them).

Source tables in `client_nutter`: `cms_hospitals`, `gov_hospitals`, `orgs` and `org_class2` (classification), `mega_check` (system size), `bmf_health` (IRS business master file).

## Lanes

| Lane | Who | Source |
|---|---|---|
| board | board members and officers | public 990 filings (`officers`, `officer_persona`, `board_*`), Josh confirmed this route |
| ceo | the hospital CEO, one per org (`ceo_one_per_org`) | exec pulls plus the waterfall |
| cfo | hospital CFOs, own campaign and pain points | same |
| cno | hospital CNOs, own campaign and pain points | same |
| hr_signal | director level and above in HR or talent acquisition at hospitals hiring leadership roles | PredictLeads job openings (`pl_jobs`, `pl_universe`, `signal_roles`), chosen after a SerpApi Google Jobs pilot failed |

CFOs and CNOs are never folded into the CEO campaign (Oct 6). Josh wants sending to start with whatever lane is ready and add lanes later.

## Rules that affect the list

- Signal lane counts director roles and above, not only VP and C level.
- Some hospital people cannot accept gifts: offers are split between local team sports tickets and a service offer (a succession outline for a leadership role of the prospect's choosing). Run `sports-team-assignment` and `sports-offer-season` for the ticket half.
- Sender is a team member, never Roger; copy is company voice.

## Pipeline

Follow `lead-list-build`. People for the exec lanes: `site-people-dm` and `serp-dm-discovery` first, then Find Named Person, then Email Finder Waterfall (estimate first). Waterfall tables are `public.nutter_wf_*` and `public.nutter_hr_wf_*`. Email Verifier Progression on everything, `merge-field-qa`, import, then `first-pull-receipt` and `record-list-build`. Add Nutter to `topup.client_map` the day its Smartlead client exists, or provenance never stamps.

## OPEN

- Roger owes the number of roles placed for the HR lane context line.
- Confirm the Smartlead client id; `client_nutter.sl_map` has campaign mappings but `topup.client_map` has no row.
