import type { Recipe, Source } from "./schema.js";

/**
 * BCP copy is written for a senior IT leader. CEO rows go only to a campaign
 * flagged ceo. That list is empty until Smartlead confirms which campaigns
 * use the CEO copy. Do not guess it.
 */
export const BCP_SENIOR_IT_TITLES = [
  "CIO",
  "Chief Information Officer",
  "CTO",
  "CISO",
  "Chief Information Security Officer",
  "VP of IT",
  "Director of IT",
  "Director of Information Technology",
  "Head of IT",
  "Director of Information Security",
  "IT Director",
] as const;

export const BCP_COO_TITLES = ["COO", "Chief Operating Officer"] as const;

export const BCP_CEO_TITLES = ["CEO", "Chief Executive Officer"] as const;

/** CFO, President, Owner, and PE titles never belong on a BCP pull. */
export const BCP_DROPPED_TITLES = [
  "CFO",
  "Chief Financial Officer",
  "President",
  "Owner",
  "Co-Owner",
  "Partner",
  "Managing Partner",
  "Managing Director",
  "Principal",
  "Founder",
  "Co-Founder",
] as const;

export const BCP_BANDS = ["51 to 200", "201 to 500", "501 to 1000"] as const;

/**
 * Sept 3 receipts (getleads_bcp_healthcare_itdm_20260903,
 * getleads_bcp_it_layer2_20260903, getleads_bcp_logistics_itdm_20260903).
 * industries_by_campaign on those builds. Not the inferred longer lists.
 */
export const BCP_HEALTHCARE_IT_CAMPAIGNS = [3921850, 3921854] as const;
export const BCP_LOGISTICS_IT_CAMPAIGNS = [3921852, 3921869] as const;

export const BCP_HEALTHCARE_INDUSTRIES = ["Hospitals and Health Care", "Medical Practices"] as const;
export const BCP_LOGISTICS_INDUSTRIES = ["Transportation, Logistics, Supply Chain and Storage", "Truck Transportation"] as const;

export const BCP_HEALTHCARE_DESCRIPTION = ["hospital", "clinic", "health system", "medical group", "home health"] as const;
export const BCP_LOGISTICS_DESCRIPTION = ["3PL", "freight", "trucking", "logistics", "warehousing"] as const;

/** The unfiltered US IT-leader count those three lanes shared before an industry was set. */
export const BCP_UNFILTERED_IT_POOL = 27_790;

export type BcpItVertical = "healthcare" | "logistics";

export function bcpItVertical(lane: string, campaignId: number): BcpItVertical | null {
  if (lane === "healthcare_exec" || lane === "logistics_exec" || lane === "pe_firms") return null;
  if (lane.includes("healthcare") && lane.includes("it")) return "healthcare";
  if (lane.includes("logistics") && lane.includes("it")) return "logistics";
  if ((BCP_HEALTHCARE_IT_CAMPAIGNS as readonly number[]).includes(campaignId)) return "healthcare";
  if ((BCP_LOGISTICS_IT_CAMPAIGNS as readonly number[]).includes(campaignId)) return "logistics";
  return null;
}

export function bcpItIndustries(vertical: BcpItVertical): string[] {
  return vertical === "healthcare" ? [...BCP_HEALTHCARE_INDUSTRIES] : [...BCP_LOGISTICS_INDUSTRIES];
}

export function bcpItDescription(vertical: BcpItVertical): string {
  const phrases = vertical === "healthcare" ? BCP_HEALTHCARE_DESCRIPTION : BCP_LOGISTICS_DESCRIPTION;
  return phrases.join(", ");
}

/** STOPPED. They stay out of BCP routing. */
export const BCP_STOPPED_CAMPAIGNS = [3763797, 3763798] as const;

/** Confirmed CEO-copy campaign ids. Empty until Smartlead says which ones. */
export const BCP_CEO_CAMPAIGNS: readonly number[] = [];

export function bcpCampaignIsCeo(campaignId: number): boolean {
  return BCP_CEO_CAMPAIGNS.includes(campaignId);
}

