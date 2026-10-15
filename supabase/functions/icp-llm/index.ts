// icp-llm (D111 claiming). Project azpapwtnrbzywlnxxecz only. Do not deploy until Josh says.
// HTTP k= is the live function's existing gate. Set function secret ICP_LLM_HTTP_KEY on deploy.
// Never put that value in git. Pool stays max: 2, idle_timeout: 10. Hard cap 5 copies.
import postgres from 'npm:postgres@3.4.4';
// ICP check on our own fetched site text (client_salesglider.icp_site_text) with Gemini direct or Jev via OpenRouter.
// Writes client_salesglider.icp_llm_results (raw typed answers in `answers`). Returns counts only.
// modes: models, run (&model=gemini:<name> | jev:<openrouter id>|<variant>  &batch=&n=&w=  or &tag=<gate tag> to grade from topup.gate_domains)
// Jev variants: single, decomp, choice (SalesGlider trades), emcor2 (EMCOR / Mesa), deeproots, bcp (BCP PE lane), bcp_ops (BCP healthcare / logistics lanes),
// itbuyer/itbuyer2 (Parlay, TechEvo), insight/insight2, insight_oem, powergryd, powergryd_vciso, peterson, earthworks, sg_staffing, sg_fa. Category variants pass only the label in PASS.
// Run claims rows (in_progress lease, SKIP LOCKED) so 3-5 copies can share a batch. idle_timeout keeps warm copies from hoarding DB connections. Hard cap 5 copies (advisory lock).
const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 2, prepare: false, idle_timeout: 10 });
const KEY = Deno.env.get('ICP_LLM_HTTP_KEY') ?? '';
const ok = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
export const YES = `The company itself performs building trade work with its own crews (roofing, HVAC, mechanical, plumbing, electrical, fire protection, concrete, paving, glazing, painting, flooring, drywall, framing, insulation, masonry, steel erection, excavation, site work, low voltage, security, signage, commercial doors, solar), AND its website has a dedicated commercial, industrial, institutional or multifamily services page, or names specific commercial projects or commercial clients.`;
export const NO = `Any of these: the company mainly sells, supplies, distributes, manufactures, fabricates for others, rents equipment, consults, inspects, engineers, designs, represents manufacturers, or manages facilities; it is a general contractor or construction manager that subs out the trades; it is residential only or homeowner focused with at most a passing mention of commercial (including basement waterproofing, decks, landscaping, pools, residential remodeling); or it is not a contractor.`;
const PROMPT = (txt: string, dom: string) => `You screen companies for a cold outreach list. Decide if this company is a fit.\n\nFIT (yes) only if: ${YES}\n\nNOT A FIT (no) if: ${NO}\n\nIf the website text is too thin to tell, answer no.\n\nDomain: ${dom}\nWebsite text:\n${txt}\n\nReturn JSON: {"fit":"yes"|"no","confidence":0 to 1,"reason":"under 20 words"}`;
const TRADES = 'roofing, HVAC, mechanical, plumbing, electrical, fire protection, concrete, paving, glazing, painting, flooring, drywall, framing, insulation, masonry, steel erection, excavation, site work, low voltage, security systems, signage, commercial doors, solar';
const PASS: Record<string, string> = { choice: 'commercial_trade_contractor', emcor: 'commercial_facility_operator', emcor2: 'buyer_with_own_facility', deeproots: 'independent_manufacturer', bcp: 'private_equity_firm',
  itbuyer: 'operating_business_with_internal_it', insight: 'company_with_internal_it_department', insight_oem: 'technology_vendor_with_channel', powergryd: 'managed_service_provider', powergryd_vciso: 'vciso_or_fractional_security_practice', peterson: 'commercial_property_decision_maker', earthworks: 'property_owner_or_developer', insight2: 'company_with_internal_it_department', itbuyer2: 'operating_business_with_internal_it', bcp_ops: 'healthcare_or_logistics_operating_company', sg_staffing: 'staffing_or_recruiting_firm', sg_fa: 'independent_financial_advisory_firm' };
