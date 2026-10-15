# Email finder claiming patch (D111)

This agent could not push to `joshuaosborn561-lang/email-waterfall`
(GitHub 403: the token is scoped to `topup` only). Apply these files
on that repo by hand, then open the PR there. Do not apply from
`topup` itself. Do not merge until Josh says to.

Target commit when this was written: `65a181d` on `email-waterfall`
`main` ("Parse GetLeads contacts[] and write title-matched DMs").

## Files

- `email-waterfall-007_ew_claim_source.sql` — migration. Apply on
  Supabase project `azpapwtnrbzywlnxxecz` only, after the code is
  reviewed. Adds `ew_claim_source`, `ew_release_claims`, and lease
  columns (`wf_lease_until`, `wf_lease_owner`).
- `email-waterfall-claim.patch` — unified diff against that `main`.
  Workers 20–50 (`COMPANY_CONCURRENCY`, default 40, cap 50) claim
  unfinished rows, free providers first, paid on misses, ceiling
  releases unprocessed claims.

## Apply

```bash
git clone https://github.com/joshuaosborn561-lang/email-waterfall
cd email-waterfall
git checkout -b cursor/email-finder-claim-753c
git apply /path/to/topup/docs/patches/email-waterfall-claim.patch
# or copy 007_*.sql into supabase/migrations/ if apply skips it
```

Then: tests `pytest tests/test_claim_source.py tests/test_source.py`
(217 passed here, ignoring MCP-import tests that need the `mcp`
package), push, open a PR against `email-waterfall` `main`. Railway
deploys from GitHub after merge.

Resume a queue with `where: "wf_status is null"`. The claim RPC also
takes expired `processing` leases. Live leases are not re-scanned.
A missing RPC falls back to the old fetch-all path.

Never commit vendor keys or the Supabase service role.
