# Edge function deploy artifacts (D112)

Project `azpapwtnrbzywlnxxecz` only. These files are the live
`icp-llm` v12 and `site-people` v5 sources with the D112 patches
applied. Do not deploy until Josh says. Do not apply them to any
other project.

## Functions

| Function | File | After deploy |
|---|---|---|
| `icp-llm` | `icp-llm/index.ts` | 3–5 copies per batch, never more than 5. HTTP `k=` is vault secret `icp_llm_key` (create it first). Env `ICP_LLM_HTTP_KEY` is optional fallback. Pool stays `max: 2`, `idle_timeout: 10`. |
| `site-people` | `site-people/index.ts` | HTTP `k=` is vault secret `site_people_key`. Fetch / extract / ask claiming is unchanged. |

## Migration (separate)

`supabase/migrations/20261015220000_site_dm_pick_standard_filters.sql`
rewrites `topup.site_dm_pick` with history / old-year and plain-agent
filters. Franchise HQ and "name in site text" stay in post-view SQL.

Do not apply the migration or deploy the functions from this PR.

## booklet-data (D113)

The database half of the Lead Topup MCP booklet. POST `{action, args}` with one of `health`, `canon`, `toolkit`, `add_rule`, `clients`, `client`, `low_campaigns`. Fixed queries only; counts, ids, campaign names and plain text; never a lead row; never deletes. Deployed with JWT verification off, like the MCP itself (D41).