/** The vendor count and the pilot use senior IT titles. COO is not in this list. */
export function bcpCountTitles(ceo: boolean): string[] {
  return ceo ? [...BCP_CEO_TITLES] : [...BCP_SENIOR_IT_TITLES];
}

export function bcpCooCountTitles(): string[] {
  return [...BCP_COO_TITLES];
}

export interface BcpPoolFilterSet<T extends { industries?: string[]; company_description?: string; job_titles?: string[] }> {
  industry: T;
  description: T;
  both: T;
  coo: T;
}

function withoutKey<T extends object>(filters: T, key: keyof T): T {
  const next = { ...filters };
  delete next[key];
  return next;
}

/**
 * Three company filters on the same titles, plus a COO-only count.
 * The sized TAM is senior IT plus that COO fallback. The Sept 3 receipts
 * sent the industry list and did not send a company description.
 */

/** Senior IT count plus the COO fallback. A missing COO count leaves the IT count. */
export function bcpSizedTam(itCount: number, cooCount: number | null): number {
  const it = Math.max(0, Math.floor(itCount));
  if (cooCount == null || !Number.isFinite(cooCount)) return it;
  return it + Math.max(0, Math.floor(cooCount));
}
export function bcpPoolFilters<T extends { industries?: string[]; company_description?: string; job_titles?: string[] }>(
  filters: T,
  vertical: BcpItVertical,
): BcpPoolFilterSet<T> {
  const industry = withoutKey({ ...filters, industries: bcpItIndustries(vertical) }, "company_description");
  const description = withoutKey({ ...filters, company_description: bcpItDescription(vertical) }, "industries");
  const both = { ...filters, industries: bcpItIndustries(vertical), company_description: bcpItDescription(vertical) };
  const coo = { ...industry, job_titles: bcpCooCountTitles() };
  return { industry, description, both, coo };
}

export function bcpPoolReport(input: {
  industry: number | null;
  description: number | null;
  both: number | null;
  coo: number | null;
  rows_found: number | null;
}): string {
  const n = (value: number | null) => (value == null ? "not counted" : String(value));
  const parts = [
    `Industry-only count ${n(input.industry)}.`,
    `Description-only count ${n(input.description)}.`,
    `Industry and description together ${n(input.both)}.`,
    "The sized TAM is the senior IT count plus the COO fallback, on the industry list from the Sept 3 receipts. Those receipts did not send a company description.",
    `tam_it ${n(input.industry)}. tam_coo ${n(input.coo)}. A COO is counted only as the fallback, and the pull still takes IT titles first.`,
  ];
  const sized = input.industry == null ? null : bcpSizedTam(input.industry, input.coo);
  if (sized != null && sized < 1000) {
    const found = input.rows_found != null ? ` The Sept 3 ingest rows_found was ${input.rows_found}, and that export's titles included IT Manager.` : "";
    parts.push(
      `This TAM is not in the thousands. The count is senior IT titles plus the COO fallback, US, headcount 51 to 1,000, and the industry list, with no description.${found}`,
    );
  }
  return parts.join(" ");
}

function normTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

const SENIOR = new Set(BCP_SENIOR_IT_TITLES.map(normTitle));
const COO = new Set(BCP_COO_TITLES.map(normTitle));
const CEO = new Set(BCP_CEO_TITLES.map(normTitle));
const DROPPED = new Set(BCP_DROPPED_TITLES.map(normTitle));

export function isSeniorItTitle(title: string): boolean {
  return SENIOR.has(normTitle(title));
}

export function isCooTitle(title: string): boolean {
  return COO.has(normTitle(title));
}

export function isCeoTitle(title: string): boolean {
  return CEO.has(normTitle(title));
}

export function isDroppedBcpTitle(title: string): boolean {
  return DROPPED.has(normTitle(title));
}

export interface BcpPerson {
  company: string;
  title: string;
}

/**
 * Per company: keep senior IT leaders and drop the COO when one of them is
 * already in the pull. Keep the COO only when no senior IT leader was found.
 * Drop CFO, President, Owner, and PE titles.
 */
