-- D66 — unapplied. Do not run against live until Josh says so.
--
-- People / email waterfalls page lp.<tag>_ingested_leads through
-- public.ew_read_source, which SELECTs a `domain` column. The lane table
-- stores the host as company_domain. This function creates a sibling view
-- that exposes domain without ALTER of the live client table.
--
-- The service also CREATE OR REPLACE VIEWs the same shape at call time
-- (src/stages/puzzle/ewSource.ts). This function is the durable copy.

create or replace function topup.ensure_ingested_ew_view(p_schema text, p_table text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  sch text;
  tbl text;
  view_name text;
  domain_expr text;
  has_domain boolean;
begin
  sch := lower(regexp_replace(coalesce(p_schema, ''), '[^a-z0-9_]', '', 'g'));
  tbl := lower(regexp_replace(coalesce(p_table, ''), '[^a-z0-9_]', '', 'g'));
  if sch = '' or tbl = '' or to_regclass(format('%I.%I', sch, tbl)) is null then
    raise exception 'unknown source table %.%', sch, tbl;
  end if;
  select exists (
    select 1 from information_schema.columns
     where table_schema = sch and table_name = tbl and column_name = 'domain'
  ) into has_domain;
  if has_domain then
    return format('%I.%I', sch, tbl);
  end if;
  view_name := tbl || '_ew';
  domain_expr := 'lower(coalesce('
    || case when exists (select 1 from information_schema.columns c where c.table_schema = sch and c.table_name = tbl and c.column_name = 'company_domain')
            then 'nullif(btrim(t.company_domain), ''''), ' else '' end
    || case when exists (select 1 from information_schema.columns c where c.table_schema = sch and c.table_name = tbl and c.column_name = 'website')
            then 'nullif(btrim(t.website), ''''), ' else '' end
    || case when exists (select 1 from information_schema.columns c where c.table_schema = sch and c.table_name = tbl and c.column_name = 'email')
            then 'nullif(split_part(t.email, ''@'', 2), ''''), ' else '' end
    || 'null))';
  execute format('drop view if exists %I.%I', sch, view_name);
  execute format(
    'create view %I.%I as select t.*, %s as domain from %I.%I t',
    sch, view_name, domain_expr, sch, tbl
  );
  return format('%I.%I', sch, view_name);
end;
$$;

comment on function topup.ensure_ingested_ew_view(text, text) is
  'D66: sibling view lp.<tag>_ingested_leads_ew exposing domain from company_domain. Unapplied until Josh says so.';
