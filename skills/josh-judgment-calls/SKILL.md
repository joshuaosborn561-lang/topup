---
name: "josh-judgment-calls"
description: "Josh's judgment calls on building, splitting, cleaning and topping up lead lists, by client and lane. Read before any list build, top up, ICP cut or caller list, and update it whenever Josh makes a new list decision."
---

# Josh's judgment calls on lead lists

These are decisions Josh made himself, collected Oct 16 2026 from memory, Supabase (`topup.lane_exclusions`, `topup.client_icp`, `topup.process_changes`, `topup.list_build_records`) and past chats. No lead rows, no addresses, no keys. Only decisions.

Each line: **decision**. Why (when known). When.

How to use it:
* A client's ICP from Fireflies calls lives in `topup.client_icp`. This file is Josh's own layer on top. Where the two disagree, the later dated decision wins; if still unclear, ask Josh.
* Newer lines supersede older ones on the same point. Superseded calls are kept and marked so you know the history.

## Keep this file current (Josh, Oct 16 2026)
Josh wants this skill updated every time he makes a list decision, in any session, without being asked. Standing approval: this is the one skill you may update without asking first.
* At the end of any turn where Josh made a call about who is in or out, titles, sizes, sources, splits, offers, top ups, caller lists or when a pool is done, add one line under the right client (or General) in the same format: **decision**. Why. Date.
* If it overrides an older line, edit that line in place and note what it replaced. Don't leave two live rules that disagree.
* If it conflicts with a client skill, the project instructions or `topup.client_icp`, add it here anyway and tell Josh in one line which other place still says the old thing.
* Publish the update as an improvement to this skill (propose_skills, kind improvement, full file) so it saves, and also log it per the record-list-build skill.
* Decisions only. No lead rows, addresses, phone numbers or keys.

---

## General rules (all clients)

### When a pool counts as exhausted
* **Never declare a pool exhausted just because one tool came up empty.** Hard to find DMs reply best and are what clients pay for, so try another tool, SERP, scraper, license rolls or pattern adjudication first. Stop only when the person is verified not to exist, 80%+ is found and the rest is proven infeasible, or Josh rules a method too expensive. Report what was found and the next tier. (Aug 2026)
* **Any exhaustion number from before Aug 25 2026 is understated.** Suppression switched to response based only that day (positive reply, DNC, wrong person, public.suppression), not prior contact. (Aug 25 2026)
* **A full run is not worth it below about 50% DM plus email coverage.** Stay on pilots until a method gets at least 50%, ideally 75%, of companies to a named DM and email; 34% was rejected. (Oct 12 2026, PermitStack contractor lane, applied as the general bar)
* **A job with zero useful output is a failure, say so plainly.** Success is verified emails or correctly titled contacts, never rows processed. (standing)

### Who the buyer is: reason it, don't just match titles (Josh, Oct 16 2026)
Josh wants you and the Grok Bot to reason out who actually signs for this purchase at a company of this type and size, instead of applying a fixed title list. A title is evidence, not the answer.

How to reason it, per company or per size band:
1. **What is being sold and which budget pays for it?** IT services come out of IT; a vCISO or security program can be owner or IT; a roof is the owner or property manager; an executive search is the CEO or board.
2. **How big is the company, and who owns that budget at that size?** Under about 50 people the owner or COO usually buys everything, there is rarely a separate IT buyer. Around 50 to 300 the CIO or top IT person picks the stack. Past about 500 the IT Director or VP of IT runs the evaluation and the CIO signs off.
3. **What does the title mean at this kind of company?** The same word changes rank by industry. At a PE firm the ladder is Analyst, Associate, VP, Principal, Partner, so a PE "Vice President" is mid level deal staff, not a buyer. At most operating companies a VP is senior.
4. **Is it the right department?** Senior but wrong function is still out: VP Sales for an IT or ops purchase, a CFO for TechEvo, clinical leaders for a security program.
5. **Doubt about the reasoning on a whole lane?** Ask Josh before pulling. Doubt about one company? Keep the best fit person and note why in the build record.