const JEV_Q: Record<string, any> = {
  single: { icp_fit: { type: 'noul', instructions: 'Is this company a fit for a cold outreach list of commercial specialty trade contractors? If the website text is too thin to tell, treat it as not a fit.', criteria: { true: YES, false: NO } } },
  decomp: {
    does_trade_work: { type: 'noul', instructions: `Does this company itself perform hands on building trade work (${TRADES}) with its own crews or technicians?`, criteria: { true: 'Its own crews install, build, service or repair in one of these trades.', false: 'It sells, supplies, manufactures, rents, designs, consults, inspects, cleans, landscapes, or only manages or subcontracts the work.' } },
    commercial_work: { type: 'noul', instructions: 'Does the website show real commercial, industrial, institutional or multifamily work?', criteria: { true: 'A dedicated commercial or industrial services page, or named commercial projects, buildings or business clients.', false: 'Homeowner focused, or commercial is only a passing word in a list.' } },
    supplier_or_maker: { type: 'noul', instructions: 'Is the main business selling, supplying, distributing, manufacturing, fabricating for others, or renting equipment?', criteria: { true: 'A supplier, store, distributor, manufacturer, fabricator, rental company or manufacturers rep.', false: 'Mainly a service or installation business.' } },
    consultant: { type: 'noul', instructions: 'Is the main business consulting, engineering, design, inspection, testing, or facility management?', criteria: { true: 'Consultant, engineer, architect, inspector, commissioning agent, energy auditor or facility manager.', false: 'Not mainly one of these.' } },
    general_contractor: { type: 'noul', instructions: 'Is this a general contractor, construction manager or design build firm that coordinates subcontractors rather than performing one trade itself?', criteria: { true: 'GC, construction management, design build, developer or builder that subs out the trades.', false: 'Performs a specific trade itself.' } },
    residential_only: { type: 'noul', instructions: 'Does the company serve mainly homeowners, such as home remodeling, residential roofing or HVAC, basements, decks, pools or landscaping?', criteria: { true: 'Homeowner focused residential business.', false: 'Serves businesses, buildings or commercial clients in a real way.' } },
    franchise_or_chain: { type: 'noul', instructions: 'Is this a franchise brand, franchise location, or national chain?', criteria: { true: 'Franchise system or national chain.', false: 'Independent local or regional company.' } },
    us_company: { type: 'noul', instructions: 'Is this company based in and serving the United States?', criteria: { true: 'US based.', false: 'Based outside the United States.' } },
  },
  choice: { category: { type: 'choice', instructions: 'Which best describes this company, based on its website?', criteria: {
    commercial_trade_contractor: `Independent US contractor whose own crews perform a building trade (${TRADES}) and that clearly does commercial, industrial, institutional or multifamily work.`,
    residential_trade_contractor: 'Trade contractor focused on homeowners, with commercial work absent or only mentioned in passing.',
    general_contractor: 'General contractor, construction manager, design build firm, developer or builder that coordinates subcontractors.',
    supplier_manufacturer_rental: 'Sells, supplies, distributes, manufactures, fabricates for others, or rents equipment; or a manufacturers rep.',
    consultant_engineer: 'Consulting, engineering, architecture, inspection, testing, commissioning, energy audits or facility management.',
    franchise_or_chain: 'Franchise brand, franchise location or national chain.',
    other_not_contractor: 'Anything else: cleaning, landscaping, pools, software, staffing, non US, or not a contractor.' } } },
  // v1, retired Oct 9 2026: dumped real buyers (plants, clinics, storage) into "other". Kept for the record.
  emcor: { category: { type: 'choice', instructions: 'Which best describes this organization, based on its website? We sell commercial HVAC service and maintenance to organizations that run their own buildings.', criteria: {
    commercial_facility_operator: 'Owns, operates or manages commercial, industrial, institutional or multifamily buildings that need heating and cooling: property management, manufacturing or processing plant, warehouse or distribution center, school or college, hospital, clinic or senior living, hotel, church, office based business, or a local business with its own facility.',
    hvac_mechanical_contractor: 'HVAC, mechanical, refrigeration, plumbing or building services contractor: a competitor, not a buyer.',
    other_contractor_or_trade: 'Other construction contractor, builder, developer or trade company.',
    national_chain_or_franchise: 'National chain, big corporation location, or franchise unit whose facilities are managed by a corporate office.',
    residential_or_home_based: 'Serves homeowners, is run from a home, or is a residential real estate agent or homeowner service.',
    online_or_no_facility: 'Software, online business, consultant, agency or remote service with no real building of its own to maintain.',
    other: 'Anything else, or the website is too thin to tell.' } } },
  // EMCOR / Mesa Energy v2: anyone who runs their own building buys HVAC service. No catch-all label. Geography from list data.
  emcor2: { category: { type: 'choice', instructions: 'We sell commercial HVAC service and maintenance. Which best describes this organization, based on its website?', criteria: {
    buyer_with_own_facility: 'Any business or organization that runs its own physical building, plant, shop, office, clinic, school, warehouse, storage facility, hotel, church or rental property, so it pays for heating and cooling. Includes manufacturers, processors, labs, medical, dental and veterinary practices, nonprofits, property managers and building owners. Industry and size do not matter.',
    hvac_or_building_services_contractor: 'HVAC, mechanical, refrigeration, plumbing, electrical or building services contractor: a competitor, not a buyer.',
    other_construction_contractor: 'Construction contractor, builder or developer.',
    national_chain_or_public_corporation: 'Location of a national chain, franchise, or large public corporation whose buildings are handled by a corporate facilities team.',
    homeowner_or_home_based: 'Serves homeowners or is run from a home, including residential real estate agents.',
    no_physical_facility: 'Online only, software, staffing, or a remote service or consultant with no building of its own.' } } },
  // Deep Roots Capital: owner run manufacturers to acquire ($1M to $10M EBITDA). Size and geography are enforced from list data.
  deeproots: { category: { type: 'choice', instructions: 'Which best describes this company, based on its website? We are looking for independent, owner run manufacturers.', criteria: {
    independent_manufacturer: 'Independent, privately owned company that makes physical products in its own plant or shop: fabrication, machining, metal or plastic products, food or beverage processing, equipment, trailers, wood products, printing, chemicals and similar.',
    dealer_distributor_wholesaler: 'Sells, distributes, wholesales or deals products made by others, including equipment and auto dealers.',
    contractor_or_trade: 'Construction contractor or trade service company.',
    trucking_logistics: 'Trucking, freight, logistics, warehousing or transportation company.',
    subsidiary_chain_or_franchise: 'Part of a large or public corporation, a chain with many locations, or a franchise.',
    farm_or_consumer_service: 'Farm or ranch, retail store, restaurant, or consumer service business.',
    other: 'Anything else, or the website is too thin to tell.' } } },
  // Bolder Cyber Partners (Mike Trpkosh), investor lane. Built Oct 9 2026 to separate private equity (keep) from venture capital (cut).
  // Josh, Oct 9 2026: venture capital out of every BCP campaign, private equity stays. VC portfolio companies are prototypes with no security spend.
  bcp: { category: { type: 'choice', instructions: 'We sell vCISO and cybersecurity leadership to investors who own and operate companies. Which best describes this firm, based on its website? Judge by the money it actually deploys, not by a phrase in a boilerplate line. A firm that says "private equity and venture capital" but whose portfolio is seed and Series A startups is venture capital. A firm that takes control or majority positions in established, revenue generating companies is private equity even if it also runs a small venture sleeve.', criteria: {
    private_equity_firm: 'Buyout or control investor in established operating companies: private equity, lower middle market or middle market buyouts, platform and add on acquisitions, majority or control stakes, growth equity in profitable companies, independent sponsors, search funds, family offices doing control deals, and the operating partner or portfolio operations teams inside them. Mentions EBITDA, value creation, portfolio operations, recapitalization, management buyouts, or holding periods.',
    venture_capital_firm: 'Venture investor in startups: pre seed, seed, Series A or B, early stage, venture capital, micro VC, angel fund or syndicate, accelerator or incubator, studio, or a corporate venture arm. Minority stakes in young, pre profit technology or life science companies.',
    investment_bank_or_advisor: 'Investment bank, M&A advisory, business brokerage, placement agent, valuation or transaction advisory firm that advises on deals rather than owning companies.',
    other_investor_or_asset_manager: 'Hedge fund, credit or private debt fund, real estate investor or REIT, fund of funds, wealth or asset management, RIA, insurance or retail financial services.',
    operating_company_not_investor: 'An operating business, including a portfolio company, that sells its own products or services rather than investing in companies.',
    other_or_too_thin: 'Anything else, or the website is too thin to tell what the firm invests in.' } } },
  // Parlay Tech (Randy) and TechEvo (Corey): MSPs selling managed IT to companies with an internal IT decision maker. Size and geography from list data. Built Oct 12 2026.
  itbuyer: { category: { type: 'choice', instructions: 'We sell managed IT services and IT support to companies that have their own staff and an internal IT decision maker. Which best describes this organization, based on its website?', criteria: {
    operating_business_with_internal_it: 'A company or organization that runs its own operations with office or facility staff and would employ or outsource IT: financial services, insurance, accounting, law, architecture, engineering, healthcare, manufacturing, distribution, construction, nonprofits, schools, local government and any other business that uses computers to run itself. Industry does not matter.',
    msp_or_it_services_provider: 'Managed service provider, IT support, IT consulting, cybersecurity services, cloud services or systems integrator: a competitor, not a buyer.',
    software_or_technology_vendor: 'A company whose product is software, SaaS, hardware, telecom or a technology platform it sells to others.',
    it_staffing_or_recruiting: 'Staffing, recruiting or placement firm, including IT staffing.',
    national_chain_or_public_corporation: 'Location of a national chain, franchise, or large public corporation whose IT is run by a corporate IT department.',
    solo_or_home_based: 'A one person business, freelancer, independent agent, or home based operation with no staff to support.' } } },
  // Insight (Josh's own book): IT decision makers at companies that buy hardware, software and cloud through a VAR. Cannot work SLED or government. Built Oct 12 2026.
  insight: { category: { type: 'choice', instructions: 'We are a technology reseller and solutions provider selling hardware, software licensing, Microsoft 365, cloud and IT services to companies with an internal IT department. Which best describes this organization, based on its website?', criteria: {
    company_with_internal_it_department: 'A private company, nonprofit or healthcare organization that runs its own business and has, or would have, an internal IT department buying hardware, software licenses, cloud and IT services. Any industry, any size from small business to large enterprise, as long as it is not government or public education.',
    var_msp_or_it_reseller: 'Value added reseller, managed service provider, IT consultancy, systems integrator or distributor that resells or services technology for other companies: a competitor, not a buyer.',
    technology_vendor_or_oem: 'A hardware, software, networking, security or cloud maker that sells its own technology products, such as Microsoft, Cisco, Fortinet, Okta, Dell or a SaaS company.',
    government_or_public_education: 'Federal, state or local government agency, public school district, public college or university, or other public sector body.',
    solo_or_home_based: 'A one person business, freelancer, independent agent, or home based operation with no IT department to speak of.',
    other_not_a_company: 'Not an organization at all: a personal site, blog, parked domain, or something that does not buy IT.' } } },
  // Insight OEM partner lane: account executives and CSMs at channel first technology vendors. The pass label is the vendor itself. Built Oct 12 2026.
  insight_oem: { category: { type: 'choice', instructions: 'We partner with technology vendors that sell through resellers and channel partners. Which best describes this company, based on its website?', criteria: {
    technology_vendor_with_channel: 'A hardware, software, networking, security, storage, data, collaboration or cloud vendor that makes its own technology products and sells them through resellers, distributors or channel partners, such as Cisco, Fortinet, Okta, Palo Alto Networks, HP, Dell, Lenovo, Microsoft, Veeam, CrowdStrike, Zscaler, NetApp or a SaaS vendor with a partner program.',
    reseller_msp_or_distributor: 'Value added reseller, managed service provider, systems integrator or distributor that sells or services other vendors technology rather than making its own.',
    end_customer_company: 'An operating company in any industry that buys and uses technology rather than making it: a bank, hospital, manufacturer, law firm, retailer, school and the like.',
    it_staffing_consulting_or_agency: 'IT staffing, recruiting, consulting, marketing agency or professional services firm.',
    other_not_a_vendor: 'Anything else: a personal site, a blog, a parked domain, or a business that makes no technology product.' } } },
  // PowerGRYD / PowerPSA (Jesse Miller): vCISO coaching and a security practice system sold to MSP owners. MSP owner lane is 20 to 100 headcount from list data. Built Oct 12 2026.
  powergryd: { category: { type: 'choice', instructions: 'We sell a program that helps managed service providers build and sell a cybersecurity and vCISO practice to their small business clients. Which best describes this company, based on its website?', criteria: {
    managed_service_provider: 'An IT managed service provider, IT support company, IT consultancy or managed security provider that runs IT or security for small and midsize business clients on a recurring basis. Includes MSPs that already offer cybersecurity or vCISO services.',
    msp_vendor_or_software: 'A company that sells software, tools, peer groups, coaching, marketing or lead generation to MSPs rather than serving end clients, such as RMM, PSA, backup or security product vendors and MSP coaches.',
    enterprise_consultancy_or_integrator: 'A large systems integrator, Big Four or national consultancy, or a security firm serving enterprises and government rather than small business clients.',
    telecom_cabling_or_hardware_only: 'Phone systems, cabling, structured wiring, hardware sales, copier or printer dealer, or break fix shop with no managed services.',
    it_staffing_or_recruiting: 'Staffing, recruiting or placement firm, including IT staffing.',
    operating_company_not_it_provider: 'A business in some other industry that uses IT rather than providing it, or an internal IT department.',
    solo_or_too_thin: 'A one person shop, a personal site, or a site too thin to tell what the company does.' } } },
  // PowerGRYD vCISO lane: individuals and boutique practices that identify as vCISO or fractional CISO. Built Oct 12 2026.
  powergryd_vciso: { category: { type: 'choice', instructions: 'We sell a program and community for independent vCISOs and fractional security leaders who want to grow a security practice. Which best describes this company or person, based on its website?', criteria: {
    vciso_or_fractional_security_practice: 'An individual or boutique firm offering virtual CISO, fractional CISO, security leadership, security advisory, compliance readiness (SOC 2, CMMC, HIPAA, PCI) or governance, risk and compliance consulting as its main service.',
    managed_service_provider: 'An IT managed service provider or IT support company whose main business is running IT for clients, even if it mentions security.',
    security_product_vendor: 'A company whose product is security software, hardware or a platform it sells to others.',
    large_consultancy_or_audit_firm: 'A Big Four, national accounting or audit firm, large consultancy, or an enterprise focused security services firm with many offices.',
    operating_company_not_security: 'A business in some other industry, or an internal security or IT department.',
    personal_site_or_too_thin: 'A personal profile, resume site, blog, parked domain, or a site too thin to tell.' } } },
  // Roofs by Peterson (Kyle Peterson): DFW commercial roofer. Buyers are whoever decides on a commercial roof. Geography from list data. Built Oct 12 2026.
  peterson: { category: { type: 'choice', instructions: 'We are a commercial roofing contractor. Which best describes this organization, based on its website?', criteria: {
    commercial_property_decision_maker: 'An organization that owns, manages, develops, leases or builds commercial, industrial, multifamily, church or institutional buildings and would decide on roof replacement or repair: general contractors and construction managers, property management companies, commercial landlords and investors, developers, churches and ministries, nonprofits with their own campus, hospitals and clinics, hotels, private schools, and businesses that own their own building.',
    roofing_contractor: 'A roofing, waterproofing or roof coating contractor: a competitor, not a buyer.',
    other_trade_contractor: 'A trade subcontractor in another trade such as HVAC, plumbing, electrical, concrete, paving or landscaping.',
    supplier_manufacturer_or_rental: 'Sells, supplies, distributes, manufactures or rents building products or equipment.',
    residential_real_estate_or_homeowner: 'Residential real estate agent or brokerage, home builder, single family home services, or a business run from a home.',
    government_or_public_school: 'Federal, state or local government, public school district, or other public sector body.',
    no_physical_property: 'Online only, software, staffing, consulting or a remote service with no building of its own.' } } },
  // Cornerstone Earthworks (Kyle Peterson): DFW excavation and site work. Buyers own land or develop property. Geography from list data. Built Oct 12 2026.
  earthworks: { category: { type: 'choice', instructions: 'We are an excavation, grading and site work contractor. Which best describes this organization, based on its website?', criteria: {
    property_owner_or_developer: 'An organization that owns land or develops, builds or expands property and would hire site work: general contractors and construction managers, developers, home and commercial builders, churches and ministries, nonprofits with a campus, private schools, property management companies, commercial landlords, hospitals, and businesses planning or owning their own facility.',
    excavation_or_sitework_contractor: 'An excavation, grading, demolition, utility, paving or site work contractor: a competitor, not a buyer.',
    other_trade_contractor: 'A trade subcontractor in another trade such as roofing, HVAC, plumbing, electrical or landscaping maintenance.',
    supplier_manufacturer_or_rental: 'Sells, supplies, distributes, manufactures or rents materials or equipment, including aggregate and equipment dealers.',
    residential_real_estate_or_homeowner: 'Residential real estate agent or brokerage, or a business run from a home.',
    government_or_public_school: 'Federal, state or local government, public school district, or other public sector body.',
    no_physical_property: 'Online only, software, staffing, consulting or a remote service with no land or building of its own.' } } },
  // itbuyer v2 (Oct 12 2026): v1 read fintech, lender, payments and investment firms as software vendors (78% on Parlay). Finance and media companies are buyers.
  itbuyer2: { category: { type: 'choice', instructions: 'We sell managed IT services and IT support to companies that have their own staff and an internal IT decision maker. Which best describes this organization, based on its website? A bank, lender, insurer, payments company, investment firm, media company or agency is an operating business even if it sells through an app or platform; only call it a technology vendor when building and selling software or hardware is the main product.', criteria: {
    operating_business_with_internal_it: 'A company or organization that runs its own operations with office or facility staff and would employ or outsource IT: financial services, lending, insurance, payments, investment banking, accounting, law, architecture, engineering, healthcare, manufacturing, distribution, construction, media, agencies, nonprofits, schools, local government and any other business that uses computers to run itself. Industry does not matter.',
    msp_or_it_services_provider: 'Managed service provider, IT support, IT consulting, cybersecurity services, cloud services or systems integrator: a competitor, not a buyer.',
    software_or_technology_vendor: 'A company whose main product is software, SaaS, hardware, telecom or a technology platform that it builds and sells to others.',
    it_staffing_or_recruiting: 'Staffing, recruiting or placement firm, including IT staffing.',
    national_chain_or_public_corporation: 'Location of a national chain, franchise, or large public corporation whose IT is run by a corporate IT department.',
    solo_or_home_based: 'A one person business, freelancer, independent agent, or home based operation with no staff to support.' } } },
  // insight v2 (Oct 12 2026): v1 dumped real companies (Scrub Daddy, Loloi, a roofer, a collections agency) into other_not_a_company and stretched the reseller label to any services firm (80%).
  insight2: { category: { type: 'choice', instructions: 'We are a technology reseller and solutions provider selling hardware, software licensing, Microsoft 365, cloud and IT services to companies with an internal IT department. Which best describes this organization, based on its website? Any real business that is not itself in the IT business is a buyer: manufacturers, consumer brands, contractors, services firms, healthcare, finance, nonprofits all pass. The reseller and vendor labels are only for companies whose own business is selling, servicing or making computer, software, networking or cloud technology.', criteria: {
    company_with_internal_it_department: 'A private company, nonprofit or healthcare organization that runs its own business and has, or would have, an internal IT department buying hardware, software licenses, cloud and IT services. Any industry, any size, including consumer products, manufacturing, construction, logistics, consulting and professional services, as long as it is not government or public education and not itself an IT company.',
    var_msp_or_it_reseller: 'A company whose own business is reselling, implementing, supporting or managing computer, software, networking or cloud technology for other companies: value added reseller, managed service provider, IT consultancy, systems integrator, IT staffing or technology distributor. A competitor, not a buyer.',
    technology_vendor_or_oem: 'A company whose own product is computer hardware, software, SaaS, networking, security or cloud technology, such as Microsoft, Cisco, Fortinet, Okta, Dell or a software company. Not a manufacturer of non IT equipment.',
    government_or_public_education: 'Federal, state or local government agency, public school district, public charter school, public college or university, or other public sector body.',
    solo_or_home_based: 'A one person business, freelancer, independent agent, or home based operation with no IT department to speak of.',
    not_an_organization: 'Not an organization at all: a personal site, blog, or parked domain.' } } },
  // Bolder Cyber Partners operating company lanes (healthcare exec, logistics exec, IT DM): vCISO and security leadership sold to the company itself. Built Oct 12 2026.
  bcp_ops: { category: { type: 'choice', instructions: 'We sell vCISO and cybersecurity leadership services to healthcare organizations and to logistics and transportation companies. Which best describes this organization, based on its website?', criteria: {
    healthcare_or_logistics_operating_company: 'A healthcare organization (hospital, health system, physician or dental group, clinic network, senior living, behavioral health, home health, lab, pharmacy, health plan, medical device or pharma company) or a logistics, trucking, freight, 3PL, warehousing, distribution, shipping or supply chain company that runs its own operations.',
    other_industry_operating_company: 'An operating business in some other industry: manufacturing, finance, retail, construction, professional services, education, nonprofit and so on.',
    it_or_security_services_provider: 'Managed service provider, IT consultancy, cybersecurity services firm, vCISO practice or systems integrator: a competitor, not a buyer.',
    software_or_technology_vendor: 'A company whose main product is software, SaaS, hardware or a technology platform it sells to others.',
    staffing_or_recruiting: 'Staffing, recruiting or placement firm.',
    government_or_public_body: 'Federal, state or local government, public school or university, or other public sector body.',
    solo_or_too_thin: 'A one person business, a personal site, or a site too thin to tell what the organization does.' } } },
  // SalesGlider staffing lane: staffing and recruiting agency owners who buy done for you outbound. Built Oct 12 2026.
  sg_staffing: { category: { type: 'choice', instructions: 'We sell done for you cold outbound to staffing and recruiting agencies. Which best describes this company, based on its website?', criteria: {
    staffing_or_recruiting_firm: 'A staffing agency, recruiting or executive search firm, temp or contract labor provider, RPO, or a consultancy whose main business is placing people with client companies, in any specialty (IT, healthcare, industrial, finance, legal, engineering).',
    hr_or_payroll_software_vendor: 'A company whose product is HR, payroll, applicant tracking, PEO or workforce software or a job board platform.',
    peo_or_hr_outsourcing: 'A PEO, employer of record, HR outsourcing or payroll service company that does not place people.',
    marketing_or_lead_gen_agency: 'A marketing, lead generation, outbound or sales agency: a competitor, not a buyer.',
    operating_company_not_staffing: 'A business in some other industry that hires for itself rather than placing people for clients.',
    solo_or_too_thin: 'A one person recruiter with no firm behind them, a personal site, or a site too thin to tell.' } } },
  // SalesGlider financial advisor lane. Built Oct 12 2026.
  sg_fa: { category: { type: 'choice', instructions: 'We sell done for you cold outbound to independent financial advisory firms. Which best describes this company, based on its website?', criteria: {
    independent_financial_advisory_firm: 'An independent registered investment advisor, wealth management firm, financial planning practice or insurance and retirement planning agency that serves clients directly.',
    bank_broker_dealer_or_large_institution: 'A bank, credit union, national broker dealer, insurance carrier, asset manager, fund or other large financial institution.',
    fintech_or_software_vendor: 'A company whose product is financial software, a trading or investing app, or a technology platform.',
    accounting_tax_or_law_firm: 'A CPA, bookkeeping, tax or law firm whose main business is not investment advice.',
    marketing_or_lead_gen_agency: 'A marketing, lead generation, outbound or sales agency: a competitor, not a buyer.',
    other_or_too_thin: 'Anything else, or a site too thin to tell.' } } },
};
async function vault(name: string) { const [r] = await sql`select decrypted_secret s from vault.decrypted_secrets where name = ${name}`; return r?.s as string; }
async function gemini(key: string, model: string, dom: string, txt: string) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: PROMPT(txt, dom) }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { fit: { type: 'STRING', enum: ['yes', 'no'] }, confidence: { type: 'NUMBER' }, reason: { type: 'STRING' } }, required: ['fit', 'confidence', 'reason'] } } }) });
  const j: any = await r.json();
  if (!r.ok) throw new Error(`gemini ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  const t = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '{}';
  const o = JSON.parse(t);
  return { fit: o.fit, prob: o.fit === 'yes' ? Number(o.confidence) : 1 - Number(o.confidence), reason: String(o.reason ?? '').slice(0, 300), in_tok: j.usageMetadata?.promptTokenCount ?? null, out_tok: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0), cost: null, answers: null };
}
async function jev(key: string, model: string, variant: string, dom: string, txt: string) {
  const body = { model, state: { domain: dom, website_text: txt }, questions: JEV_Q[variant] };
  for (const w of [0, 3000, 10000]) {
    if (w) await new Promise(x => setTimeout(x, w));
    const r = await fetch('https://openrouter.ai/api/alpha/decisions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j: any = await r.json().catch(() => ({}));
    if (r.status === 429 || r.status >= 500) continue;
    if (!r.ok) throw new Error(`jev ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const a = j.answers ?? {};
    let p: number | null = null; let fit: string | null = null;
    if (variant === 'single') { p = Number(a.icp_fit?.noul); fit = p >= 0.5 ? 'yes' : 'no'; }
    if (PASS[variant]) { p = Number(a.category?.probabilities?.[PASS[variant]] ?? 0); fit = a.category?.choice === PASS[variant] ? 'yes' : 'no'; }
    if (variant === 'decomp') { const g = (k: string) => Number(a[k]?.noul ?? 0); p = g('does_trade_work') * g('commercial_work') * (1 - g('supplier_or_maker')) * (1 - g('consultant')) * (1 - g('general_contractor')) * (1 - g('residential_only')) * (1 - g('franchise_or_chain')) * g('us_company'); fit = p >= 0.25 ? 'yes' : 'no'; }
    return { fit, prob: p, reason: a.category?.choice ?? null, in_tok: j.usage?.input_tokens ?? null, out_tok: j.usage?.output_tokens ?? null, cost: j.usage?.cost ?? null, answers: a };
  }
  throw new Error('jev retries exhausted');
}
Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (!KEY) return ok({ error: 'ICP_LLM_HTTP_KEY missing' }, 500);
  if (u.searchParams.get('k') !== KEY) return new Response('forbidden', { status: 403 });
  const mode = u.searchParams.get('mode');
  try {
    if (mode === 'models') {
      const gk = await vault('gemini_api_key');
      const j: any = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gk}&pageSize=200`)).json();
      return ok({ gemini: (j.models ?? []).map((m: any) => m.name).filter((n: string) => /flash|pro/i.test(n)), err: j.error?.message });
    }
    if (mode === 'run') {
      const spec = u.searchParams.get('model')!; const prov = spec.split(':')[0]; const rest = spec.slice(spec.indexOf(':') + 1);
      const [name, variant] = rest.includes('|') ? rest.split('|') : [rest, 'single'];
      if (prov === 'jev' && !JEV_Q[variant]) return ok({ error: 'unknown variant' }, 400);
      const batch = u.searchParams.get('batch') ?? 'cayden200'; const n = Number(u.searchParams.get('n') ?? 60);
      const t0 = Date.now();
      const key = await vault(prov === 'jev' ? 'openrouter_api_key' : 'gemini_api_key');
      const tag = u.searchParams.get('tag');
      // src=gate&tag=<tag>: grade every domain in topup.gate_domains for that tag that we have readable text for, whatever batch fetched it.
      const MAX_COPIES = 5;
      const LOCK_BASE = 111000111;
      const slotConn = postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false, idle_timeout: 0 });
      let slot = 0;
      try {
        for (let i = 1; i <= MAX_COPIES; i++) {
          const [got] = await slotConn`select pg_try_advisory_lock(${LOCK_BASE + i}) as ok`;
          if (got?.ok) { slot = i; break; }
        }
        if (!slot) return ok({ error: 'icp-llm concurrency cap is 5' }, 429);
        const rows = tag
          ? await sql`
              with claim as (
                select t.domain, t.body
                  from topup.gate_domains g
                  join client_salesglider.icp_site_text t on t.domain = g.dom
                 where g.tag = ${tag}
                   and t.http_status between 200 and 399
                   and coalesce(t.chars, 0) > 300
                   and not exists (
                     select 1 from client_salesglider.icp_llm_results r
                      where r.domain = t.domain and r.model = ${spec} and r.error is null
                   )
                   and not exists (
                     select 1 from client_salesglider.icp_llm_results r
                      where r.domain = t.domain and r.model = ${spec}
                        and r.error = 'in_progress'
                        and r.created_at > now() - interval '10 minutes'
                   )
                 order by t.domain
                 limit ${n}
                 for update of t skip locked
              ), ins as (
                insert into client_salesglider.icp_llm_results (domain, batch, model, error, created_at)
                select domain, ${batch}, ${spec}, 'in_progress', now() from claim
                on conflict (domain, model) do update
                  set error = 'in_progress', created_at = now(), batch = excluded.batch
                  where client_salesglider.icp_llm_results.error is not null
                returning domain
              )
              select c.domain, c.body from claim c join ins i using (domain)`
          : await sql`
              with claim as (
                select t.domain, t.body
                  from client_salesglider.icp_site_text t
                 where t.batch = ${batch}
                   and t.http_status between 200 and 399
                   and coalesce(t.chars, 0) > 300
                   and not exists (
                     select 1 from client_salesglider.icp_llm_results r
                      where r.domain = t.domain and r.model = ${spec} and r.error is null
                   )
                   and not exists (
                     select 1 from client_salesglider.icp_llm_results r
                      where r.domain = t.domain and r.model = ${spec}
                        and r.error = 'in_progress'
                        and r.created_at > now() - interval '10 minutes'
                   )
                 order by t.domain
                 limit ${n}
                 for update of t skip locked
              ), ins as (
                insert into client_salesglider.icp_llm_results (domain, batch, model, error, created_at)
                select domain, ${batch}, ${spec}, 'in_progress', now() from claim
                on conflict (domain, model) do update
                  set error = 'in_progress', created_at = now(), batch = excluded.batch
                  where client_salesglider.icp_llm_results.error is not null
                returning domain
              )
              select c.domain, c.body from claim c join ins i using (domain)`;
        const q = [...rows]; let done = 0, errs = 0, lastErr: string | null = null;
        async function worker() { while (q.length && Date.now() - t0 < 125000) { const r: any = q.shift(); let x: any; try { x = prov === 'jev' ? await jev(key, name, variant, r.domain, r.body) : await gemini(key, name, r.domain, r.body); x.error = null; } catch (e) { errs++; lastErr = String(e).slice(0, 250); x = { fit: null, prob: null, reason: null, in_tok: null, out_tok: null, cost: null, answers: null, error: lastErr }; }
          done++;
          await sql`insert into client_salesglider.icp_llm_results (domain, batch, model, fit, prob, reason, in_tok, out_tok, cost, error, answers) values (${r.domain}, ${batch}, ${spec}, ${x.fit}, ${x.prob}, ${x.reason}, ${x.in_tok}, ${x.out_tok}, ${x.cost}, ${x.error}, ${x.answers ? sql.json(x.answers) : null}) on conflict (domain, model) do update set fit = excluded.fit, prob = excluded.prob, reason = excluded.reason, in_tok = excluded.in_tok, out_tok = excluded.out_tok, cost = excluded.cost, error = excluded.error, answers = excluded.answers, created_at = now()`; } }
        await Promise.all(Array.from({ length: Number(u.searchParams.get('w') ?? 8) }, worker));
        if (q.length) {
          await sql`update client_salesglider.icp_llm_results
                       set error = 'released'
                     where domain = any(${q.map((r: any) => r.domain)})
                       and model = ${spec}
                       and error = 'in_progress'`;
        }
        const [left] = tag
          ? await sql`select count(*)::int c
                        from topup.gate_domains g
                        join client_salesglider.icp_site_text t on t.domain = g.dom
                       where g.tag = ${tag}
                         and t.http_status between 200 and 399
                         and coalesce(t.chars, 0) > 300
                         and not exists (select 1 from client_salesglider.icp_llm_results r
                                          where r.domain = t.domain and r.model = ${spec} and r.error is null)
                         and not exists (select 1 from client_salesglider.icp_llm_results r
                                          where r.domain = t.domain and r.model = ${spec}
                                            and r.error = 'in_progress'
                                            and r.created_at > now() - interval '10 minutes')`
          : await sql`select count(*)::int c
                        from client_salesglider.icp_site_text t
                       where t.batch = ${batch}
                         and t.http_status between 200 and 399
                         and coalesce(t.chars, 0) > 300
                         and not exists (select 1 from client_salesglider.icp_llm_results r
                                          where r.domain = t.domain and r.model = ${spec} and r.error is null)
                         and not exists (select 1 from client_salesglider.icp_llm_results r
                                          where r.domain = t.domain and r.model = ${spec}
                                            and r.error = 'in_progress'
                                            and r.created_at > now() - interval '10 minutes')`;
        return ok({ model: spec, processed: done, errors: errs, last_error: lastErr, remaining: left.c });
      } finally {
        await slotConn.end({ timeout: 2 }).catch(() => {});
      }
    }
    return ok({ error: 'unknown mode' }, 400);
  } catch (e) { return ok({ ok: false, error: String(e).slice(0, 300) }, 500); }
});
