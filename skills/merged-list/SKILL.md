---
name: merged-list
description: The full merged list-build rulebook (D35–D37). Use before any pull, top-up, recipe, or suppression change. The six taps Josh left pending are yes. Positives expire 90 days after the reply.
---

# Merged list

Josh's rulebook, 2026-09-14. Canon as of D37. The six taps he left pending are yes (D36). Positives expire 90 days after the reply and are the global list for every client (D37).

## Every client

1. Only block people who replied positively, said don't contact, or said wrong person. DNC and wrong person forever. Positives expire 90 days after the reply (D37).
2. Don't load anyone the client sent to in the last 90 days. Past 90 days with no DNC / wrong-person response, they're fair game. Never put someone in two live campaigns of the same client at once.
3. Two clients can email the same person. The same offer from two clients can't.
4. Customer domain lists are optional. The global list is campaignintelligence positives (D37). Do not halt a run for an empty customer list.
5. Verify everything before Smartlead, whatever the vendor says. Verified means MillionVerifier good, or catch all plus No2Bounce deliverable.
6. SEG split is always on. Gateway companies go to the SEG campaigns, not thrown out.
7. If the lane has a gift: no team found means AirPods. If no gift, teams don't matter.
8. Banks, credit unions, insurance, government: flag you before a gift campaign. Default is they stay in.
9. Size the segment with the TAM skill before pulling.
10. Every imported lead carries everything: title, size, vertical, normalized name and company, location, team, mail class, which build it came from.
11. Never say a pool is empty. Show widening options with counts. Every unresolved company keeps a next action.
12. Working means one interested reply per 2,000 sends at the campaign level, or any variant with 1,000 sends clearing that rate. Interested and meeting only.
13. No client shares lead tables. Everything rolls up to the master table.
14. Over $5 a step asks first. FullEnrich off until stamped. PDL, job change detector, BillionVerifier, Clay banned. Hunter out.
15. Pull every email status. We verify anyway.
16. Churned clients have null client id but their data stays forever. Never prune.
17. getleads data is stale enough that retirees reply. A currency check before load is required; no cheap method yet.

## Parlay

18. IT decision makers, the 15 title list. COO only when a company has no named IT DM.
19. Bands 11 to 50, 51 to 200, 201 to 500.
20. Ops and Sales DM lane too: owners, COOs, presidents for EOS; VP Sales and RevOps for sales, same companies.
21. IT DMs allowed in EOS lanes only with the "IT partner" copy fix.
22. Churches and nonprofits get EOS, never Trendrr.
23. Three contacts per company max.

## Culture Fits

24. MSP owners and C suite by description match, 11 to 50.
25. Don't widen until TJ says so.

## TechEvo

26. New England IT DM includes New York and New Jersey.
27. Florida IT DM is statewide. SFL owners lane still metro.
28. Check region on the contact's city after export; getleads' state filter is loose.
29. IT titles first. COO only at 11 to 50, one per company.
30. Govt sub lane is CMMC defense contractors, both regions, owners allowed.
31. AI Ark people search is a second source for TechEvo IT DMs.

## Goliath

32. IT decision maker only. Dave rejected C suite.
33. IT Managers excluded in every band. Small and mid: CIO, then CISO, then IT Director. Large: IT Director, then VP of IT, CIO backup.
34. Bands 51 to 1000, not past.
35. Mfg defense is lookalikes of Dave's customers only, never broad industry.
36. Education: education IT titles, split by school type, MLB or NFL or AirPods only, no college, no NBA.
37. Displacement: the person whose profile names the vendor is the buyer. Tool mention search, strict company match.

## BCP

38. PE lane never includes associates, analysts, VPs, fellows, students.
39. Growth lane is IT decision maker in healthcare and logistics.
40. BCP and Goliath share people, not offers.

## Peterson roofing

41. Contractors: owners and principals until Kyle confirms PM, estimator, superintendent.
42. Maps run has MSP and IT categories mixed in. Filter out.
43. Maps auto excludes "general contractor" on a roofing client. Override when GCs are the lane.
44. GC domain gate must be permissive: design, concrete, glass, electric are legit.
45. Honor the off ICP marks in the resolution table.
46. Property managers from getleads. Churches from Maps, 20 review minimum. Church lane takes tickets and AirPods like any lane.
47. Commercial permits only, five types, never residential.
48. Maps finds businesses, permits find who's building, parcels find who owns.
49. "Falls to you or the CEO" line only at companies over about 10 people.

## Earthworks

50. Own tag, own tables.
51. 180 miles of Dallas. Four lanes: nonprofit named, nonprofit role inbox, vacant land plus permit, vacant land owners with role inboxes. General businesses out.
52. Role inboxes allowed as their own lane here.
53. Improved commercial owners means 2 plus parcels. All 3,958 operators in scope.
54. getleads is wrong for this persona. Don't use it.
55. Shell LLCs unmasked by mailing address, never name.

## Insight

56. Director and above at US companies 201 to 2,000 with IT departments of 15 or fewer. No SLED. Managers only under 500. Three per company.
57. Modeled on Embark, Awardco, DocGo, Shane Co. Growth rate is a score, never a filter.
58. Gateway catch alls dropped, not segmented.
59. OEM reps pulled by employer and role.

## Vasco

60. Serviceable brands only: Nissan, Infiniti, Honda, Acura, Subaru, Mazda, Mitsubishi, Ford, Lincoln, all GM, Chrysler Dodge Jeep Ram, Hyundai, Genesis, VW, Audi. Toyota, Lexus, Volvo, Tesla, BMW, Mercedes, exotics out. Kia out.
61. 40 miles of Clifton NJ. Carlos's 31 clients blocked.
62. Never run getleads on rooftops.
63. Titles: Service Director, Fixed Ops Director, Service Manager, Warranty Administrator. Principal or GM lane too.
64. Warranty admin hiring is a signal lane.

## SalesGlider

65. 11 plus employees every lane. PE alone allows 5 plus.
66. Staffing is three segments by size, never one flat title list.
67. Financial advisors lane is dead.
68. Engagers: engaged in last 90 days, not a competitor agency, real title, 11 to 500, currently employed. It's a feed, not a pull.

## Methods

69. Tell getleads company size as exact band labels. Check industry names against its list.
70. Order: getleads, then AI Ark for people, then LeadMagic, then FullEnrich last.
71. Name to Email is paused; DiscoLike find emails is the cheap first rung.
72. The Smartlead email lookup in the waterfall is a real tier. 89% on Peterson GCs.
73. Audit titles after every AI Ark pull.
74. LeadMagic: employee finder, filter titles in SQL, then email finder. Prospeo for names, 25x cheaper.
75. Verifier stalls: resume once, split, quarantine. Zero result resume is a stall.
76. Maps: every brand and subtype its own category, audit the classifier, re filter geography after. Address strategy for LLC domains, not name.
77. Vacancy signal: backfill job postings, target the peer who inherited, never the empty seat.
78. Cold call lists: Maps first, firmographic verify by getleads domain lookup, exclude solo operator categories.

All six taps (2's addition, 26, 27, 53, 58, 71) are decided yes as of D36.
