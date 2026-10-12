-- D81: store unsubscribe vs not_interested on the lead store.
-- Unapplied until Josh says so. Never writes dl_status, sg_exclude, or skip_*.
-- Counts and ids only. Does not unsuppress anything in Smartlead.

do $$
begin
  if to_regclass('public.leads') is not null then
    alter table public.leads add column if not exists negative_class text;
    alter table public.leads add column if not exists negative_class_source text;
    alter table public.leads add column if not exists negative_classed_at timestamptz;
    alter table public.leads drop constraint if exists leads_negative_class_chk;
    alter table public.leads add constraint leads_negative_class_chk
      check (negative_class is null or negative_class in ('unsubscribe', 'not_interested'));
    create index if not exists leads_negative_class_idx
      on public.leads (smartlead_client_id, negative_class)
      where negative_class is not null;
  end if;
end $$;

-- Future negatives: classify on arrival from text / category / status. No AI.
create or replace function topup.classify_negative_lead()
returns trigger
language plpgsql
as $$
declare
  body text := '';
  cls text;
  src text;
begin
  if NEW.email is null then
    return NEW;
  end if;
  if NEW.negative_class is not null then
    return NEW;
  end if;
  if not (
    NEW.category_id in (3, 4)
    or lower(coalesce(NEW.status, '')) = 'unsubscribed'
  ) then
    return NEW;
  end if;
  if to_regclass('public.messages') is not null then
    select lower(coalesce(m.body, '')) into body
      from public.messages m
     where m.lead_id = NEW.id and m.direction = 'inbound'
     order by coalesce(m.received_at, m.sent_at, m.created_at) desc
     limit 1;
  end if;
  body := coalesce(body, '');
  if lower(coalesce(NEW.status, '')) = 'unsubscribed' then
    cls := 'unsubscribe'; src := 'status';
  elsif body ~ 'unsubscrib|take me off|remove me|opt[[:space:]_-]*out|stop (email|contact|send)|do not (contact|email)|don''t (contact|email)|never (email|contact)|leave me alone' then
    cls := 'unsubscribe'; src := 'text';
  elsif body ~ 'not interested|no thanks|no thank you|not a (good )?fit|already have|not right now|no need|don''t need' then
    cls := 'not_interested'; src := 'text';
  elsif lower(coalesce(NEW.category, '')) ~ 'unsubscrib|remove[[:space:]_-]*me|opt[[:space:]_-]*out|take me off' then
    cls := 'unsubscribe'; src := 'category';
  elsif NEW.category_id = 3 then
    cls := 'not_interested'; src := 'category';
  else
    return NEW;
  end if;
  NEW.negative_class := cls;
  NEW.negative_class_source := src;
  NEW.negative_classed_at := now();
  return NEW;
end;
$$;

drop trigger if exists leads_classify_negative on public.leads;
do $$
begin
  if to_regclass('public.leads') is not null then
    create trigger leads_classify_negative
      before insert or update of category_id, category, status
      on public.leads
      for each row
      execute function topup.classify_negative_lead();
  end if;
end $$;

create or replace function topup.classify_on_inbound_message()
returns trigger
language plpgsql
as $$
begin
  if NEW.direction is distinct from 'inbound' or NEW.lead_id is null then
    return NEW;
  end if;
  if to_regclass('public.leads') is null then
    return NEW;
  end if;
  update public.leads l
     set category = l.category
   where l.id = NEW.lead_id
     and l.negative_class is null
     and (l.category_id in (3, 4) or lower(coalesce(l.status, '')) = 'unsubscribed');
  return NEW;
end;
$$;

drop trigger if exists messages_classify_negative on public.messages;
do $$
begin
  if to_regclass('public.messages') is not null then
    create trigger messages_classify_negative
      after insert or update of body, direction
      on public.messages
      for each row
      execute function topup.classify_on_inbound_message();
  end if;
end $$;

-- Views use only the unsubscribe class (plus the existing DNC list on master).
create or replace view public.v_master_suppression as
  select lower(l.email) as email, 'unsubscribe'::text as reason
    from public.leads l
   where l.email is not null and l.negative_class = 'unsubscribe'
  union
  select lower(s.email), coalesce(s.reason, 'suppression_list')
    from public.suppression s
   where s.email is not null;

do $$
begin
  if to_regclass('lp.reply_suppression') is not null
     and exists (
       select 1 from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'lp' and c.relname = 'reply_suppression' and c.relkind = 'r'
     ) then
    alter table lp.reply_suppression rename to reply_suppression_pre_d81;
  end if;
end $$;

create or replace view lp.reply_suppression as
  select lower(l.email) as email,
         'unsubscribe'::text as category,
         coalesce(l.negative_classed_at, now()) as built_at
    from public.leads l
   where l.email is not null and l.negative_class = 'unsubscribe';

create or replace view public.response_based_v1 as
  select lower(l.email) as email, 'unsubscribe'::text as reason
    from public.leads l
   where l.email is not null and l.negative_class = 'unsubscribe';
