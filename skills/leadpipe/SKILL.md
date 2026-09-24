---
name: leadpipe
description: LeadPipe is the store and job runner that keeps lead rows out of chat. Use whenever Josh or a bot needs to ingest a CSV/XLSX URL, export a signed URL, sample at most ten rows, check inventory, or ensure a client_tag. Grok bot (D39) must use this skill instead of pulling contacts into context. Response discipline is counts, job ids, and signed URLs only — never row payloads.
---

# LeadPipe

LeadPipe is the **store and job runner**, not a discovery method. It holds
companies and contacts per client and keeps row data out of chat. Response
discipline is **counts only**, never row payloads; inspect via `lp_sample`
(max 10 rows).

Named "Context Saver" in Claude. That is the same service. Claude minimized
tokens by sending URLs into LeadPipe and reading counts back. Grok bot does
the same (D39). The Railway leadtopup service already calls `lp_run
ingest_csv` and `lp_export` and never opens the file.

For the reverse direction (Supabase table out to a public CSV URL, and
result CSVs back in), use `skills/supabase-csv-endpoint`. The two together
mean rows never pass through chat in either direction.

## Clients

Clients are self-service as of 2026-08-14. `lp_ensure_client({client_tag})`
creates `client_<tag>` schemas plus `{tag}_ingested_leads` and registers the
tag; `lp_run` auto-ensures, so a brand-new snake_case tag works with no
setup step. `lp_list_clients` shows what exists. The old rule that a new
client needs its source registered first is dead for ingestion; it still
applies to `backfill` sources.

## Tools (counts / ids / URLs only)

| Tool | Returns | Notes |
|---|---|---|
| `lp_plan` | $0 plan, counts | Map a goal to a job kind. No enrichment. |
| `lp_run` | `job_id` + status | Kinds below. Auto-ensures the client. |
| `lp_status` | counts, pct, ETA | Never row payloads. |
| `lp_export` | `signed_url` + `row_count` | Do not open the URL in chat. Hand it to the next server. |
| `lp_sample` | ≤10 rows | Eyeball quality. Never more than 10. |
| `lp_inventory` | counts | companies, contacts, with_email, gaps. |
| `lp_ensure_client` | metadata | Idempotent. |
| `lp_list_clients` | tags | No lead payloads. |

## `ingest_csv` (the universal downloadable-file intake, 2026-08-14)

Any presigned or public CSV/XLSX URL goes **server side** into
`{tag}_ingested_leads` without touching chat.

`lp_run` params:

- `urls[]` (required)
- `source_label`
- `dedupe_key` (`email` default or `company_domain`)
- `exclude_name_patterns[]` (case-insensitive substring on company name)
- `exclude_domain_list[]`
- optional `column_map`

Header dialects auto-detect (getleads, AI Ark, Smartlead, generic
snake_case). Content hashing makes re-runs idempotent. Response returns
per-file `rows_read`, `filtered_out`, `dupes_dropped`, `rows_inserted`,
`unique_company_domains`.

First measured run: three getleads harvest CSVs, 5,839 rows in, 1,809
clean contacts at 1,485 companies out, vendor strip applied at ingest.

Presigned getleads URLs live 24 hours; ingest promptly or re-export free.

Other `lp_run` kinds: `backfill` (registered sources only), `ingest_serp`,
`import_smartlead`, `sync_smartlead`, `build_suppression`. Zero source rows
fails the job; it does not return an empty success.

## Paid enrichment is not "just LeadPipe"

`find_dms_by_title` routes to **paid vendor enrichment at roughly $0.10
per company**. On 4,284 companies that is $428. It silently ignores
`sources`, `queries`, `limit` and `icp_only` params, so passing SERP
sources does nothing. Check the estimate before approving, and scope the
company set before running rather than trying to scope inside the job.

Grok bot must not call `find_dms_by_title`. That is a Josh-approved spend
on a card, or it does not run (D9, D39).

## Grok bot (D39)

Start `lp_run ingest_csv` from a URL the vendor already signed. Poll
`lp_status`. Hand `lp_export`'s signed URL to the verifier or to
leadtopup. Report counts. Do not paste the CSV. Do not walk
`skills/lead-list-build` in chat — the Railway service walks those steps.
