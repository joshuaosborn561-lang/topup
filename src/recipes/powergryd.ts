import type { Recipe } from "./schema.js";

/** Josh's staff rule is 20 to 100. getleads only offers bands, so the count uses 11 to 200. */
export const MSP_OWNER_BANDS = ["11 to 50", "51 to 200"] as const;

export const MSP_OWNER_TITLES = ["Owner", "Co-Owner", "Founder", "Co-Founder", "President", "CEO"] as const;

export const MSP_LINKEDIN_HEADCOUNT = { min: 20, max: 100 } as const;

/**
 * Any of these may be sent to getleads. The pilot scores the tighter set:
 * a row has to read as an MSP, not merely as IT support or a help desk.
 */
export const MSP_DESCRIPTION_PHRASES = [
  "managed service provider",
  "managed services provider",
  "MSP",
  "managed IT",
  "managed IT services",
  "managed services",
  "IT support",
  "outsourced IT",
  "IT managed services",
  "managed security services",
  "MSSP",
  "help desk",
  "co-managed IT",
] as const;

/** Phrases that mean the company is an MSP. IT support and help desk are not enough. */
export const MSP_REAL_PHRASES = [
  "managed service provider",
  "managed services provider",
  "MSP",
  "managed IT",
  "managed IT services",
  "managed services",
  "IT managed services",
  "managed security services",
  "MSSP",
  "co-managed IT",
] as const;

export function mspDescriptionQuery(): string {
  return MSP_DESCRIPTION_PHRASES.join(", ");
}

export const MSP_HEADCOUNT_COLUMNS = ["employee_profiles_on_linkedin", "linkedin_employees", "employees_on_linkedin"] as const;

/**
 * Keep a row when the LinkedIn profile count is missing. Drop it when the
 * field is present and outside 20 to 100. This is not a count filter.
 */
export function linkedinHeadcountKeeps(value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return true;
  return value >= MSP_LINKEDIN_HEADCOUNT.min && value <= MSP_LINKEDIN_HEADCOUNT.max;
}

export function linkedinHeadcountColumn(columns: ReadonlySet<string>): string | null {
  return MSP_HEADCOUNT_COLUMNS.find((column) => columns.has(column)) ?? null;
}

/** MSP owners are a different sale from Culture Fits. Do not suppress against that client. */
export function sameOfferExcludedClients(recipe: { client_tag: string; lane: string }): string[] {
  if (recipe.client_tag === "powergryd" && recipe.lane === "msp_owners") return ["culture_fits"];
  return [];
}

/** The Sept 22 MSP owner build. Replaces a mixed source that sized near 1M. */
export function shapeMspOwnersRecipe(recipe: Recipe): Recipe {
  if (recipe.client_tag !== "powergryd" || recipe.lane !== "msp_owners") return recipe;
  return {
    ...recipe,
    source: {
      kind: "getleads",
      widening_candidates: [],
      params: {
        job_titles: [...MSP_OWNER_TITLES],
        company_size: [...MSP_OWNER_BANDS],
        countries: ["United States"],
        industries: ["IT Services and IT Consulting"],
        company_description: mspDescriptionQuery(),
        email_status: ["VALID"],
        max_per_company: 2,
      },
    },
    email_finding: {
      ...recipe.email_finding,
      enabled: true,
      max_tier: "prospeo",
      fullenrich: false,
    },
    routing: recipe.routing.map((rule) => ({ ...rule, source: undefined, icp: { ...rule.icp, persona: "owner" } })),
  };
}
