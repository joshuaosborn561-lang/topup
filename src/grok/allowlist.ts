/**
 * D39, D53 — what Grok bot may call and what it must never pull into
 * context. Grok reads counts and runs verbs. Rows move server to server.
 * Ask Josh.
 */

/** Hard ceiling shared with D2. Ten masked samples, never a list. */
export const GROK_SAMPLE_MAX = 10;

/** The reads (D52). Each returns counts, ids, labels and the written notes, with the rule stated. */
export const CANON_READS = ["canon", "campaigns", "campaign_record", "sources", "count", "held", "size", "jobs", "job", "spend", "leftovers", "holds", "loads_paused"] as const;

/** The verbs (D52). Each runs one or two stages on a job, once, and returns counts. */
export const CANON_VERBS = ["pull", "suppress", "icp", "enrich", "verify", "normalize", "qa", "stage", "import", "write_receipt", "abort", "resolve", "note"] as const;

/** Every tool on this service's MCP. Nothing else is registered (D53). */
export const CANON_TOOLS = [...CANON_READS, ...CANON_VERBS] as const;

/**
 * Tools Grok bot may call. Returns are counts, ids, a job_id, or a signed
 * URL the bot does not open. LeadPipe and this service move the rows.
 */
export const GROK_MAY = [...CANON_TOOLS, "lp_plan", "lp_run", "lp_status", "lp_export", "lp_sample", "lp_inventory", "lp_ensure_client", "lp_list_clients"] as const;

export type GrokMay = (typeof GROK_MAY)[number];

/**
 * Tools that return contact payloads, export files into chat, or cost
 * ~$0.10/company. Grok bot must not call these. This service may,
 * server-side, through SpendRails after a named approval.
 */
export const GROK_MUST_NOT = [
  "export_contacts",
  "search_contacts",
  "getleads_enrich_person_batch",
  "getleads_get_emails_from_linkedin_batch",
  "get_decision_makers_batch_result",
  "get_enrichment_result",
  "list_profile_monitoring_leads",
  "list_website_visitor_leads",
  "export_website_visitor_leads",
  "get-dataset-items",
  "find_dms_by_title",
] as const;

export type GrokMustNot = (typeof GROK_MUST_NOT)[number];

/** Columns Grok must never SELECT into chat (Supabase execute_sql / table reads). */
export const GROK_MUST_NOT_SELECT = ["email", "first_name", "last_name", "phone", "linkedin_url"] as const;

/** The four legs every receipt carries. `campaign_record` reads them; `write_receipt` writes them. */
export const GROK_SOURCE_TAGS = ["company_source", "domain_source", "person_source", "email_source"] as const;

/** Receipt columns Grok reads (counts, keys, method names). */
export const GROK_RECEIPT_TAGS = [
  "icp_kind",
  "persona",
  "company_source",
  "company_filters",
  "domain_source",
  "person_source",
  "email_source",
  "email_max_tier",
  "campaign_ids",
  "segment",
  "yield_by_step",
  "how_i_did_it",
  "build_label",
  "granularity",
  "notes",
] as const;

/**
 * Tables Grok may read tags from. Counts, keys, and method names only.
 * `lead_provenance` is the per-lead stamp — COUNT tags, never SELECT email.
 */
export const GROK_TAG_TABLES = ["topup.pull_receipts", "topup.campaign_method", "topup.campaign_registry", "topup.lead_provenance", "topup.campaign_builds"] as const;