Two kinds of "not the buyer," kept apart:
* **Actually junior anywhere:** systems and network administrators, technicians, coordinators, assistants, admins, interns, specialists, clerks, dispatchers. They do the work but don't sign. They never get a gift offer either. (Sept to Oct 2026)
* **Senior sounding but not the buyer here:** PE firm VP, Associate, Analyst, Fellow, Student (Sept 3 2026, BCP); VP Sales, VP Business Development and CRO at Parlay, because Randy's sale is a business unit owner conversation (Sept 28 2026); CFO at TechEvo, Josh would never do one (Aug 2026); Enterprise Architect at Insight (Sept 2026).

Client specific title calls that come out of this reasoning:
* **Goliath:** IT decision maker only, never C suite. Small and mid go CIO, then CISO, then IT Director; large goes IT Director, then VP IT, then CIO; IT Managers never sent. A CIO at a 150 person shop chose the stack. (Aug 2026)
* **Insight:** IT Managers count only under 500 employees; Network Admin, Sys Admin and Enterprise Architect out. (Sept 2026)
* **Parlay:** no CTO; COO only when the company has no named IT DM. (Aug 2026)
* **BCP:** owner plus the chief IT decision maker; under about 50 seats the owner or COO is the IT buyer. (Oct 10 2026)
* **Contractors and trades (SalesGlider, Deep Roots):** owners only, no VPs or managers. (Sept 2026)
* **OEM rep lanes (Insight):** AEs, AMs and CSMs; no SDR, BDR or channel titles. (Sept 2026)

### When Josh rejects a list or a TAM
* **Too small a TAM gets rejected and widened, not shipped.** Nutter's first TAM ($80M+ independent hospitals only) was too small; he chose to count every tier. (Oct 1 2026)
* **A few thousand is too small for a service every building buys** (like backflow testing within two hours of a metro). The unit is the building, not headcount; size it physically with Maps, permits or parcels. (Oct 12 2026)
* **Don't size a LinkedIn native TAM on one vendor.** Count on getleads, AI Ark and Prospeo, and the vendors must roughly agree before reporting. (Oct 12 2026; EMCOR LinkedIn lanes Sept 17 needed getleads and AI Ark to agree)
* **Short exact job title lists undercount about 4x**; a TAM built that way is wrong. Use job functions plus seniority and partition check. (Sept 29 2026)
* **A list with wrong titles is not done.** AI Ark returns whoever appears first at a domain; audit titles before calling a pull good. (standing)
* **Don't guess IT department size or firmographics, use a vendor.** (Sept 2026, Insight)
* **Don't trust getleads' industry tag on call lists**; confirm from the website. (Oct 5 2026)

### What gets checked before anything loads
* **TAM is sized with the tam-sizing skill before any pull.** (Sept 13 2026)
* **Every new pull goes through the ICP website gate (homepage fetch plus Jev) after TAM sizing and the first pull, before paid enrichment or verification**, email lists included, not just call lists. (Oct 9 2026)
* **Every new gate label set gets a 50 site blind check; under about 85% means rewrite and re grade.** Plan for about 10% unreadable sites. (Oct 12 2026)
* **Unreadable or bot blocked sites are not cut.** Read as too thin, route them to a search or DiscoLike fallback first. (Oct 12 2026)
* **Anyone in a client campaign who does not fit that client's stated ICP comes out of the campaign.** Replied leads are never removed. (Oct 12 2026)
* **Josh approves removal counts per campaign before leads are pulled from a live campaign.** (Oct 12 2026)
* **Pull every getleads email status, not VALID only, and verify everything.** Josh does not trust getleads email status; nothing enters Smartlead without Email Verifier Progression. Confirmed Oct 16 2026, overrides the VALID only line in the project instructions. (Sept 13 2026) One exception on record: Insight Sept 29 load, Josh declined re verification because he blamed Microsoft sender caps, not the list.
* **Prior contact rule:** never load anyone a client emailed in the last 90 days; over 90 days with no positive reply, DNC or wrong person, they can be emailed again. (Sept 13 2026)
* **Clients may email each other's contacts; the same offer must never reach the same person from two clients.** (Sept 10 2026)
* **Gateway (SEG) addresses are not held out; they go to the SEG twin campaign of the same offer.** (Sept 10 2026)
* **Rows without a usable first name are held at QA, never sent.** (standing, written into EMCOR Oct 13 2026)
* **Josh signs off on each lead segment before it is pulled or enriched.** List quality is the point. (Sept 10 2026)
* **Any spend over $5 needs Josh's approval**, out of fear a stuck run burns FullEnrich credits. (Sept 10 2026)
* **Smartlead imports always carry job_title, company_size and vertical.** (standing)
* **Don't remove retail, school districts or students by default.** That is per client ICP, not universal. (Sept 13 2026)

