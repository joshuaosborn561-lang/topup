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

/** STOPPED. They stay out of BCP routing. */
export const BCP_STOPPED_CAMPAIGNS = [3763797, 3763798] as const;

/** Confirmed CEO-copy campaign ids. Empty until Smartlead says which ones. */
export const BCP_CEO_CAMPAIGNS: readonly number[] = [];

export function bcpCampaignIsCeo(campaignId: number): boolean {
  return BCP_CEO_CAMPAIGNS.includes(campaignId);
}

export function bcpCountTitles(ceo: boolean): string[] {
  return ceo ? [...BCP_CEO_TITLES] : [...BCP_SENIOR_IT_TITLES, ...BCP_COO_TITLES];
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
  const routing = recipe.routing
    .filter((rule) => !(BCP_STOPPED_CAMPAIGNS as readonly number[]).includes(rule.campaign_id))
    .map((rule) => {
      const ceo = bcpCampaignIsCeo(rule.campaign_id);
      return {
        ...rule,
        icp: { ...rule.icp, persona: ceo ? "ceo" : "senior_it" },
        source: rule.source ? shapeSource(rule.source, ceo) : undefined,
      };
    });
  return { ...recipe, source: shapeSource(recipe.source, false), routing };
}
