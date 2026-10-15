---
name: "merge-field-qa"
description: "The pre-launch gate that every SalesGlider campaign list passes before import into Smartlead. Use whenever Josh says get a campaign sending, stage the lanes, spot check the fields, or asks whether a list is ready. Also use automatically before any Smartlead import or before setting a campaign ACTIVE. Covers the defect scan, the 200 random row read per step scored in parallel with the next step (a 2 percent hold blocks import only, never mid-pipeline; ICP counts false passes only), the merge field completeness rule per lane, permit address formatting, and the deduplication rules that stop several people at one company getting the same personalized email. Every check here exists because something shipped wrong on the Cornerstone Earthworks build, Sept 2026."
---

# Merge field QA

A list is not ready because the fields are populated. It is ready when every field renders as a sentence a human would write.

## Two passes, both required

**Pass 1, the automated defect scan.** Catches structural breakage. Fast, and it will tell you everything is fine when it is not.

**Pass 2, a separate pass over 200 random rows per step.** Catches the defects that are individually well formed and collectively embarrassing. On a 2,500 row send the scan returned zero defects while the sample showed `St.. Andrew Kim`, `OScar`, `BridgePoint CHURCH` and a contact in Brampton, Ontario in a Texas-only lane.

This is the same QA rule as `lead-list-build` steps 7, 8 and 11, and it runs after every normalization or assignment step: first names, cities, company names, conversational location, sports teams, ICP gate labels, campaign routing. For each step, pull 200 random rows (not the top of the table) and check them in a pass separate from the one that produced them **while the next pipeline step runs**. Report the error rate per step when the sample finishes. **Josh's rule: hold if any step is over 2 percent errors** until that step is fixed and re-checked. The hold is only before Smartlead import / upload. Do not pause fetch, grade, people, email, verify, normalize, purge, route, or stage for a sample. Counts and up to 10 company names in chat, never rows.

**ICP gate sample uses its own bar.** Count only false passes (a company that is not the buyer, marked `icp_gate = yes`) against the 2 percent line. Track false cuts (a real buyer marked `no`) separately and report both; do not add them into the hold rate. Every other step still counts every wrong value.

Twenty rows is not enough. These defects appear in under 2% of records, which is exactly the hold line.

## Pass 1: the defect scan

| Field | Fails if |
|---|---|
| first_name | blank on a lane whose copy uses it · length under 2 · contains a digit, period or parenthesis · matches `^[A-Z][A-Z]` · internal caps like `MacHael` · is a handle not a name (`Ttvslappy`, `Thogaru`) · multiword |
| company_name | blank · contains a parenthesis or quote · contains `..` · ends in a legal suffix · contains an ALLCAPS ordinary word · **ends in a TLD** (`Unicitec.com`, `Evolve Talent.io`) · **longer than 40 characters** · **single smashed word over 14 characters** |
| location | blank on any lane whose copy uses the tag |
| sports team | blank on any row in the ticket tier |
| permit_address | blank on the permit lane · contains a comma or a 5 digit number |
| domain | blank |
| email | fails `^[^@ ]+@[^@ ]+\.[a-z]{2,}$` · **local part is a role inbox** (`info`, `careers`, `hr`, `sales`, `recruiting`, `jobs`, `apply`, `resumes`) |
| any tag used in a subject line | **subject renders longer than 38 characters** · value is too vague to name |

### Company name is often a LinkedIn tagline, not a name

The single biggest source of bad company values. Firms put their whole
positioning statement in the field, so you get "An Executive Search Firm
Specializing in Engineers Corporate Operations Plant Management and Evs" at 96
characters. Anything over 40 characters is almost always this.

Cut at the descriptor. Strip a trailing `Executive Search`, `Recruiting`,
`Staffing`, `Search`, `Full-Service Staffing`, `Global Search`, `Leadership
Consultants`, `Talent Strategy`, `Your Specialist ...`, `Certified Disability
...` and everything after it. Hand-fix whatever is left over 40 characters, since
those need judgment rather than a regex.

### A tag used in a subject line has a length ceiling

