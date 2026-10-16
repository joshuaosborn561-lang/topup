---
name: "record-list-build"
description: "Record exactly how a SalesGlider client lead list was built, at the end of any session that built or topped one up, so the Grok Bot babysitter (skills/grok-bot-babysitter) can rebuild more of the same list the same way including unstated judgment. The leadtopup / Top_Up service is retired (D110); this record and its transcript are what the bot reads on every top up, and the bot writes one at the end of every top up. Narrative plus full verbatim transcript to azpapwtnrbzywlnxxecz. Also, at the end of any session that changed how lists get built (a new step, a new tool, a label set, a title cut for one client), write one process change row with the transcript so the next operator knows. Sits beside first-pull-receipt, never replaces it."
---

# Record the list build

You just built or topped up a lead list for a SalesGlider client campaign. The receipt (`first-pull-receipt`) is the short machine summary of *what filters ran*. This record is what tells the next operator *how the build actually went* ... the order you worked in, what you rejected, the rules you applied by eye, the dead ends, the surprises, and the full verbatim session. The Grok Bot babysitter (`grok-bot-babysitter`, step 2) reads this row and its transcript straight from Supabase before every top up; the leadtopup / Top_Up service and its MCP are retired (D110). On a top up the bot is the one writing this record (babysitter step 7). Assume the operator who reads it has nothing but what you save here.

This is additive. It does not replace the receipt or provenance. The receipt stays Josh's at-a-glance "where does my data come from" picture; this record points at the receipt by id and never duplicates its fields.

## Two kinds of session, two tables

- **A build or top up session** writes a row in `topup.list_build_records` (the full procedure below).
- **A session that changed the process** writes a row in `topup.process_changes` (the short procedure under **Process changes** at the end). This fires whether or not a list was built. The test: would an operator rebuilding a list tomorrow do something differently because of this session? If yes, write the row. Examples: a new step added to lead-list-build (the ICP website gate on Oct 12 2026), a new edge function or MCP, a new or rewritten label set, a vendor dropped, a title purged from one client's lane, a lane retargeted. It does not need to be smart. Dump the transcript, write a few lines, done.

## Where it goes

Project `azpapwtnrbzywlnxxecz` (campaignintelligence) only. Confirm the project id before any write. Never the parcels project (`kemvxzhcxvynmoutwdrh`), never the CRM project (`klomihumrgwoixbzxypr`).

- Narrative, counts, filters, links → table `topup.list_build_records`.
- Process changes → table `topup.process_changes`.
- Full verbatim transcript → Supabase Storage bucket `list-build-transcripts` (private), path stored on the row.

All three already exist. The schema and the create statements are at the bottom under **Setup**; run them only if a `list_tables` on `topup` shows a table missing or a storage check shows the bucket missing.

## The one hard split: narrative vs transcript

Two different standards, do not mix them up.

- **The narrative** (the `narrative` or `summary` column, and anything you say in chat) carries **counts, filters, ids and prose only**. No names, no emails, no phones, no lead rows. Same rule as every other receipt and report.
- **The verbatim transcript** (the file in Storage) is the **true, complete session, nothing trimmed**: every user message, every Claude message, every tool call with its arguments, every filter, query, count, error and correction. It will contain sample lead rows and tool outputs with real names, emails and phones. That is allowed **because it lives only in Supabase and never passes through chat**. You do not scrub it. The point is faithfulness ... a future operator must be able to see exactly what happened.

What you must never do: paste the transcript, or any lead row from it, into a chat message or into a SQL argument. The transcript reaches Storage as an uploaded file, server side. If you cannot upload it as a file, you do not have a way to store it ... say so and stop, do not fall back to pasting it.

## Run order

Do these in order, as the last step of the build.

### 1. Confirm the project
`azpapwtnrbzywlnxxecz`. Confirm the table and bucket exist (`list_tables` on schema `topup`; a `select` on `storage.buckets` for `list-build-transcripts`). If either is missing, run the **Setup** block, then continue.

### 2. Assemble the verbatim transcript to a local file
Reconstruct the full session into one file, faithfully and completely. Do not summarize, do not trim, do not reorder. Include every turn and every tool call with its real arguments and results, in sequence, errors and corrections included.

- Prefer structured **JSONL**, one event per line (`{"ts":...,"role":...,"type":"message|tool_call|tool_result","name":...,"content":...}`), when the session turns are available to you that way.
- Otherwise write faithful **Markdown**: each turn labelled, each tool call in a fenced block with its arguments and its result.

Completeness beats format. A transcript that drops the boring middle is a failed record. Write it to the scratchpad, e.g. `<scratchpad>/transcript_<client_tag>_<YYYYMMDD>.jsonl`.

