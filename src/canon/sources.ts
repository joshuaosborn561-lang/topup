/**
 * The source vocabulary (D52). Every value a receipt can carry on its four
 * legs, with one line each: what it means, how Grok repeats it, and what it
 * costs. Grok reads a campaign's record, sees where most of the leads came
 * from, and repeats that. A value with no line here is reported as unknown;
 * Josh writes the line, nobody guesses.
 */
export type SourceLeg = "company" | "domain" | "person" | "email";

export interface SourceLine {
  leg: SourceLeg;
  value: string;
  means: string;
  repeat_with: string;
  cost: string;
}

export const SOURCE_LINES: readonly SourceLine[] = [
  // company legs: where the company set came from
  { leg: "company", value: "getleads", means: "getleads people search on job titles (or job function plus seniority), company size bands, countries, states or cities, and industries. The exact filters are in company_filters.", repeat_with: 'count(source="getleads", filters) for the TAM, then pull(source="getleads", filters, max_rows).', cost: "Counts are free. Exports are on the plan; verify and emails are paid later steps." },
  { leg: "company", value: "ai_ark", means: "AI Ark people search for LinkedIn-native ICPs, used as a second count or as the source when getleads under-delivered.", repeat_with: 'count(source="ai_ark", filters) for the TAM; people come through the Email Finder Waterfall MCP (AI Ark tier) or the AI Ark connector, server side.', cost: "About five cents per preview count; enrichment is per row." },
  { leg: "company", value: "maps", means: "Google Maps Scraper businesses stored in client_<tag>.maps_raw, scoped by the receipt's plan_id and categories. An ICP view named on the receipt (icp_filter / icp_view) is applied when present.", repeat_with: 'count(source="maps", filters={plan_id, categories, icp_filter}) then pull(source="maps", filters={plan_id, categories, icp_filter}). Never drop plan_id. A fresh scrape is the Google Maps Scraper MCP.', cost: "The stored pool is free. A new scrape is Maps requests per zip and category; the plan says the dollars before the run." },
  { leg: "company", value: "permits", means: "PermitStack contractors from permits by permit type and geography.", repeat_with: 'pull(source="permits", filters={permit_types, states}) reads the stored pool; a fresh pull is the PermitStack MCP (permitstack_pull_calling_list).', cost: "One request per page of a hundred; hydration is paced." },
  { leg: "company", value: "maps_and_permits", means: "Maps businesses joined to permit contractors by domain; both stored pools.", repeat_with: "The maps and permits lines above, then the join in Supabase.", cost: "As maps plus permits." },
  { leg: "company", value: "serp_tool_mention", means: "Google-indexed pages that mention a tool or a role (skill serp-dm-discovery).", repeat_with: "The serp-dm-discovery skill: SERP queries into a Supabase table, then the people and email waterfalls.", cost: "Per SERP query." },
  { leg: "company", value: "theirstack_tech_signal", means: "Companies with a technology or job-posting signal from TheirStack.", repeat_with: "The TheirStack pull into a table, then pull(source=\"table\").", cost: "Per TheirStack credit." },
  { leg: "company", value: "job_posting_signal", means: "Companies hiring for a role, from a job-posting feed.", repeat_with: "The same feed into a table, then pull(source=\"table\").", cost: "Per feed credit." },
  { leg: "company", value: "linkedin_engagers", means: "People who engaged with monitored LinkedIn posts (getleads profile monitoring).", repeat_with: "getleads profile monitoring, server side, into the client's engagers table; never list_profile_monitoring_leads in chat.", cost: "Wallet cash per monitored profile." },
  { leg: "company", value: "linkedin_import", means: "A hand-imported list of LinkedIn profiles.", repeat_with: "Not repeatable from the service. A new list from Josh.", cost: "None here." },
  { leg: "company", value: "web_visitor_pixel", means: "Website visitors identified by the getleads pixel.", repeat_with: "The pixel keeps writing; export server side into the client's table, never export_website_visitor_leads in chat.", cost: "Wallet cash per identified visitor." },
  { leg: "company", value: "table", means: "A hand-filled Supabase table named in company_filters (schema, table, where).", repeat_with: 'pull(source="table", filters={schema, table, where}).', cost: "None." },
  // domain legs
  { leg: "domain", value: "already", means: "The source row carried the domain.", repeat_with: "Nothing to repeat.", cost: "None." },
  { leg: "domain", value: "domain_waterfall", means: "Company name plus location resolved to a domain by the Domain Finder Waterfall MCP.", repeat_with: "enrich(job_id) runs it on rows without a domain; or resolve_domain on a source table.", cost: "Free tiers first; paid tiers per row." },
  { leg: "domain", value: "site_scrape", means: "The domain found by scraping the business website.", repeat_with: "The Google Maps Scraper enrich_sites step, server side.", cost: "Per site fetched." },
  // person legs
  { leg: "person", value: "getleads", means: "The decision maker came with the getleads row.", repeat_with: "The getleads pull.", cost: "On the plan." },
  { leg: "person", value: "people_waterfall", means: "Named people found per company by the Find Named Person MCP (site_staff, cache, DiscoLike, prospeo_search, aiark_people).", repeat_with: "enrich(job_id) runs it on companies without a person; or resolve_people on a source table.", cost: "Free tiers first; Prospeo search then AI Ark people on what is left." },
  { leg: "person", value: "site_staff", means: "Names read off the company's own staff or team page.", repeat_with: "The people waterfall's site_staff tier.", cost: "None." },
  { leg: "person", value: "serp", means: "Names found through Google-indexed pages.", repeat_with: "The serp-dm-discovery skill.", cost: "Per query." },
  { leg: "person", value: "leadmagic_employee_finder", means: "Legacy (D58). Josh dropped LeadMagic on 2026-10-08. A stored receipt with this person source is not rewritten; replay it as people_waterfall with the live Find Named Person default order.", repeat_with: "enrich(job_id). Do not call LeadMagic. Do not write this name on a new receipt.", cost: "None here; the replay spends on DiscoLike / Prospeo / AI Ark as the people service quotes." },
  // email legs
  { leg: "email", value: "getleads", means: "The address came with the getleads row.", repeat_with: "The getleads pull, then verify(job_id).", cost: "On the plan." },
  { leg: "email", value: "email_waterfall", means: "The Email Finder Waterfall MCP: getleads, Smartlead, AI Ark, Prospeo, FullEnrich, in that order, up to email_max_tier. A stored email_max_tier of leadmagic is a legacy ceiling and maps to aiark (D58).", repeat_with: "enrich(job_id) runs it on rows without an address. Pass email_max_tier from the record; leadmagic becomes aiark.", cost: "Per row found at the paid tiers; the default ceiling is AI Ark (stop before Prospeo)." },
  { leg: "email", value: "name_to_email", means: "A name plus a domain turned into an address by the name-to-email service.", repeat_with: "enrich(job_id) with the name_to_email tier.", cost: "Per row." },
  { leg: "email", value: "site_scrape", means: "An address found on the company website.", repeat_with: "The Google Maps Scraper enrich_sites step.", cost: "Per site fetched." },
  { leg: "email", value: "already", means: "The source row carried the address.", repeat_with: "Nothing to repeat.", cost: "None." },
];

export function sourceLine(leg: SourceLeg, value: string | null | undefined): SourceLine | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return SOURCE_LINES.find((l) => l.leg === leg && l.value === v) ?? null;
}

/** The lines for the values seen on a record, and the values nobody has written a line for. */
export function describeSources(seen: Partial<Record<SourceLeg, readonly (string | null | undefined)[]>>): { lines: SourceLine[]; unknown: Array<{ leg: SourceLeg; value: string }> } {
  const lines: SourceLine[] = [];
  const unknown: Array<{ leg: SourceLeg; value: string }> = [];
  for (const leg of ["company", "domain", "person", "email"] as const) {
    for (const raw of new Set((seen[leg] ?? []).filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().toLowerCase()))) {
      const line = sourceLine(leg, raw);
      if (line) lines.push(line);
      else unknown.push({ leg, value: raw });
    }
  }
  return { lines, unknown };
}
