/**
 * The connectors Grokbot must have attached before it tops up a campaign
 * (D99). The list comes from the 24 recorded build transcripts: these are
 * the tools Josh's own builds call. The service cannot borrow a Claude
 * connector; the bot brings its own. `connectors(have)` says which are
 * missing and where the custom ones live, so the bot can tell Josh what to
 * connect in Grokbot. Nothing here is per client.
 */
export interface ConnectorSpec {
  /** The name as it appears in a tool list (case-insensitive prefix match). */
  name: string;
  /** Alternate names the same connector shows up under. */
  aliases: string[];
  /** Why the bot needs it. */
  purpose: string;
  /** Every top-up needs it; only when the transcript calls for it; or the service calls it itself, server side, so the bot never needs it. */
  required: "always" | "when the transcript uses it" | "the service calls it";
  /** How to attach it in Grokbot. Custom MCPs carry their HTTPS endpoint from this service's config. */
  how: string;
}

export interface ConnectorUrls {
  leadpipe?: string;
  smartlead?: string;
  emailWaterfall?: string;
  peopleWaterfall?: string;
  domainWaterfall?: string;
  verifier?: string;
  maps?: string;
  permits?: string;
}

const custom = (url: string | undefined, what: string) => (url ? `Custom MCP. Add it in Grokbot as an HTTPS MCP at ${url}.` : `Custom MCP on Railway (${what}); ask Josh for its HTTPS address and add it in Grokbot.`);

export function connectorSpecs(urls: ConnectorUrls = {}): ConnectorSpec[] {
  return [
    { name: "Top_Up", aliases: ["leadtopup", "Top Up"], purpose: "this service: the build record, dedupe, the ICP check, verification, staging and the load", required: "always", how: "Custom MCP. https://leadtopup-production.up.railway.app/mcp, no login." },
    { name: "Supabase", aliases: [], purpose: "SQL on campaignintelligence (azpapwtnrbzywlnxxecz): counts, scratch tables, the pools your transcript built in SQL", required: "always", how: "The Supabase connector, signed in to the campaignintelligence project." },
    { name: "Context_Saver", aliases: ["LeadPipe", "Context Saver"], purpose: "LeadPipe: every row moves through it (lp_plan, lp_run, lp_status, lp_export). Never a lead row in chat", required: "always", how: custom(urls.leadpipe, "LeadPipe") },
    { name: "getleads", aliases: ["GetLeads"], purpose: "count_contacts, export_contacts, check_contact_export: the pull for LinkedIn-native lists", required: "always", how: "Custom connector (OAuth). Add GetLeads in Grokbot and sign in." },
    { name: "Smartlead", aliases: [], purpose: "the import and the post-import check: the service calls it with its own Railway key. Never start, pause, stop or delete a campaign", required: "the service calls it", how: custom(urls.smartlead, "Smartlead") },
    { name: "Email_Verifier_Progression", aliases: ["Email Verifier Progression"], purpose: "MillionVerifier then No2Bounce: the service calls it with its own Railway key after the quote is approved", required: "the service calls it", how: custom(urls.verifier, "Email Verifier Progression") },
    { name: "Email_Finder_Waterfall", aliases: ["Email Finder Waterfall"], purpose: "emails for named people: getleads, Smartlead, AI Ark, Prospeo, FullEnrich in order", required: "when the transcript uses it", how: custom(urls.emailWaterfall, "Email Finder Waterfall") },
    { name: "AI_Ark", aliases: ["AI Ark"], purpose: "people search, email finder, TAM preview", required: "when the transcript uses it", how: "Custom connector. Add AI Ark in Grokbot." },
    { name: "Google_Maps_Scraper", aliases: ["Google Maps Scraper"], purpose: "local-business pools (plan_leads, run_leads, sync_to_supabase)", required: "when the transcript uses it", how: custom(urls.maps, "Google Maps Scraper") },
    { name: "Domain_Finder_Waterfall", aliases: ["Domain Finder Waterfall", "Domain Waterfall"], purpose: "company name plus location to a domain", required: "when the transcript uses it", how: custom(urls.domainWaterfall, "Domain Finder Waterfall") },
    { name: "Find_Named_Person", aliases: ["Find Named Person", "People Waterfall"], purpose: "named people at a domain", required: "when the transcript uses it", how: custom(urls.peopleWaterfall, "Find Named Person") },
    { name: "DiscoLike", aliases: [], purpose: "company discovery, bulk domain match, ICP validation", required: "when the transcript uses it", how: "Custom connector. Add DiscoLike in Grokbot." },
    { name: "Apify", aliases: [], purpose: "actors and datasets the transcript names", required: "when the transcript uses it", how: "The Apify connector." },
    { name: "PermitStack", aliases: ["Permits_GCs", "Permit & Parcel"], purpose: "permit and parcel pulls", required: "when the transcript uses it", how: custom(urls.permits, "PermitStack") },
    { name: "FullEnrich", aliases: [], purpose: "last-resort email and mobile enrichment", required: "when the transcript uses it", how: "The FullEnrich connector." },
    { name: "Prospeo", aliases: [], purpose: "second and third TAM count, person search", required: "when the transcript uses it", how: "Custom MCP or connector; ask Josh." },
  ];
}

export interface ConnectorsAnswer {
  ok: boolean;
  missing_required: Array<{ name: string; purpose: string; how: string }>;
  missing_optional: Array<{ name: string; purpose: string; how: string }>;
  /** Servers the service calls itself; the bot needs nothing for them. */
  handled_by_service: Array<{ name: string; purpose: string }>;
  present: string[];
  rule: string;
}

export const CONNECTORS_RULE =
  "Check this once per session before anything else. A required connector that is missing stops the top-up: tell Josh which ones to attach in Grokbot and wait. An optional one is needed only when the campaign's transcript used it. The ones the service calls itself (verification, the Smartlead import) need nothing from you. Every lead row moves through LeadPipe (Context Saver) and this service; never pull leads, exports or dataset items into chat.";

function matches(spec: ConnectorSpec, have: string[]): boolean {
  const names = [spec.name, ...spec.aliases].map((n) => n.toLowerCase().replace(/[\s_-]+/g, ""));
  return have.some((h) => {
    const t = h.toLowerCase().replace(/^mcp__/, "").replace(/[\s_-]+/g, "");
    return names.some((n) => t === n || t.startsWith(n));
  });
}

/** `have` is the bot's own tool or server list, as it sees it. Matching is forgiving on case, spaces and the mcp__ prefix. */
export function connectorsCheck(have: string[], urls: ConnectorUrls = {}): ConnectorsAnswer {
  const specs = connectorSpecs(urls);
  const present: string[] = [];
  const missing_required: ConnectorsAnswer["missing_required"] = [];
  const missing_optional: ConnectorsAnswer["missing_optional"] = [];
  const handled_by_service: ConnectorsAnswer["handled_by_service"] = [];
  for (const s of specs) {
    if (s.required === "the service calls it") {
      handled_by_service.push({ name: s.name, purpose: s.purpose });
      continue;
    }
    if (matches(s, have)) present.push(s.name);
    else (s.required === "always" ? missing_required : missing_optional).push({ name: s.name, purpose: s.purpose, how: s.how });
  }
  return { ok: missing_required.length === 0, missing_required, missing_optional, handled_by_service, present, rule: CONNECTORS_RULE };
}
