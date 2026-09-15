-- D34: lifetime prior contact, staging key backfill, empty-list flag,
-- tighter QA regexes, seed campaign_registry.offer_key from lane receipts.
-- Additive. Safe if objects already exist.

create table if not exists topup.client_domain_list_state (
  client_tag           text primary key,
  confirmed_empty_at   timestamptz,
  confirmed_empty_by   text
);

do $$
begin
  if to_regclass('public.leads_staging') is not null then
    -- Older copy wins. Delete exact (campaign, email) dups before filling
    -- the unique source_dedupe_key (two null keys would otherwise collide).
    delete from public.leads_staging a
     using public.leads_staging b
     where a.campaign_id is not null
       and a.email is not null
       and a.campaign_id = b.campaign_id
       and lower(a.email) = lower(b.email)
       and a.ctid > b.ctid;

    update public.leads_staging s
       set source_dedupe_key = md5(s.campaign_id::text || '|' || lower(s.email))
     where s.source_dedupe_key is null
       and s.campaign_id is not null
       and s.email is not null
       and not exists (
         select 1 from public.leads_staging o
          where o.source_dedupe_key = md5(s.campaign_id::text || '|' || lower(s.email))
       );

    begin
      execute 'create unique index if not exists leads_staging_campaign_email_key on public.leads_staging (campaign_id, lower(email)) where campaign_id is not null and email is not null';
    exception when others then
      raise notice 'leads_staging_campaign_email_key skipped: %', sqlerrm;
    end;
  end if;
end $$;

do $d34qa$
begin
  if to_regclass('topup.qa_rules') is null then
    raise notice 'd34: qa_rules missing — apply 0003 first';
    return;
  end if;
  update topup.qa_rules
     set pattern = '\y(school district|isd\y|public schools|elementary|middle school|high school|walmart|target (inc|corp|stores?|pharmacy)|costco|kroger|home depot|lowe''s|best buy|dollar general|7-eleven)\y'
   where rule_id = 'retail_school_purge';
  update topup.qa_rules
     set pattern = '\y(bank|bancorp|credit union|fcu\y|savings and loan|trust company|federal credit union|federal savings|federal reserve|county of|city of|state of|department of|u\.?s\.? government)\y'
   where rule_id = 'regulated_gift_hold';
end
$d34qa$;

do $d34$
begin
  if to_regclass('topup.campaign_registry') is null then
    raise notice 'd34: campaign_registry missing — apply 0001 first';
    return;
  end if;
  insert into topup.campaign_registry (campaign_id, client_tag, lane, offer_key, gift_key, updated_at)
  select
    x.cid,
    r.client_tag,
    r.lane,
    coalesce(nullif(r.segment->>'offer_key', ''), r.segment#>>'{offer_key,0}'),
    coalesce(nullif(r.segment->>'gift', ''), r.segment#>>'{gift,0}'),
    now()
  from topup.pull_receipts r
  cross join lateral unnest(r.campaign_ids) as x(cid)
  where r.granularity = 'lane'
  on conflict (campaign_id) do update set
    offer_key = coalesce(topup.campaign_registry.offer_key, excluded.offer_key),
    gift_key = coalesce(topup.campaign_registry.gift_key, excluded.gift_key),
    lane = coalesce(topup.campaign_registry.lane, excluded.lane),
    updated_at = now();

  update topup.campaign_registry cr
     set offer_key = case
           when cr.campaign_name ~* '\meos\m' then 'eos'
           when cr.campaign_name ~* 'trendrr' then 'trendrr'
           when cr.campaign_name ~* 'peterson' then 'peterson_roofing'
           else cr.offer_key
         end
   where cr.offer_key is null;
end
$d34$;

comment on table topup.client_domain_list_state is
  'D34: Josh confirmed this client has no customer domain list. Empty list may proceed only after this.';