export function keepBcpPeople(people: readonly BcpPerson[]): BcpPerson[] {
  const byCompany = new Map<string, BcpPerson[]>();
  for (const person of people) {
    if (isDroppedBcpTitle(person.title) || isCeoTitle(person.title)) continue;
    if (!isSeniorItTitle(person.title) && !isCooTitle(person.title)) continue;
    const key = person.company.trim().toLowerCase();
    const list = byCompany.get(key) ?? [];
    list.push(person);
    byCompany.set(key, list);
  }
  const out: BcpPerson[] = [];
  for (const list of byCompany.values()) {
    const seniors = list.filter((person) => isSeniorItTitle(person.title));
    if (seniors.length) out.push(...seniors);
    else out.push(...list.filter((person) => isCooTitle(person.title)));
  }
  return out;
}

export interface BcpRoute {
  company: string;
  title: string;
  campaign_id: number;
}

/**
 * CEO rows go only to campaigns flagged ceo. Senior IT and the COO fallback
 * go only to IT-copy campaigns. A CEO with no CEO-copy campaign is not routed.
 */
export function routeBcpPeople(people: readonly BcpPerson[], campaigns: readonly { campaign_id: number; ceo: boolean }[]): BcpRoute[] {
  const kept = keepBcpPeople(people);
  const ceos = people.filter((person) => isCeoTitle(person.title) && !isDroppedBcpTitle(person.title));
  const itCampaigns = campaigns.filter((campaign) => !campaign.ceo);
  const ceoCampaigns = campaigns.filter((campaign) => campaign.ceo);
  const out: BcpRoute[] = [];
  for (const person of kept) {
    for (const campaign of itCampaigns) out.push({ company: person.company, title: person.title, campaign_id: campaign.campaign_id });
  }
  for (const person of ceos) {
    for (const campaign of ceoCampaigns) out.push({ company: person.company, title: person.title, campaign_id: campaign.campaign_id });
  }
  return out;
}

function shapeGetleads(source: Extract<Source, { kind: "getleads" }>, ceo: boolean): Extract<Source, { kind: "getleads" }> {
  return {
    ...source,
    params: {
      ...source.params,
      job_titles: bcpCountTitles(ceo),
      company_size: [...BCP_BANDS],
      max_per_company: 3,
      countries: source.params.countries?.length ? source.params.countries : ["United States"],
    },
  };
}

function shapeSource(source: Source, ceo: boolean): Source {
  if (source.kind === "getleads") return shapeGetleads(source, ceo);
  if (source.kind !== "mixed") return source;
  return {
    ...source,
    parts: source.parts.map((part) => ({
      ...part,
      source: part.source.kind === "getleads" ? shapeGetleads(part.source, ceo) : part.source,
    })),
  };
}

/** Senior IT titles, 51 to 1,000, max 3 per company. pe_firms does not pull. STOPPED ids leave the routing. */
export function shapeBcpRecipe(recipe: Recipe): Recipe {
  if (recipe.client_tag !== "bcp") return recipe;
  if (recipe.lane === "pe_firms") {
    return {
      ...recipe,
      routing: [],
      segments: { ...recipe.segments, slot: [] },
      source: { kind: "mixed", note: "bcp.pe_firms is retired", parts: [] },
    };
  }
  const shapedSource = shapeSource(recipe.source, false);
  const routing = recipe.routing
    .filter((rule) => !(BCP_STOPPED_CAMPAIGNS as readonly number[]).includes(rule.campaign_id))
    .map((rule) => {
      const ceo = bcpCampaignIsCeo(rule.campaign_id);
      const base = rule.source ? shapeSource(rule.source, ceo) : shapedSource;
      const vertical = bcpItVertical(recipe.lane, rule.campaign_id);
      const source = vertical && base.kind === "getleads" ? withItFilter(base, vertical) : rule.source ? base : undefined;
      return {
        ...rule,
        icp: { ...rule.icp, persona: ceo ? "ceo" : "senior_it" },
        source,
      };
    });
  return { ...recipe, source: shapedSource, routing };
}

function withItFilter(source: Extract<Source, { kind: "getleads" }>, vertical: BcpItVertical): Extract<Source, { kind: "getleads" }> {
  const params = { ...source.params, industries: bcpItIndustries(vertical) };
  delete params.company_description;
  return { ...source, params };
}
