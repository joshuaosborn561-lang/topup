-- D39: infer the segment from Supabase. Receipt + outcome is the recipe.
-- Project: azpapwtnrbzywlnxxecz (campaignintelligence). Confirm before apply.
-- Additive and idempotent.

create schema if not exists topup;

-- ---------------------------------------------------------------------------
-- Receipt columns the reasoner and the next write need
-- ---------------------------------------------------------------------------
alter table topup.pull_receipts add column if not exists josh_confirmed boolean not null default false;
alter table topup.pull_receipts add column if not exists basis_receipt_ids uuid[] not null default '{}';

comment on column topup.pull_receipts.josh_confirmed is
  'Josh tapped confirm on this receipt card. Backfill reconstructions start false.';
comment on column topup.pull_receipts.basis_receipt_ids is
  'Receipts this pull repeated or widened from. Written by leadtopup at step 11.5.';

-- ---------------------------------------------------------------------------
-- Exclusion table: the only handwritten ICP that survives as data
-- ---------------------------------------------------------------------------
create table if not exists topup.lane_exclusions (
  id uuid primary key default gen_random_uuid(),
  client_tag text not null,
  lane text,
  kind text not null check (kind in (
    'title','title_pattern','band','industry','company','brand','geo','source','persona','lane'
  )),
  value text not null,
  reason text not null,
  decided_on date not null,
  decided_by text not null default 'josh',
  active boolean not null default true
);

create index if not exists lane_exclusions_client_idx
  on topup.lane_exclusions (client_tag, lane, active);

comment on table topup.lane_exclusions is
  'D39 negatives history cannot teach. Reasoner sees them; executor enforces them. client_tag = all means every client.';

insert into topup.lane_exclusions (client_tag, lane, kind, value, reason, decided_on)
select * from (values
  ('goliath', null, 'persona', 'csuite', 'Dave rejected C suite, IT DM only', date '2026-08-01'),
  ('goliath', null, 'title_pattern', 'IT Manager', 'excluded every band', date '2026-08-18'),
  ('goliath', null, 'band', 'over 1000', 'Josh rejected widening past 1000', date '2026-08-16'),
  ('goliath', 'education_it_dm', 'source', 'college_teams', 'pro teams only on education', date '2026-08-17'),
  ('goliath', 'mfg_defense_it_dm', 'source', 'broad_industry', 'lookalikes of seed customers only', date '2026-08-01'),
  ('parlay', null, 'title', 'CTO', 'Parlay IT DM list does not include CTO', date '2026-08-01'),
  ('parlay', null, 'title', 'COO', 'only when a company has no named IT DM; executor: max one COO per company and only where no IT title landed', date '2026-08-01'),
  ('bcp', 'pe_firms', 'title_pattern', 'Associate|Analyst|Vice President|Fellow|Student', 'PE lane never includes juniors', date '2026-09-03'),
  ('vasco', null, 'brand', 'Kia', 'Carlos never named it', date '2026-08-18'),
  ('vasco', null, 'brand', 'Toyota|Lexus|Volvo|Tesla|BMW|Mercedes', 'not serviceable', date '2026-08-13'),
  ('vasco', null, 'source', 'getleads', 'structurally zero on rooftops', date '2026-08-18'),
  ('insight', null, 'industry', 'SLED', 'no state / local / education / federal', date '2026-09-09'),
  ('insight', null, 'title_pattern', 'Manager', 'managers only under 500; executor applies the existing SQL', date '2026-09-09'),
  ('peterson_earthworks', null, 'persona', 'general_business', 'lane F dropped as out of ICP', date '2026-09-14'),
  ('peterson_earthworks', null, 'source', 'getleads', '0 for 104 plus', date '2026-09-14'),
  ('salesglider', null, 'band', 'under 11', '11 plus every lane except pe_deal_origination which allows 5 plus', date '2026-08-01'),
  ('salesglider', 'financial_advisors', 'lane', 'dead', 'financial advisors lane is dead', date '2026-08-01'),
  ('all', null, 'source', 'PDL', 'banned vendor', date '2026-08-01'),
  ('all', null, 'source', 'BillionVerifier', 'banned vendor', date '2026-08-01'),
  ('all', null, 'source', 'Clay', 'banned vendor', date '2026-08-01'),
  ('all', null, 'source', 'Hunter', 'banned vendor', date '2026-08-01'),
  ('all', null, 'source', 'detect_job_change', 'banned action; bills on every call', date '2026-08-01')
) as v(client_tag, lane, kind, value, reason, decided_on)
where not exists (
  select 1 from topup.lane_exclusions e
  where e.client_tag = v.client_tag
    and e.kind = v.kind
    and e.value = v.value
    and e.lane is not distinct from v.lane
);

