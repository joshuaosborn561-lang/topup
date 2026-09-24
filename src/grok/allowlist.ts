/**
 * D39 — Grok bot tool allow / ban. The babysitter starts jobs and reads
 * counts. It does not pull row payloads into chat. Ask Josh.
 */

/** Hard ceiling shared with D2. Ten masked samples, never a list. */
export const GROK_SAMPLE_MAX = 10;

/**
 * Tools Grok bot may call. Returns are counts, ids, a job_id, or a signed
 * URL the bot does not open. LeadPipe and the Railway service move the rows.
 */
export const GROK_MAY = [
  "start_topup",
  "lane_state",
  "run_status",
  "list_runs",
  "list_holds",
  "resolve_hold",
  "recipe_get",
  "campaign_registry",
  "variant_stats",
  "missing_piece_groups",
  "add_client_domains",
  "register_queue_table",
  "lane_note",
  "sample_rows",
  "lp_plan",
  "lp_run",
  "lp_status",
  "lp_export",
  "lp_sample",
  "lp_inventory",
  "lp_ensure_client",
  "lp_list_clients",
] as const;

export type GrokMay = (typeof GROK_MAY)[number];

/**
 * Tools that return contact payloads, export files into chat, or cost
 * ~$0.10/company. Grok bot must not call these. The Railway service may,
 * server-side, through SpendRails.
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
export const GROK_MUST_NOT_SELECT = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "linkedin_url",
] as const;

/**
 * Source legs on campaignintelligence. Necessary, not sufficient —
 * physical lanes also need the detail / evidence / filter keys below.
 */
export const GROK_SOURCE_TAGS = [
  "company_source",
  "domain_source",
  "person_source",
  "email_source",
  "email_max_tier",
  "email_tier",
] as const;

/** Extra stamp columns. Especially required when icp_kind is physical. */
export const GROK_STAMP_TAGS = [
  "company_detail",
  "evidence",
  "confidence",
  "build_label",
  "feed_pattern",
] as const;

/** Receipt columns Grok must read (counts, keys, method names). */
export const GROK_RECEIPT_TAGS = [
  "icp_kind",
  "persona",
  "company_source",
  "company_detail",
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
  "evidence",
  "confidence",
] as const;

/** company_filters keys that a physical receipt actually carries. */
export const GROK_PHYSICAL_FILTER_KEYS = [
  "maps",
  "maps_runs",
  "permits",
  "geo",
  "geo_note",
  "source_tool",
  "titles_wanted",
  "job_title_terms",
] as const;

/** segment jsonb keys on pull_receipts. */
export const GROK_SEGMENT_KEYS = ["band", "mail_class", "gift", "offer_key", "campaign_family"] as const;

/**
 * Tables Grok may read tags from. Counts, keys, and method names only.
 * `lead_provenance` is the per-lead stamp — COUNT tags, never SELECT email.
 */
export const GROK_TAG_TABLES = [
  "topup.pull_receipts",
  "topup.campaign_method",
  "topup.campaign_recipe",
  "topup.feed_map",
  "topup.lead_provenance",
  "topup.provenance_sources",
  "topup.provenance_gaps",
] as const;
