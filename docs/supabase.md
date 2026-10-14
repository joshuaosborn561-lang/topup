# Where the data lives

One Supabase project: `azpapwtnrbzywlnxxecz` (campaignintelligence). Never
another. Rows never leave it except server to server; counts only in chat.

## Leads and clients

| Where | What |
|---|---|
| `lp.<client_tag>_ingested_leads` | LeadPipe's lane table per client: every person pulled for that client, with `email`, `first_name`, `last_name`, `company_name`, `company_domain`, `title`, `company_size`, `city`, `state`, `linkedin_url`, the normalized merge fields (`first_name_n`, `company_n`, `location`, `local_sports_team`), `mail_class` (SEG or OTHER from the verifier), `lead_status`, `run_id`, `source_label`, and the finder's `wf_*` columns. |
| `lp.<client_tag>_*` | LeadPipe's other tables for the client (staging, exports). All count as "held". |
| `client_<client_tag>.*` | The client's own schema (queues, resolution tables, Maps pulls). All count as "held". |
| `public.<client_tag>…_companies`, `…_contacts`, `…_wf_companies`, `…_wf_contacts` | Waterfall output tables. All count as "held". |
| `public.leads` | The Smartlead mirror: every lead in every campaign with `smartlead_client_id`, `status`, `negative_class`, `category_id`. Held, and the source of unsubscribes. |
| `public.sends` | Every send with `lead_id`, `smartlead_stats_id`, `positive_reply`, `bounced`. Runway and the reply bar come from here. |
| `public.campaigns` | Every Smartlead campaign with `smartlead_campaign_id`, `smartlead_client_id`, `status`, `name`. |
| `public.suppression` | The DNC list. Never load an address on it. |
| `topup.client_map` | `client_tag` to `smartlead_client_id`. |
| `topup.campaign_registry` | Which lane each campaign belongs to. |

Client tags: `peterson`, `peterson_earthworks`, `basco`, `culture_fits`,
`parlay`, `msrs`, `bcp`, `goliath`, `techevo`, `salesglider`, `insight`,
`emcor`.

## Transcripts

| Where | What |
|---|---|
| `topup.list_build_records` | One row per list build or top-up: `client_tag`, `campaign_ids`, `lanes`, `narrative` (what was asked and done, counts), `transcript_path`, `spend_cents`, `session_date`, `written_by`. |
| Storage bucket `list-build-transcripts` | The full chat transcript of each build at `transcript_path`: every tool call with its arguments, in order. This is the method. |
| `topup.process_changes` | What changed about how lists are built, dated, across clients. |
| `topup.client_playbook` | A view: the client's builds and process changes in one chronological list. Read this first. |

## Retired, left in place, unread

The service that used to sit between Grokbot and the vendors is gone
(D110). Its tables stay so history is not lost: `topup.runs`,
`topup.run_steps`, `topup.cards`, `topup.job_settings`, `topup.lane_events`,
`topup.lane_state`, `topup.spend_ledger`, `topup.stall_events`,
`topup.service_flags`, `topup.verify_batches`, `topup.qa_rules`,
`topup.icp_variants`, `topup.pull_receipts`, `topup.mx_class`,
`topup.ref_cities`, `topup.ref_acronyms`, `topup.client_domain_blocklist`,
`topup.client_domain_list_state`, `topup.lead_write_lock`. Nothing reads
them. Drop them when Josh says so.