-- ---------------------------------------------------------------------------
-- Reasoning log: /where replays the last call in three lines
-- ---------------------------------------------------------------------------
create table if not exists topup.run_reasoning (
  id uuid primary key default gen_random_uuid(),
  run_id uuid,
  client_tag text not null,
  lane text not null,
  written_at timestamptz not null default now(),
  prompt_hash text,
  tool_calls jsonb not null default '[]'::jsonb,
  proposal jsonb,
  validation jsonb,
  tap text,
  dry_run boolean not null default false
);

create index if not exists run_reasoning_lane_idx
  on topup.run_reasoning (client_tag, lane, written_at desc);

comment on table topup.run_reasoning is
  'D39: every reasoning call in full. /where reads the last row: what it looked at, what it proposed, what happened.';

-- ---------------------------------------------------------------------------
-- Outcome per receipt (campaign-level; build-level email restrict is optional)
-- ---------------------------------------------------------------------------
create or replace function topup.compute_receipt_outcome(p_receipt_id uuid)
returns table (
  receipt_id uuid,
  sends int,
  interested int,
  bounces int,
  bounce_rate numeric,
  interested_per_2000 numeric,
  variant_repeat boolean,
  verdict text,
  josh_confirmed boolean
)
language plpgsql
stable
as $$
declare
  r record;
  v_sends int := 0;
  v_interested int := 0;
  v_bounces int := 0;
  v_rate numeric := 0;
  v_bounce numeric := 0;
  v_variant boolean := false;
  v_verdict text := 'unknown';
begin
  select * into r from topup.pull_receipts where topup.pull_receipts.receipt_id = p_receipt_id;
  if not found then
    return;
  end if;

  if cardinality(coalesce(r.campaign_ids, '{}')) > 0
     and to_regclass('public.sends') is not null
     and to_regclass('public.campaigns') is not null then
    select
      count(*) filter (where s.sent)::int,
      count(*) filter (where s.sent and s.lead_category_id in (1, 2, 131482))::int,
      count(*) filter (where coalesce(s.bounced, false))::int
    into v_sends, v_interested, v_bounces
    from public.campaigns c
    join public.sends s on s.campaign_id = c.id
    where c.smartlead_campaign_id = any(r.campaign_ids);

    if to_regclass('public.sequence_steps') is not null then
      select exists (
        select 1
        from (
          select
            count(*) filter (where s.sent) as vsends,
            count(*) filter (where s.sent and s.lead_category_id in (1, 2, 131482)) as vinterested
          from public.campaigns c
          join public.sends s on s.campaign_id = c.id
          left join public.sequence_steps ss on ss.id = s.sequence_step_id
          where c.smartlead_campaign_id = any(r.campaign_ids)
          group by coalesce(ss.variant_label, 'step ' || coalesce(s.step_number, ss.step_number)::text)
        ) v
        where v.vsends >= 1000 and (v.vinterested::numeric / v.vsends) * 2000 >= 1
      ) into v_variant;
    end if;
  end if;

  v_rate := case when v_sends = 0 then 0 else (v_interested::numeric / v_sends) * 2000 end;
  v_bounce := case when v_sends = 0 then 0 else v_bounces::numeric / v_sends end;

  if v_bounce > 0.08 then
    v_verdict := 'avoid';
  elsif v_sends >= 2000 and v_interested = 0 then
    v_verdict := 'avoid';
  elsif (v_sends >= 2000 and v_rate >= 1) or coalesce(v_variant, false) then
    v_verdict := 'repeat';
  else
    v_verdict := 'unknown';
  end if;

  receipt_id := p_receipt_id;
  sends := v_sends;
  interested := v_interested;
  bounces := v_bounces;
  bounce_rate := round(v_bounce, 4);
  interested_per_2000 := round(v_rate, 2);
  variant_repeat := coalesce(v_variant, false);
  verdict := v_verdict;
  josh_confirmed := coalesce(r.josh_confirmed, false);
  return next;
end
$$;

create or replace view topup.v_receipt_outcome as
select o.receipt_id,
       o.sends,
       o.interested,
       o.bounces,
       o.bounce_rate,
       o.interested_per_2000,
       o.variant_repeat,
       o.verdict,
       o.josh_confirmed
  from topup.pull_receipts r
  cross join lateral topup.compute_receipt_outcome(r.receipt_id) o;

