-- D67 — unapplied. Do not run against live until Josh says so.
--
-- People / email waterfalls page lp.<tag>_ingested_leads through
-- public.ew_read_source, which SELECTs a `domain` column and cannot
-- alias. The lane tables store the host as company_domain. This
-- one-time, non-destructive migration creates a read/write view in
-- `topup` for each existing lp.*_ingested_leads that has no domain
-- column: topup.<tag>_ingested_leads_ew (t.*, company_domain / email
-- host as domain).
--
-- No ALTER of a live lane table. No GRANT on schema lp. No runtime
-- CREATE/DROP from the service. A client added later needs another
-- view in this shape — ask Josh; do not CREATE from the app.

do $$
declare
  r record;
  view_name text;
  domain_expr text;
begin
  for r in
    select c.relname as tbl
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'lp'
       and c.relkind = 'r'
       and c.relname ~ '^[a-z][a-z0-9_]*_ingested_leads$'
     order by 1
  loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'lp' and table_name = r.tbl and column_name = 'domain'
    ) then
      continue;
    end if;
    view_name := r.tbl || '_ew';
    domain_expr := 'lower(coalesce('
      || case when exists (
           select 1 from information_schema.columns c
            where c.table_schema = 'lp' and c.table_name = r.tbl and c.column_name = 'company_domain'
         ) then 'nullif(btrim(t.company_domain), ''''), ' else '' end
      || case when exists (
           select 1 from information_schema.columns c
            where c.table_schema = 'lp' and c.table_name = r.tbl and c.column_name = 'website'
         ) then 'nullif(btrim(t.website), ''''), ' else '' end
      || case when exists (
           select 1 from information_schema.columns c
            where c.table_schema = 'lp' and c.table_name = r.tbl and c.column_name = 'email'
         ) then 'nullif(split_part(t.email, ''@'', 2), ''''), ' else '' end
      || 'null))';
    execute format(
      'create or replace view topup.%I as select t.*, %s as domain from lp.%I t',
      view_name, domain_expr, r.tbl
    );
    execute format(
      'comment on view topup.%I is %L',
      view_name,
      'D67: domain alias over lp.' || r.tbl || ' (company_domain / email host). Apply-once; no runtime DDL.'
    );
    execute format('grant select, update on topup.%I to leadtopup_app', view_name);
  end loop;
end $$;
