# Edge function deploy artifacts (D111)

Project `azpapwtnrbzywlnxxecz` only. These files are the live
`icp-llm` v12 and `site-people` v5 sources with the D111 patches
applied. Do not deploy until Josh says. Do not apply them to any
other project.

## Functions

| Function | File | After deploy |
|---|---|---|
| `icp-llm` | `icp-llm/index.ts` | 3–5 copies per batch, never more than 5. Set function secret `ICP_LLM_HTTP_KEY` to the live `k=` (not in git). Pool stays `max: 2`, `idle_timeout: 10`. |
| `site-people` | `site-people/index.ts` | HTTP `k=` is vault secret `site_people_key`. Create that secret first. Fetch / extract / ask claiming is unchanged. |

## Migration (separate)

`supabase/migrations/20261015220000_site_dm_pick_standard_filters.sql`
rewrites `topup.site_dm_pick` with history / old-year and plain-agent
filters. Franchise HQ and "name in site text" stay in post-view SQL.

Do not apply the migration or deploy the functions from this PR.
