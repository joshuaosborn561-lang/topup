# The MCP servers: where they are and how to call them

Every server below speaks MCP over streamable HTTP at the URL given. Josh's own servers run on Railway; their auth is a bearer token held as a Railway service variable on each server (the variable name is in each repo's README). Never commit a token. Third party servers use the vendor's own API key or OAuth.

Two ways to reach them and the service should use the first:

1. **From service code:** an MCP client (the official `@modelcontextprotocol/sdk` client with the streamable HTTP transport, or the Python equivalent) pointed at the URL with the bearer header. Several of Josh's servers also expose plain REST routes next to `/mcp`; check each repo and prefer REST from code when it exists. Rows never travel through the service: use each server's `source_table` plus `writeback` mode so vendors read from and write to Supabase directly.
2. **From Cursor while building:** add each server to `.cursor/mcp.json` as `{"url": "...", "headers": {"Authorization": "Bearer ${TOKEN}"}}` so you can call tools by hand while you read a repo.

The routing rule for which server owns which job is in `leadgen-mcp-routing/SKILL.md` and section 2 of the brief. The one line version: find a company with Maps, PermitStack, or parcels; find a domain with Domain Waterfall; find a person with Find Named Person; find an email with Name to Email then Email Finder Waterfall; confirm an email with Email Verifier Progression; move rows with LeadPipe; touch campaigns with the Smartlead server.

## Josh's servers (Railway, in scope)

| Server | URL | Owns |
|---|---|---|
| LeadPipe (named "Context Saver" in Claude) | `https://leadpipe-production-0df5.up.railway.app/mcp` | Client schemas, `ingest_csv`, `lp_export` signed URLs, `import_smartlead`, `sync_smartlead`, `build_suppression`, job status |
| Google Maps Scraper | `https://google-maps-mcp-production-88a3.up.railway.app/mcp` | Local business discovery by category and geography, outcome mode v1.8, `estimate_only=true` first |
| PermitStack | `https://permitstack-mcp-production.up.railway.app/mcp` | Building permits by type, date, geography, contractor; trade plays |
| Permits/GCs | `https://workspace-production-4702.up.railway.app/mcp` | DFW commercial parcels and cached Shovels GC contractors, Texas and Florida officer matching, calling lists |
| Domain Finder Waterfall | `https://domain-waterfall-production.up.railway.app/mcp` | Company name plus location to domain, `resolve_domain` on a source table, receipt tests |
| Find Named Person | `https://people-waterfall-production.up.railway.app/mcp` | Company to named decision maker, `resolve_people` on a source table |
| Email Finder Waterfall | `https://email-waterfall-production-021b.up.railway.app/mcp` | Name plus company or domain to work email, cascades AI Ark then LeadMagic then FullEnrich, `enrich_waterfall` with `source_table`, `writeback`, `max_tier`, `estimate_only` |
| Name to Email Finder | `https://finder-production-e298.up.railway.app` | Josh's own first attempt at name plus domain to email, runs before any paid vendor |
| Email Verifier Progression | `https://verifyfall-production.up.railway.app/mcp` | MillionVerifier then No2Bounce, `start_verification` from a file URL, status, resume, sendable and rejected exports |
| Smartlead server | `https://workspace-production-9629.up.railway.app/mcp` | Campaign reads and writes, `stage_leads_from_url`, `start_lead_import`, `start_lead_purge`, settings, schedule, mailboxes, analytics, raw `smartlead_request` |
| RVM Drop | `https://rvm-drop-production.up.railway.app/api/mcp` | Ringless voicemail sequencer, out of scope for version one |

Property owners and parcels: the parcel records live in Supabase project `kemvxzhcxvynmoutwdrh`. There is no separate parcel MCP in the current connector list; read them through Supabase, and through the Permits/GCs server for DFW commercial parcels.

## Third party servers in the stack

| Server | URL | Role and cost |
|---|---|---|
| getleads | `https://app.getleads.io/api/mcp` | Primary contact database, unlimited plan, free. Band labels only, `VALID` only, industries with commas break |
| AI Ark | `https://api.ai-ark.com/v1/mcp` | People discovery tier, paid. Returns first person at a domain not by title. Reverse email endpoint 404s |
| LeadMagic | `https://mcp.leadmagic.io/mcp` | Enrichment tier, paid. Bulk `employee_finder` then SQL title filter then `work_email_finder` is 9x cheaper than `search_people`. `detect_job_change` bills on every call, banned |
| Prospeo | `https://mcp.prospeo.io` | Cheaper name and company enrichment, paid |
| FullEnrich | `https://mcp.fullenrich.com/mcp` | Last tier, expensive, off in every recipe unless Josh stamps it on |
| DiscoLike | `https://api.discolike.com/v1/mcp` | Firmographic lookalikes and company counts, mostly free counts |
| Apify | `https://mcp.apify.com` | SERP scrapes and LinkedIn post scrapes, paid, schemas change without notice |
| TheirStack | `https://api.theirstack.com/mcp` | Hiring and tech signals |
| No2Bounce | `https://workspace-production-3a50.up.railway.app/mcp` | Do not call directly. Verification runs through Email Verifier Progression only |
| Supabase | `https://mcp.supabase.com/mcp` | All state and lead tables. Three projects, confirm before writing: `azpapwtnrbzywlnxxecz` campaign and lead data, `kemvxzhcxvynmoutwdrh` parcels, `klomihumrgwoixbzxypr` CRM automation |
| Railway | `https://mcp.railway.com` | Deploys, logs, variables for every server above |
| Slack | `https://mcp.slack.com/mcp` | The console. The service needs its own Slack app, not this connector |
| Fireflies | `https://api.fireflies.ai/mcp` | Client call transcripts, where ICP changes usually originate |
| HubSpot | `https://mcp.hubspot.com/anthropic` | Client records |
| HeyReach | `https://mcp.heyreach.io/mcp` | LinkedIn, out of scope for version one |

## Removed or banned, do not wire

PDL (banned everywhere including wrappers). BillionVerifier at `workspace-production-e8f7` (removed). Standalone MillionVerifier at `millionverifier-mcp-production` (verification goes through Progression only). Clay. Hunter (being phased out as a tier). Apollo is connected but is not part of the routing and should not be added without Josh.

## Rules that apply to every call

Estimate before spending, state the dollar figure, wait for approval above the cap. No lead rows in tool arguments, logs, or Slack beyond ten sample rows. One primary call, not a hand built chain: the servers own their internal cascades. Success is useful output, never rows processed. Poll job status; never assume a job finished. Pass `client_tag` on every LeadPipe and waterfall job: `peterson`, `peterson_earthworks`, `basco`, `culture_fits`, `parlay`, `msrs`, `bcp`, `goliath`, `techevo`, `salesglider`, `insight`.