### How lists get split into campaigns
* **Every lane is segmented by title; mixed industry lists are segmented by industry, with a general version for the rest.** (Oct 15 2026)
* **Size bands get separate title sets because the decision maker changes with headcount.** Never one flat title set across 11 to 500. (Sept 2 2026)
* **Additional contacts at the same company are emailed with their own lane's copy**, not held back. (Sept 22 2026)
* **Leads already mid sequence finish where they are when an offer changes;** only not yet emailed leads move. (Sept 23 and Oct 15 2026)
* **Every batch of leads carries a written description of exactly how it was pulled.** (Sept 29 2026)
* **Each client gets its own client_tag and write targets; Peterson roofing and Earthworks never share.** (standing)
* **A campaign is working at 1 interested reply per 2,000 sends,** or a variant with 1,000+ sends clearing that rate. Below that, rethink before topping up. (Sept 13 2026)
* **Resend past SalesGlider audiences only if that campaign performed well.** (Sept 2026)

### Offers and gifts (list side)
* **The AirPods fallback for leads with no team only applies to lanes that carry a gift.** (Sept 13 2026)
* **Sports ticket offers follow the season and switch two weeks before the regular season ends:** MLB to NBA two weeks before MLB ends, back to MLB two weeks before NBA ends. (Sept 23 2026, timing settled Oct 16 2026)
* **Team pick order:** NBA team within 100 miles wins; NHL within 30 miles wins when the NBA team isn't close (Tampa gets Lightning, not Magic); both close, NBA wins; then a real college town; nothing nearby gets the spa offer. (Oct 15 2026)
* **Never offer Knicks tickets, too expensive; Rangers instead.** (Oct 12 2026)
* **Austin gets the spa offer, not Spurs, as a one off.** (Oct 15 2026)
* **No giveaways blasted to 1 to 10 person shops.** (Oct 2026, EMCOR; treat as general)

### Sources and vendors (judgment, not mechanics)
* **Maps lanes: no website means cut at the scrape;** contractors with no website aren't worth calling or emailing. (Sept 29 and Oct 6 2026)
* **Individual permit holders with no LLC and no site are out.** (Oct 12 2026)
* **Role inboxes (info@, office@) count as a valid contact at a 1 to 10 person shop.** (Oct 12 2026)
* **DM finding order on domain lists: getleads, then AI Ark, then Prospeo, then website fetch on the misses.** Website people skill first, DiscoLike only on the gaps. Prospeo saved for hard to find emails because it's pricey. (Oct 12 to 14 2026)
* **Domain Waterfall runs Serper first, DiscoLike only on misses; Email Finder Waterfall waits until a row has both owner name and domain.** (Oct 15 2026)
* **For non LinkedIn native ICPs (local owners, trades, dealerships), don't use LinkedIn databases for DMs.** (Sept 22 2026)
* **Banned: PDL, BillionVerifier, Clay, Hunter, LeadMagic (Oct 8), detect_job_change, Name to Email Finder (Sept 30).**
* **getleads data goes stale on people;** retired person replies traced to getleads, so employment currency matters before load. (Aug 2026, Goliath)