If copy puts a merge tag in the subject, the rendered subject has to stay
scannable. Over 38 characters and it truncates in the client. Shorten the value
rather than the copy:

| Too long | Use |
|---|---|
| Chief Information Security Officer | CISO |
| Customer Service Representative | Customer Service Rep |
| Construction Project Manager | Construction PM |
| Medical Sales Representative | Medical Sales Rep |
| Clinical Operations Director | Clinical Ops Director |
| Pharmaceutical Sales Representative | Pharma Sales Rep |

### Vague values fail even when they are present

A value that is technically filled but says nothing is a defect, not a pass.
`Executive Director`, `Chief Executive Officer`, `Laboratory Professional`,
`Safety Professional`, `Technical Specialist`, `Assembly Worker`, `Construction
Worker`, `Executive Assistant`, `Investment Associate` all render a sentence the
reader learns nothing from.

**Null them so the row falls to the generic segment** rather than sending a
specific-sounding line that is not specific. Losing a row from the personalized
segment is cheaper than sending "Executive Director candidates" to a firm that
places twelve different roles.

### Blank rather than wrong

Where a value is unusable and there is no fix, set it to empty string so the
sending tool uses its fallback copy. Never leave a value that renders "Hey ,"
or "Hey T.,". Blank is a working fallback; junk is a visible mistake.

## Pass 2: what to look for when reading

- Names that are capitalized wrong rather than missing
- Company names that read like a legal filing instead of speech
- Locations outside the client's service area, including other countries
- Any value you would not type yourself

Count every one of these as an error for the step that produced the field. Over 2 percent on any non-ICP step holds import, not the rest of the pipeline. The ICP sample counts false passes only (see above).

## Merge field completeness is per lane, not per list

A blank field is only a defect if that lane's copy uses it. Role inbox lanes have no first name **by design** and their copy is written around that.

**Rule: for each lane, list the tags its copy uses, then require 100% completeness on exactly those.** Do not require first_name globally, and do not let a lane whose copy uses `{{location_conversational}}` ship with blanks.

When a row cannot render a tag its lane needs, **exclude the row**, do not blank the tag. A fallback is acceptable only when it reads naturally: city for metro is fine (`conversational-location` falls back to the raw normalized city when a city cannot be mapped to a metro, never blank), nothing for a person's name is not.

## Permit address formatting

Street only. No city, state or ZIP. No suite number after a comma. Title case, with directionals kept uppercase.

`1325 GROSS RD, DALLAS TX 75217` becomes `1325 Gross Rd`
`1610 S Malcolm X Blvd, 250` becomes `1610 S Malcolm X Blvd`

The address sits mid sentence, so ALLCAPS reads like shouting.

## Deduplicate on the thing the copy is about

This is the check most likely to be skipped and the most damaging when it is.

If copy references a specific asset (a permit address, a property, a job), **several contacts at the same company will all receive an identical personalized email about the same thing.** On the Cornerstone build `1707 San Jacinto St` appeared on roughly 40 contacts. One address, 40 near identical emails, from one sender.

**Keep one contact per referenced asset.** Rank by: has a first name, then title seniority, then anything stable. On that build the permit lane went from 25 contacts to 7, and 7 is the honest number.

Also dedupe by email across lanes, so nobody sits in two campaigns.

## Geography

Distance filter on the client's actual radius, and store the distance so it can be tightened later without recomputing.

**A distance filter is not enough on its own.** Rows with no city pass a `NULL` check, and a city name that also exists in another state or country resolves to the wrong place. Brampton, Washington and Atlanta all survived a 180 mile Texas filter. Cross-check the city against a known in-state city list for any lane whose copy names the area.

## Before handing the files over

1. Defect scan returns zero
2. 200 random rows read per step in a separate pass, scored in parallel with the next step, error rate reported per step, no non-ICP step over 2 percent and ICP false-pass rate not over 2 percent (otherwise import is held; the rest of the pipeline already ran)
3. Completeness verified per lane against that lane's tags
4. Deduplicated on referenced assets and on email
5. Geography verified, not just distance-filtered
6. Row counts stated per lane and per gift tier

Then, and only then, hand over the campaign files.