comment on view topup.v_receipt_outcome is
  'D39: sends / interested / bounce / verdict per receipt. Lane rows use all leads in the named campaigns. Avoid wins on bounce_rate > 8%.';

-- ---------------------------------------------------------------------------
-- Runway per campaign named on a receipt
-- ---------------------------------------------------------------------------
create or replace view topup.v_lane_runway as
with named as (
  select distinct r.client_tag, r.lane, cid as campaign_id
    from topup.pull_receipts r
    cross join lateral unnest(coalesce(r.campaign_ids, '{}'::bigint[])) as cid
),
c as (
  select n.client_tag, n.lane, n.campaign_id,
         cam.id as campaign_pk, cam.name, cam.status
    from named n
    join public.campaigns cam on cam.smartlead_campaign_id = n.campaign_id
),
l as (
  select c.campaign_id,
         count(*)::int as leads_total,
         count(*) filter (where not exists (
           select 1 from public.sends s where s.lead_id = ld.id and s.sent
         ))::int as untouched
    from c
    join public.leads ld on ld.campaign_id = c.campaign_pk
   group by 1
),
s as (
  select c.campaign_id,
         count(*) filter (where se.sent and se.sent_at >= now() - interval '7 days')::int as sends_7d
    from c
    join public.sends se on se.campaign_id = c.campaign_pk
   group by 1
)
select c.client_tag,
       c.lane,
       c.campaign_id,
       c.name,
       c.status,
       coalesce(l.leads_total, 0) as leads_total,
       coalesce(l.untouched, 0) as untouched,
       coalesce(s.sends_7d, 0) as sends_7d,
       case when coalesce(s.sends_7d, 0) > 0 then round(s.sends_7d / 7.0, 2) else null end as daily_send_rate,
       case
         when coalesce(s.sends_7d, 0) > 0
           then round((coalesce(l.untouched, 0)::numeric / (s.sends_7d / 7.0)), 1)
         else null
       end as days_remaining
  from c
  left join l on l.campaign_id = c.campaign_id
  left join s on s.campaign_id = c.campaign_id;

comment on view topup.v_lane_runway is
  'D39: untouched leads and days remaining from the Smartlead mirror. Daily rate is sends/7; wizard ceiling is not in this database.';

-- ---------------------------------------------------------------------------
-- Unloaded inventory for a lane (own tables, free)
-- ---------------------------------------------------------------------------
create or replace function topup.unloaded_inventory(p_client text, p_lane text)
returns table (
  source_table text,
  n int,
  note text
)
language plpgsql
stable
as $$
declare
  ids bigint[];
  n_gc int := 0;
  n_empty int := 0;
begin
  select coalesce((
    select r.campaign_ids
      from topup.pull_receipts r
     where r.client_tag = p_client and r.lane = p_lane
     order by (r.granularity = 'lane') desc, r.written_at desc
     limit 1
  ), '{}') into ids;

  if p_client = 'peterson' and p_lane = 'c1_general_contractors' and to_regclass('gc.contacts') is not null then
    select count(*)::int into n_gc
      from gc.contacts g
     where nullif(trim(g.email), '') is not null
       and upper(coalesce(g.email_status, '')) in ('VALID', 'OK', 'GOOD', 'VERIFIED')
       and not exists (
         select 1
           from public.leads ld
           join public.campaigns cam on cam.id = ld.campaign_id
          where lower(ld.email) = lower(g.email)
            and cam.smartlead_campaign_id = any(ids)
       );
    if n_gc > 0 then
      source_table := 'gc.contacts';
      n := n_gc;
      note := 'verified GC contacts not in this lane''s campaigns';
      return next;
    end if;
  end if;

  select coalesce(sum(r.rows_found), 0)::int into n_empty
    from topup.pull_receipts r
   where r.client_tag = p_client
     and r.lane = p_lane
     and r.granularity = 'build'
     and cardinality(coalesce(r.campaign_ids, '{}')) = 0
     and r.rows_found is not null
     and r.rows_found > 0;

  if n_empty > 0 then
    source_table := 'topup.pull_receipts';
    n := n_empty;
    note := 'build receipts with empty campaign_ids (pulled, never loaded)';
    return next;
  end if;
end
$$;

comment on function topup.unloaded_inventory(text, text) is
  'D39: free first option. Peterson C1 is gc.contacts not yet in the lane campaigns. Empty-campaign_ids builds are inventory everywhere.';
