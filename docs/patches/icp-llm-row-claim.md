# Patch: icp-llm row claiming (D111)

Live function: `icp-llm` v12 on project `azpapwtnrbzywlnxxecz` only.
Patched source is `supabase/functions/icp-llm/index.ts`. Do not
deploy from this PR. After Josh says to, deploy that file and bump
the skill text that still says "until the claiming patch is live".
Hard cap is 5 copies (`MAX_COPIES` plus an advisory lock). HTTP `k=`
is function secret `ICP_LLM_HTTP_KEY` (the live gate; not in git).

## Why

The run handler loads `limit n` rows into memory with no
`FOR UPDATE SKIP LOCKED` and no `in_progress` lease. Comment in the
live source: "Run calls one at a time per batch (no row claiming
here)." Two copies grade and pay for the same domains. A restart
re-grades anything that has not yet written a finished
`icp_llm_results` row. After this patch, 3 to 5 copies may run on
the same batch; a restart resumes only unfinished rows.

Keep `idle_timeout: 10` and `max: 2`. Never more than 5 parallel
invocations (60-connection cap).

## Change 1 — file header comment

Replace:

```
// Run calls one at a time per batch (no row claiming here). idle_timeout keeps warm copies from hoarding DB connections.
```

with:

```
// Run claims rows (in_progress lease, SKIP LOCKED) so 3-5 copies can share a batch. idle_timeout keeps warm copies from hoarding DB connections.
```

## Change 2 — claim instead of `select … limit n`

In `mode === 'run'`, replace the `const rows = tag ? await sql\`select …\` : await sql\`select …\`` block with the following. Unique key on `icp_llm_results` is `(domain, model)`. Lease is 10 minutes, same window as `icp-site-fetch`.

```ts
      const rows = tag
        ? await sql`
            with claim as (
              select t.domain, t.body
                from topup.gate_domains g
                join client_salesglider.icp_site_text t on t.domain = g.dom
               where g.tag = ${tag}
                 and t.http_status between 200 and 399
                 and coalesce(t.chars, 0) > 300
                 and not exists (
                   select 1 from client_salesglider.icp_llm_results r
                    where r.domain = t.domain and r.model = ${spec} and r.error is null
                 )
                 and not exists (
                   select 1 from client_salesglider.icp_llm_results r
                    where r.domain = t.domain and r.model = ${spec}
                      and r.error = 'in_progress'
                      and r.created_at > now() - interval '10 minutes'
                 )
               order by t.domain
               limit ${n}
               for update of t skip locked
            ), ins as (
              insert into client_salesglider.icp_llm_results (domain, batch, model, error, created_at)
              select domain, ${batch}, ${spec}, 'in_progress', now() from claim
              on conflict (domain, model) do update
                set error = 'in_progress', created_at = now(), batch = excluded.batch
                where client_salesglider.icp_llm_results.error is not null
              returning domain
            )
            select c.domain, c.body from claim c join ins i using (domain)`
        : await sql`
            with claim as (
              select t.domain, t.body
                from client_salesglider.icp_site_text t
               where t.batch = ${batch}
                 and t.http_status between 200 and 399
                 and coalesce(t.chars, 0) > 300
                 and not exists (
                   select 1 from client_salesglider.icp_llm_results r
                    where r.domain = t.domain and r.model = ${spec} and r.error is null
                 )
                 and not exists (
                   select 1 from client_salesglider.icp_llm_results r
                    where r.domain = t.domain and r.model = ${spec}
                      and r.error = 'in_progress'
                      and r.created_at > now() - interval '10 minutes'
                 )
               order by t.domain
               limit ${n}
               for update of t skip locked
            ), ins as (
              insert into client_salesglider.icp_llm_results (domain, batch, model, error, created_at)
              select domain, ${batch}, ${spec}, 'in_progress', now() from claim
              on conflict (domain, model) do update
                set error = 'in_progress', created_at = now(), batch = excluded.batch
                where client_salesglider.icp_llm_results.error is not null
              returning domain
            )
            select c.domain, c.body from claim c join ins i using (domain)`;
```

## Change 3 — release leftovers, remaining ignores live leases

After `await Promise.all(Array.from({ length: Number(u.searchParams.get('w') ?? 8) }, worker));` insert:

```ts
      if (q.length) {
        await sql`update client_salesglider.icp_llm_results
                     set error = 'released'
                   where domain = any(${q.map((r: any) => r.domain)})
                     and model = ${spec}
                     and error = 'in_progress'`;
      }
```

Change both `remaining` counts so a live `in_progress` lease is not counted as leftover work (it is in flight on another copy):

- Treat `r.error is null` as finished.
- Treat `r.error = 'in_progress' and r.created_at > now() - interval '10 minutes'` as claimed.
- `remaining` = readable sites with neither.

Example (batch path):

```ts
      const [left] = tag
        ? await sql`select count(*)::int c
                      from topup.gate_domains g
                      join client_salesglider.icp_site_text t on t.domain = g.dom
                     where g.tag = ${tag}
                       and t.http_status between 200 and 399
                       and coalesce(t.chars, 0) > 300
                       and not exists (select 1 from client_salesglider.icp_llm_results r
                                        where r.domain = t.domain and r.model = ${spec} and r.error is null)
                       and not exists (select 1 from client_salesglider.icp_llm_results r
                                        where r.domain = t.domain and r.model = ${spec}
                                          and r.error = 'in_progress'
                                          and r.created_at > now() - interval '10 minutes')`
        : await sql`select count(*)::int c
                      from client_salesglider.icp_site_text t
                     where t.batch = ${batch}
                       and t.http_status between 200 and 399
                       and coalesce(t.chars, 0) > 300
                       and not exists (select 1 from client_salesglider.icp_llm_results r
                                        where r.domain = t.domain and r.model = ${spec} and r.error is null)
                       and not exists (select 1 from client_salesglider.icp_llm_results r
                                        where r.domain = t.domain and r.model = ${spec}
                                          and r.error = 'in_progress'
                                          and r.created_at > now() - interval '10 minutes')`;
```

Worker writes stay as they are: finished rows set `error` to null (or the real error string). That ends the lease.

## How to call after deploy

`icp-website-gate`: up to 5 calls side by side, `n=300&w=20`, same `batch` and `model`. Stop when `remaining` is 0. A killed call's leftovers show `error='released'` or an expired `in_progress`; the next call claims them.

## Do not

- Do not put a key in git.
- Do not apply this to any project other than `azpapwtnrbzywlnxxecz`.
- Do not raise the function's DB pool above 2.
