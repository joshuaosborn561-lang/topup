/**
 * D99 — what Grokbot may call on this service and what it must never pull
 * into context. Grokbot reads the record, replays the build with its own
 * connectors, hands the pool over, and calls the next tool. Rows move
 * server to server. Ask Josh or Cayden.
 */

/** Ten masked samples on a card, never a list (D2). */
export const GROK_SAMPLE_MAX = 10;

/** The reads. Counts, ids, labels and the written record, never a row. */
export const CANON_READS = ["canon", "connectors", "campaigns", "build_record", "jobs", "job", "spend", "loads_paused"] as const;

/** The verbs. */
export const CANON_VERBS = ["topup", "load", "abort"] as const;

/** Every tool on this service's MCP. Nothing else is registered. */
export const CANON_TOOLS = [...CANON_READS, ...CANON_VERBS] as const;

/** LeadPipe (Context Saver) tools: every row moves through them, never through chat. */
export const LEADPIPE_TOOLS = ["lp_plan", "lp_run", "lp_status", "lp_export", "lp_sample", "lp_inventory", "lp_ensure_client", "lp_list_clients"] as const;

/**
 * Tools that put contact payloads, exports or dataset items into chat.
 * Grokbot replays a build through LeadPipe and the vendor's own server-side
 * exports; it never reads the rows.
 */
export const GROK_MUST_NOT = [
  "export_contacts into chat",
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

/** Columns Grokbot must never SELECT into chat (Supabase execute_sql). Count them; never read them. */
export const GROK_MUST_NOT_SELECT = ["email", "first_name", "last_name", "phone", "linkedin_url"] as const;

/** The hard rule, in one line, for every tool description that moves rows. */
export const LEADPIPE_RULE = "Every lead row moves through LeadPipe (Context Saver) or this service. Never SELECT emails or names, never read an export, never paste a row into chat.";
