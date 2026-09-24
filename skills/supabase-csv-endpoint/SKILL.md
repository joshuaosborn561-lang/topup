---
name: supabase-csv-endpoint
description: Serve Supabase table data as a public CSV URL using a SQL RPC plus an edge function, and ingest result CSVs back server to server. Use whenever a tool needs a publicly reachable file_url (Email Verifier Progression start_verification, Smartlead stage_leads_from_url, LeadMagic bulk file_url), or whenever Josh asks for a file of lead data, because rows must never pass through chat context. Grok bot (D39) must use this or LeadPipe instead of pasting CSVs. Also covers reading a signed result CSV back into Postgres with http_get, including the DO block workaround for long signed URLs that break the MCP SQL parser.
---

# Supabase CSV endpoint

The context discipline says lead rows move server to server, never through chat. This is the
pattern that makes that real in both directions: **out** (table to public CSV URL) and **in**
(result CSV URL back into a table). Built and used twice on the Vasco build, 2026-08-14, for the
verifier file_url and for the launch list file deliverable.

Both directions run on project `azpapwtnrbzywlnxxecz` today, but the pattern is client-agnostic.

---

## Direction 1: table to public CSV URL

Two pieces: a `security definer` SQL function that builds the CSV text, and an edge function that
serves it. The edge function gets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` injected
automatically, so no keys travel anywhere.

### Step 1: the RPC

One row per line via `string_agg`. Escape commas out of free-text fields, quote anything that
carries punctuation, and put the header in the same string:

```sql
create or replace function public.myclient_launch_csv() returns text
language sql security definer set search_path = public as $$
  select 'first_name,last_name,email,domain' || chr(10) ||
  string_agg(
    replace(coalesce(first_name,''),',',' ') || ',' ||
    replace(coalesce(last_name,''),',',' ')  || ',' ||
    email || ',' || domain,
    chr(10) order by domain, last_name)
  from public.myclient_contacts
  where email_status = 'verified_sendable' and not suppressed
$$;
```

For an email-only list (what the verifier wants), return `table(email text)` from a function
instead and build `'Email' + chr(10) + join` in the edge function. Either shape works.

### Step 2: the edge function

Deploy with `verify_jwt=false`, since the consuming tool cannot authenticate:

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data, error } = await supabase.rpc('myclient_launch_csv');
  if (error) return new Response('error: ' + error.message, { status: 500 });
  return new Response((data ?? '') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="launch_list.csv"',
    },
  });
});
```

URL: `https://<project>.supabase.co/functions/v1/<function-name>`

### Step 3: verify before pointing anything at it

`curl -s -o /tmp/x.csv -w "%{http_code}"` the URL, check 200, `head` the first line for the
header, `wc -l` against the expected row count. Only then hand the URL to the consuming tool.
The verifier run tonight was checked this way before `start_verification` fired.

### Uses proven so far

- **Email Verifier Progression `start_verification`** takes the URL directly as `file_url`.
- **File deliverable for Josh**: curl the URL to `/mnt/user-data/outputs/` in the container and
  present the file. Rows reach Josh without ever entering chat text.
- Same shape works for Smartlead `stage_leads_from_url` and LeadMagic bulk `file_url`.

### Security note

`verify_jwt=false` means the URL is public to anyone who has it. Client contact data sits behind
an unguessable path, which is fine for hours, not weeks. Delete the edge function or gate it once
the consuming job completes. Track which endpoints exist per client.

---

## Direction 2: result CSV back into Postgres

Verifier results arrive as signed storage URLs. Ingest them server side with the `http` extension
rather than pasting rows anywhere.

**The trap:** long signed URLs inside plain SQL break the MCP execute_sql parser with phantom
syntax errors (three different errors on three valid statements tonight). **The fix is a DO block**
holding the URL in a declared variable:

```sql
create table if not exists client_x.verify_ingest (line text primary key);
do $do$
declare
  u text := 'https://<project>.supabase.co/storage/v1/object/sign/...very-long-signed-url...';
  body text;
begin
  select content into body from http_get(u);
  insert into client_x.verify_ingest (line)
  select x from unnest(string_to_array(body, chr(10))) x
  where x like '%@%' and lower(x) not like 'email%'
  on conflict do nothing;
end
$do$;
```

**Second trap:** the SENDABLE and REJECTED CSVs are multi-column
(`email,verifier,result,detail`), so a naive split by newline stores full lines that match
nothing. Split columns after ingest:

```sql
create table client_x.verify_clean as
select distinct lower(trim(split_part(line, ',', 1))) email,
       split_part(line, ',', 2) verifier,
       split_part(line, ',', 3) result
from client_x.verify_ingest
where split_part(line, ',', 1) like '%@%';
```

Then write verdicts onto the contact tables by email match: `verified_sendable` for members,
`verified_rejected` for every non-empty email absent from the sendable set. Always report the
post-suppression sendable count, since that is the launch number.

Signed URLs expire in about an hour. Ingest immediately after the run completes.

---

## Rules

- Rows never enter chat. Out via edge function URL, in via http_get, deliverables via curl to the
  outputs directory.
- Always curl-verify an endpoint (status, header, row count) before handing the URL to a tool.
- Long URLs go inside a DO block variable, never inline in a statement.
- Split multi-column result lines before matching on email.
- Tear down or gate public endpoints when the job is done.
