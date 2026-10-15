# Patch: move site-people HTTP key into the vault (D111)

Live function: `site-people` v5 on project `azpapwtnrbzywlnxxecz` only.
Patched source is `supabase/functions/site-people/index.ts`. Do not
deploy from this PR. Create vault secret `site_people_key` first
(the live `k=` value, not in git), then deploy that file after Josh
says to.

The function currently has a hardcoded `const KEY = '…'` compared to
the incoming `k=` query param. Gemini and OpenRouter keys already
come from `vault.decrypted_secrets`. The HTTP gate key should too.

Never commit the secret value. The string that is in the live
function today is the value to paste into the vault, once, by hand.

## Operator SQL (run in the dashboard, do not put the value in git)

```sql
-- Paste the current live site-people k= value in place of the
-- placeholder. Run once on azpapwtnrbzywlnxxecz only.
select vault.create_secret(
  '<paste the live site-people k= value here, not in git>',
  'site_people_key',
  'HTTP k= for the site-people edge function'
);
```

If a row named `site_people_key` already exists, update it in the
vault UI instead of creating a second row.

Confirm without printing the value:

```sql
select name,
       length(decrypted_secret) as n,
       (decrypted_secret is not null) as present
  from vault.decrypted_secrets
 where name = 'site_people_key';
```

Expect `present = true` and `n` around 20.

## Function source

The live file already has:

```ts
async function vault(sql: any, name: string) {
  const [r] = await sql`select decrypted_secret s from vault.decrypted_secrets where name = ${name}`;
  return r?.s as string;
}
```

1. Delete `const KEY = '…';` (the hardcoded line near the top).
2. Inside `Deno.serve`, after `const sql = postgres(...)`, replace:

```ts
  if (u.searchParams.get('k') !== KEY) return new Response('forbidden', { status: 403 });
```

with:

```ts
  const gate = await vault(sql, 'site_people_key');
  if (!gate) return ok({ error: 'site_people_key missing from vault' }, 500);
  if (u.searchParams.get('k') !== gate) return new Response('forbidden', { status: 403 });
```

Fetch / extract / ask claiming is already correct (10 minute fetch
lease, 3 minute extract/ask `in_progress`). Do not change those
queries in this patch.

## After deploy

Callers keep passing `k=` on the URL. The value is the vault secret,
not a string in a skill or a PR. `skills/site-people-dm` now names
the vault secret and does not reprint the old key.

## Do not

- Do not commit the key, a `.env`, or a vault dump.
- Do not apply this to any project other than `azpapwtnrbzywlnxxecz`.
- Do not leave the hardcoded `const KEY` as a fallback.