### 3. Upload the transcript to Storage, server side
Upload the local file to bucket `list-build-transcripts` at a path keyed by client and session: `<client_tag>/<YYYYMMDD>_<lane_or_session>.<jsonl|md>` (use `global/` as the folder for a process change that is not about one client). The working route as of Oct 12 2026: POST `{"path":"<path>"}` to edge function `lbt-sign-upload` with the project's anon key as the Bearer token and `apikey` header; it returns a `signedUrl`; PUT the file to that URL with `--data-binary`. Never embed the contents in a tool argument. Keep the path; it is `transcript_path` on the row.

If the upload fails, the record is not done. Report the failure plainly and stop ... do not write a row with a dangling path and do not paste the transcript anywhere.

### 4. Write the narrative in your own words
Free prose, not a fixed form. Write whatever a smart newcomer who has only this record would need to rebuild more of the same list the way you did. There is no template to fill; cover what actually mattered this session. Things that usually matter:

- **Source(s)** and why them: getleads, Maps, PermitStack, parcels, a signal, a handed table.
- **The exact filters as actually sent** to each tool, not a tidied version: band labels like `["51 to 200"]`, `email_status ["VALID"]`, geography, industries (validated against the catalog), `max_per_company`, the `where` clauses, the query shapes. If a filter was wrong at first and corrected, say both.
- **The order of steps** and which gates you waited on.
- **What you rejected and why**: widenings you chose not to do, titles you purged, industries you held or rerouted, a vendor tier you skipped.
- **Rules applied by eye**: the judgment calls that are not written in any filter ... "dropped anything that looked like a franchise HQ", "kept only rooftops with a real site", "treated two-person shops as out".
- **Things that look like rules but are not.** Call these out explicitly, because they mislead an operator who copies them as constraints. The canonical example, include it when it applies: *we filter getleads to VALID emails, but everything still goes through Email Verifier Progression anyway, so VALID is a quality filter, not a TAM ceiling ... do not treat the VALID count as the size of the pool.*
- **Dead ends**: what you tried that returned nothing or returned the wrong thing, so the operator does not repeat it.
- **Costs**: what each paid step cost, and cost per useful lead if you measured it.
- **Anything surprising.**
- **Anything you are unsure of.** A short "unsure / unverified" note is required if there is anything you could not confirm ... which count is soft, which filter you are reconstructing from memory, which step another person ran. Never present a guess as fact.

Keep lead PII out of this prose. Counts and filters only.

### 5. Show Josh the narrative and wait
Print the full narrative to Josh and ask him to correct it before you insert. He knows the unstated parts better than you do; this is the step where they get captured. Do not insert the row until he has seen it and okayed or corrected it. (You may create the transcript file and upload it first; the row is what waits.)

### 6. Insert the row
After Josh signs off, insert into `topup.list_build_records` with the corrected narrative, `client_tag`, every `campaign_ids` the list fed, the `receipt_ids` from this build's rows in `topup.pull_receipts`, `lanes`, `transcript_path`, `transcript_format`, `spend_cents`, `yield_by_step`, `session_date`. A trigger rejects the row if any campaign id is not in `public.campaigns`, the same gate the receipts use. One row per build session; a session that fed two lanes is still one row listing both lanes, all campaign ids, and all receipt ids.

### 7. Report
Reply to Josh with client, campaign ids, receipt ids, the transcript path, and the new record id. Counts and ids only. Then stop.

## Process changes (the addendum)

At the end of any session that changed how lists get built, whether or not a list was built:

1. Assemble and upload the whole session transcript exactly as in steps 2 and 3 above (whole session, not just the part about the change). Folder `global/` when the change applies to every client, `<client_tag>/` when it was about one client.
2. Insert one row in `topup.process_changes`: `client_tag` null for a global change, or the tag when the change was about that client (a title taken out of a lane, a label set tuned, a lane retargeted); `summary` of a few lines in plain words saying what is different now and where it lives (table, function, skill, variant name); `transcript_path`; `transcript_format`.
3. No review wait. Josh does not need to sign off an addendum; the transcript is the record. Tell him the row id in one line and move on.

The reading side lives in `grok-bot-babysitter`, `campaign-topup` and `lead-list-build`: before planning, they read the global rows plus the client's rows since that client's last build record, newest first. A row nobody reads is wasted, so when you add a new build skill, add the same read line there.

## Finding the receipt ids to link

The receipt for this build is in `topup.pull_receipts`, written at step 11.5. Match on `client_tag` plus the campaign ids you just loaded and take the latest row(s) per lane:

```sql
select id, lane, campaign_ids, created_at
from topup.pull_receipts
where client_tag = '<tag>'
  and campaign_ids && '{<campaign ids>}'
order by created_at desc;
```

Put those ids in `receipt_ids`. If no receipt exists yet, write it first (`first-pull-receipt`) ... a build is not recorded until its receipt exists.

## Do not