### Caller lists
* **LinkedIn presence is not a fit test for call lists;** judge the company itself. (Oct 5 2026)
* **Call lists are verified mobiles only;** replace non mobiles with mobiles. (Oct 5 2026)
* **Segment caller lists by size (1 to 10 vs 11 to 50); no 51 to 200 shops on caller lists.** (Oct 5 to 6 2026)
* **Dedupe callers' lists against each other (Cayden vs Gabe).** (Oct 5 2026)
* **Anyone on Gabe's lists comes out of other email campaigns so Gabe works them.** Gabe only, not Cayden. (Oct 2026)
* **New contacts to top up a caller go in a new queue ("Client2 Timezone"), never into an existing list.** (Oct 8 2026)
* **Cold calling only for lanes where owners pick up; IT prospects don't, and under ~1,000 calls a month per client isn't worth it.** (Sept 29 2026)

---

## Bolder Cyber Partners (BCP, Mike Trpkosh)
* **Venture capital is out of every BCP campaign; private equity is in.** VC firms take the call but won't push founders to buy. 5,784 VC leads purged. (Aug to Oct 2026)
* **PE lane: no Associate, Analyst, VP, Fellow or Student; the 385 purged juniors stay out of future pulls.** (Sept 3 2026)
* **Operating companies stay in the BCP PE lane on purpose** (engagers at portfolio companies are a judgment call). (Oct 12 2026)
* **No one person companies; must be high ticket enough to pay $5k to $20k a month.** Josh's example of a no: a five person tire shop. (Jul 14 and Oct 5 2026)
* **Get the chief IT decision maker at each company too, not just the owner.** (Oct 10 2026)
* **IT DM lane is 51 to 1,000 employees in healthcare and logistics with an AirPods Max offer;** most under 50 seat companies have no separate IT buyer, the owner or COO is the buyer. (Sept 8 and Oct 10 2026)
* **A college team does not count as a ticket gift for BCP;** no pro team means AirPods. (Oct 13 2026)
* **Accelerators are a gray area, flag to Mike, don't auto include.** (Sept 3 2026)
* **MSPs are a referral channel only, never a cold lane.** (Oct 2026)
* **Healthcare split under 1k vs over 1k; over 1k rows with no active campaign wait for Josh.** (Oct 13 2026)

## Cornerstone Earthworks (peterson_earthworks, Kyle and Dwight)
* **The general business bucket (3,276) was cut as out of ICP.** (Sept 14 2026)
* **getleads is not a source for Earthworks;** it went 0 for 104+. (Sept 14 2026)
* **Nonprofit outranks landowner, so land owning churches get the GC offer.** (Sept 14 2026)
* **Schools and government are kept on purpose.** (Oct 12 2026)
* **Never share write targets with Roofs by Peterson.** (standing)

## Culture Fits (TJ)
* **MSP owner and C suite at 11 to 50 employees; when the strict pool runs dry (527 net new in Aug), the answer is a second source (AI Ark) or an ICP talk with TJ, not loosening titles on our own.** (Aug 2026)
* **IT DM ICP for MSP clients moved to a 50 to 300 headcount window** using band labels plus a LinkedIn employee count cutoff. (Aug 25 2026)

