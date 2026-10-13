-- D100 — living per-client playbook. A plain view over
-- topup.list_build_records and topup.process_changes, grouped by client_tag.
-- No job, no skill, no write, no spend. Appends to those tables show up
-- on the next SELECT. Project: azpapwtnrbzywlnxxecz.
-- Transcript links are storage object names in list-build-transcripts,
-- never a signed URL (D75). Disqualifications live in the written
-- narratives and process-change summaries; this view does not invent a
-- third table or a classifier.

create or replace view topup.client_playbook
with (security_invoker = true) as
with events as (
  select
    r.client_tag as owner_tag,
    false as applies_to_all,
    'list_build'::text as kind,
    r.id as source_id,
    r.created_at as at,
    r.session_date,
    r.campaign_ids,
    r.lanes,
    r.narrative as body,
    r.written_by,
    r.transcript_path,
    coalesce(
      r.transcript_paths,
      case
        when r.transcript_path is not null then array[r.transcript_path]
        else '{}'::text[]
      end
    ) as transcript_paths,
    r.transcript_format,
    r.spend_cents,
    r.yield_by_step,
    r.provenance_confidence,
    r.receipt_ids
  from topup.list_build_records r
  union all
  select
    p.client_tag,
    (p.client_tag is null or p.client_tag = 'all'),
    'process_change',
    p.id,
    p.created_at,
    (p.created_at at time zone 'utc')::date,
    '{}'::integer[],
    null::text[],
    p.summary,
    p.written_by,
    p.transcript_path,
    case
      when p.transcript_path is not null and p.transcript_path <> '' then array[p.transcript_path]
      else '{}'::text[]
    end,
    p.transcript_format,
    null::int,
    null::jsonb,
    null::text,
    null::uuid[]
  from topup.process_changes p
),
clients as (
  select distinct owner_tag as client_tag
    from events
   where owner_tag is not null
     and owner_tag <> 'all'
),
assigned as (
  select
    c.client_tag,
    e.kind,
    e.source_id,
    e.at,
    e.session_date,
    e.campaign_ids,
    e.lanes,
    e.body,
    e.written_by,
    e.transcript_path,
    e.transcript_paths,
    e.transcript_format,
    e.spend_cents,
    e.yield_by_step,
    e.provenance_confidence,
    e.receipt_ids,
    case when e.applies_to_all then 'all'::text else 'client'::text end as scope
  from clients c
  join events e
    on e.owner_tag = c.client_tag
    or e.applies_to_all
)
select
  a.client_tag,
  count(*) filter (where a.kind = 'list_build')::int as list_build_count,
  count(*) filter (where a.kind = 'process_change')::int as process_change_count,
  count(*)::int as event_count,
  min(a.at) as first_at,
  max(a.at) as last_at,
  jsonb_agg(
    jsonb_build_object(
      'kind', a.kind,
      'scope', a.scope,
      'source_id', a.source_id,
      'at', a.at,
      'session_date', a.session_date,
      'campaign_ids', to_jsonb(coalesce(a.campaign_ids, '{}'::integer[])),
      'lanes', to_jsonb(a.lanes),
      'body', a.body,
      'written_by', a.written_by,
      'transcript_bucket', 'list-build-transcripts',
      'transcript_path', a.transcript_path,
      'transcript_paths', to_jsonb(coalesce(a.transcript_paths, '{}'::text[])),
      'transcript_links', (
        select coalesce(jsonb_agg(('list-build-transcripts/' || p) order by p), '[]'::jsonb)
        from unnest(coalesce(a.transcript_paths, '{}'::text[])) p
        where p is not null and p <> '' and p not like '%://%' and p not like '%..%'
      ),
      'transcript_format', a.transcript_format,
      'spend_cents', a.spend_cents,
      'yield_by_step', a.yield_by_step,
      'provenance_confidence', a.provenance_confidence,
      'receipt_ids', to_jsonb(a.receipt_ids)
    )
    order by a.at, a.kind, a.source_id
  ) as timeline
from assigned a
group by a.client_tag;

comment on view topup.client_playbook is
  'D100: one living playbook per client_tag. List builds, disqualifications and method changes in chronological order, plus list-build-transcripts object names. Read-only. Ask Josh.';

revoke all on topup.client_playbook from public;
revoke all on topup.client_playbook from anon;
revoke all on topup.client_playbook from authenticated;
grant select on topup.client_playbook to leadtopup_app;
grant select on topup.client_playbook to service_role;