- Do not put lead rows, names, emails or phones in the narrative, in the summary, in chat, or in any SQL argument. Those live in the transcript file in Storage only.
- Do not trim, summarize or reorder the transcript. Verbatim and complete, or it is not a record.
- Do not write a row whose `transcript_path` points at a file that did not upload.
- Do not insert a build row before Josh has seen the narrative. (Process change rows do not wait.)
- Do not write to the parcels or CRM projects.
- Do not duplicate receipt fields here. Reference the receipt by id.
- Do not treat this as a substitute for the receipt or provenance. All three run.

## Setup (run only if a table or the bucket is missing)

Table:

```sql
create table if not exists topup.list_build_records (
  id                 bigint generated always as identity primary key,
  client_tag         text        not null,
  campaign_ids       int[]       not null,
  receipt_ids        bigint[],
  lanes              text[],
  narrative          text        not null,
  transcript_path    text        not null,
  transcript_format  text        not null default 'jsonl'
                       check (transcript_format in ('jsonl','md')),
  spend_cents        int,
  yield_by_step      jsonb,
  session_date       date        not null default current_date,
  written_by         text        not null default 'claude',
  created_at         timestamptz not null default now(),
  constraint list_build_records_campaign_ids_nonempty
    check (array_length(campaign_ids, 1) >= 1)
);
create index if not exists list_build_records_client_idx
  on topup.list_build_records (client_tag, session_date desc);
create index if not exists list_build_records_campaign_gin
  on topup.list_build_records using gin (campaign_ids);
create index if not exists list_build_records_receipt_gin
  on topup.list_build_records using gin (receipt_ids);
```

Process changes table (created Oct 12 2026, first row is the ICP gate full run):

```sql
create table if not exists topup.process_changes (
  id                 bigint generated always as identity primary key,
  client_tag         text,
  summary            text        not null,
  transcript_path    text        not null,
  transcript_format  text        not null default 'md'
                       check (transcript_format in ('jsonl','md')),
  written_by         text        not null default 'claude',
  created_at         timestamptz not null default now()
);
create index if not exists process_changes_client_idx
  on topup.process_changes (client_tag, created_at desc);
```

Campaign-id gate trigger:

```sql
create or replace function topup.list_build_records_check_campaigns()
returns trigger language plpgsql as $$
declare missing int[];
begin
  select array_agg(c) into missing
  from unnest(new.campaign_ids) c
  where not exists (select 1 from public.campaigns p where p.id = c);
  if missing is not null then
    raise exception 'list_build_records: campaign ids % not in public.campaigns', missing;
  end if;
  return new;
end $$;
drop trigger if exists list_build_records_campaign_trg on topup.list_build_records;
create trigger list_build_records_campaign_trg
  before insert or update on topup.list_build_records
  for each row execute function topup.list_build_records_check_campaigns();
```

Private Storage bucket:

```sql
insert into storage.buckets (id, name, public)
values ('list-build-transcripts', 'list-build-transcripts', false)
on conflict (id) do nothing;
```

## Example insert

```sql
insert into topup.list_build_records (
  client_tag, campaign_ids, receipt_ids, lanes,
  narrative, transcript_path, transcript_format,
  spend_cents, yield_by_step, session_date
) values (
  'parlay', '{3847839,3847846}', '{512,513}', '{it_dm_tickets}',
  'Source was getleads only, LinkedIn-native lane. Sized first with job_functions + seniority (not short title lists, which undercount ~4x here), got ~5,700 in the real TAM. Pulled on IT DM titles, bands ["11 to 50","51 to 200"], countries ["United States"], email_status ["VALID"], max_per_company 3. VALID is a quality filter only; everything still went through Email Verifier Progression, so do not read the VALID count as the pool size. Rejected a widening to COO/CTO (ICP was corrected to IT DMs only in Aug). Held two banks/credit-union companies off the gift lane. Dead end: tried AI Ark people discovery on ~40 getleads company misses, titles came back wrong (first-person-at-domain problem), dropped them. Spend was the verifier only. Unsure: the ~5,700 TAM is soft, counted once.',
  'parlay/20261010_it_dm_tickets.jsonl', 'jsonl',
  650,
  '{"companies":null,"with_domain":400,"with_person":400,"with_email":400,"verified_sendable":385,"imported":380}'::jsonb,
  '2026-10-10'
);
```

Example process change (global):

```sql
insert into topup.process_changes (client_tag, summary, transcript_path, transcript_format) values (
  null,
  'ICP website gate now runs on every lead pull before anything paid. Label sets for every client live in icp-llm JEV_Q and topup.icp_variants; topup.gate_campaign_map maps campaign to variant. Full run Oct 12 2026 across 89 active campaigns, results in project doc claude/icp-gate-full-run-2026-10-12.md.',
  'global/20261012_icp_gate_full_run.md', 'md'
);
```