## Deep Roots Capital (Tyler Leverington)
* **Owner run manufacturers; owner name is not required at the scrape, but no website means not interested.** Replaces the Sept 2026 call to keep no website shops. (Oct 16 2026)
* **getleads pulls are 1 to 50 employees and use many company description keywords, not NAICS.** (Sept 2026)
* **A chain means 10+ locations and is out; other owner run B2B (dealers, trucking, contractors, wholesalers) is cut from the TAM.** (Sept 2026)
* **No employee sizing on Maps; the real target is $1M to $10M EBITDA.** (Sept 2026)
* **Tier C was cut, keeping A (manufacturing) plus B (adjacent production): 11,814 companies.** (Sept 30 2026)
* **Owners only, never sales reps; oil field businesses, broker listed businesses and 1 to 10 shops are out** (from Tyler's call, Josh agreed). (Sept to Oct 2026)

## EMCOR / Mesa Energy (Myles)
* **Small owner operator companies from Maps aren't on LinkedIn databases;** DMs come from Maps or hard to find DM methods, not getleads or AI Ark. (Sept 22 2026)
* **LinkedIn native lanes need getleads and AI Ark to agree on TAM before building.** (Sept 17 2026)
* **Commercial plumbing lane: every building on a commercial meter within about two hours of Sacramento, sized by valve count, pulled from Maps across the 12 county footprint, as inclusive as possible on single facility types.** (Oct 12 2026)
* **Offer split: AirPods for 11 to 200 employee companies with a non junior title; everyone else gets Scope. Healthcare and education run Scope only.** (Oct 2026)
* **Each company is split 50/50 by a hash of its domain between Scope and Backup so one company never sees both offers and stays on its side on a top up.** (Oct 13 2026)
* **Hold out role inboxes on third party domains, a second role inbox at the same domain, a role inbox where a named person exists, event names and person name practices.** (Oct 13 2026)
* **Chains and GCs are kept on purpose; competitor HVAC contractors, homeowners and no physical facility are cut.** (Oct 12 2026)
* **Suppress existing clients (Myles's Dynamics export) and prospects who replied or declined; silent ones are fair game.** (Sept 28 2026)
* **Describe Mesa as Northern California on calls, not West Sacramento.** (Oct 2 2026)

## Goliath (Dave Ackley)
* **Every Goliath lane targets the IT decision maker, never the C suite.** Dave rejected C suite. (Aug 1 2026)
* **Never widen past 1,000 employees.** (Aug 16 2026)
* **DM priority by band: small and mid go CIO, then CISO, then IT Director; large goes IT Director, then VP IT, then CIO; IT Managers excluded from send in every band.** A CIO at a 150 person shop chose the stack. (Aug 2026)
* **Education lane uses pro teams only, no college teams.** (Aug 17 2026)
* **Mfg/Defense lane uses lookalikes of seed customers only, not broad industry.** (Aug 1 2026)
* **The person whose LinkedIn mentions the displaced vendor is the buyer;** search by tool mention, and drop anyone whose vendor mention is a past role. (Aug 2026)
* **Push for 80% DM coverage on the displacement universe.** (Aug 2026)

## Insight (Josh's own book)
* **No SLED or government accounts at all.** (Sept 9 2026)
* **Small IT department thresholds: IT dept under 15 at under 1k employees, under 25 at 1k to 2k, under 30 at 2k to 5k.** (Sept 2026)
* **Managers only under 500 employees; Network Admin, Sys Admin and Enterprise Architect out.** (Sept 2026)
* **VARs, MSPs and resellers are out (competitors); tech vendors and OEMs go to the OEM lane.** (Sept to Oct 2026)
* **Dedupe the domain list against active Insight accounts before any send;** BioMed Realty is do not contact (another rep owns it). (Sept 2026)
* **Only accounts under $5k GP are workable.** (Sept 2026)
* **OEM lane: AEs, AMs and CSMs; new in seat reps are a priority segment; never Druva; CS and renewals get a different offer than AEs.** (Sept 2026)

## Nutter Group (Roger)
* **Count all tiers: independent nonprofit hospitals at $50M+, members of regional (non mega) systems, critical access hospitals, FQHCs, plus government owned hospitals.** (Oct 1 and Oct 5 2026)
* **No for profit hospitals.** (Oct 5 2026)
* **Board members and officers come from public 990 filings.** (Oct 1 2026)
* **HR lane must be signal triggered (PredictLeads job openings), counting director level roles and up.** (Sept 17 and Oct 5 2026)
* **CFOs and CNOs get their own campaigns, not folded into CEO.** Start sending whatever is ready and add lanes later. (Oct 6 2026)
* **Split offers so some get tickets and some get a service offer, because some hospital people can't accept tickets.** (Sept 18 2026)

## Parlay (Randy)
* **Size band 11 to 500; 1 to 10 companies are a waste of time.** (Sept 2026)
* **No CTO on the IT DM list; COO only when the company has no named IT DM, max one per company.** (Aug 2026)
* **SaaS companies are kept on purpose.** (Oct 12 2026)
* **Leads with a local team go to NBA ticket campaigns; no team gets the spa offer.** (Oct 15 2026)
* **AirPods cut, then spa or Bass Pro Choice cut after a week with no meetings.** Gift takers showed up only for the gift. (Oct 2 and Oct 14 2026)
* **Copy and campaigns split by industry (architecture, finserv, general).** (Oct 15 2026)
* **No COO/CTO stands as Josh's rule** even though Randy never said it on a call. (confirmed Oct 16 2026)

## Peterson roofing (Kyle and Dwight)
* **Building owners found via PermitStack then shell LLC unmasking, roughly 25k leads.** (Oct 2026)
* **Landowners only: churches, property managers and owners in; real estate agents, nonprofits and schools out.** Realtors use bids as leverage. Josh's rule, confirmed Oct 16 2026 though not on a recorded call. (Oct 2026)
* **Single family LLC landlords are parked; landlords are for the phone and Josh won't run calling for Kyle, so email only.** (Oct 12 2026)
* **Keep it cheap, Kyle is churning: no DiscoLike, AI Ark on misses and as the email max tier, cut companies over 500.** (Oct 12 2026)
* **Suppliers and manufacturers are kept on purpose.** (Oct 12 2026)

## PowerGRYD (Jesse Miller)
* **MSP owner lane is 20 to 100 headcount,** not Jesse's 25. (Sept 22 2026, confirmed Oct 16 2026)
* **vCISO lane is individual people (solo or 1 to 5 person practices), not companies.** MSPs landing in it are flagged on purpose. (Sept 22 and Oct 12 2026)
* **No dedupe against Culture Fits; different sale.** (Sept 22 2026)
* **Sales coaches to MSPs are competitors, DQ; reply only freebie seekers, DQ.** (Sept 2026)
* **Ticket offer uses the local MLB team, not NFL** (now NBA per season rule). (Sept 22 2026)

## SalesGlider (own lanes)
* **Specialty contractors only, nothing else.** (Sept 21 2026)
* **5 to 200 employees; 1 to 10 fine on email; hard minimum of 11 on call lists.** (Oct 3 and Oct 6 2026)
* **Owners only.** (Sept 2026)
* **Residential only, GCs, suppliers, manufacturers, rental, consultants, engineers, franchises and chains are out.** (Oct 2026)
* **PermitStack lane: must have filed at least one commercial permit ever; mixed commercial and residential is fine; not at capacity judged over a year, not 90 days; if unsure, include.** Keep it segmented from getleads trades lists to compare. (Sept 22 and Oct 6 2026)
* **Run the permit history sweep in chunks (first 50k) for cash flow.** (Oct 2026)
* **Financial advisors lane is dead, never pull it.** (Aug 2026)
* **Lanes outside specialty contractors don't get topped up without Josh.** (Sept 2026)
* **RVM signal lane: contractors on Google LSA or buying commercial keyword ads; few commercial ad buyers means the ads aren't working for them.** Never RVM an LSA listing phone. (Sept 2026)

## TechEvo (Corey Tapper)
* **IT DMs at roughly 11 to 300 seats in New England and South Florida; no CFOs; vendors who reply as sellers are disqualified; Corey's clients suppressed.** (Aug 2026)
* **Miami lane bounded to about 100 miles (Miami Dade, Broward, Palm Beach, upper Keys); Naples and Fort Myers out.** Keeps clear of Goliath's SW Florida territory. (Aug 2026)
* **Startup owners doing IT themselves get their own lane; that is who Corey actually closes, not unhappy MSP customers.** (Aug 2026)
* **SaaS kept on purpose.** (Oct 12 2026)

## Vasco (Carlos)
* **Never Toyota, Lexus, Volvo, Tesla, BMW, Mercedes (not serviceable) and never Kia (Carlos never named it).** (Aug 2026)
* **getleads is not a source; structurally zero on rooftops.** (Aug 18 2026)

## One offs
* **Jeremy's building: congregations within 30 miles of Manhattan incl NJ and CT; Christian and Jewish only, no Unitarian Universalists, non congregations dropped; each lead needs a website and an email from the site, senior or executive pastor preferred; exclude Hope Church NYC.** (Oct 2 2026)
* **Dallas roofing client: property owners and property management groups.** (Oct 7 2026)

---

## Open conflicts to ask Josh about
* None open as of Oct 16 2026. Add new ones here when two rules disagree.