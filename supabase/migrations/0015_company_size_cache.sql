-- D38: durable company_size bands by domain.
-- public.leads.company_size is often blank on the Smartlead mirror; the
-- hourly sync can wipe a fill. Cache is the source of truth and is
-- reapplied onto the campaign's leads before a run sizes or pulls.

create table if not exists topup.company_size_cache (
  domain         text primary key
                 check (domain ~ '^[a-z0-9.-]+$' and domain like '%.%'),
  company_size   text not null
                 check (company_size in (
                   '1 to 10', '11 to 50', '51 to 200', '201 to 500',
                   '501 to 1000', '1001 to 5000', '5001 to 10000', '10001+'
                 )),
  source         text not null default 'getleads_count',
  updated_at     timestamptz not null default now()
);

comment on table topup.company_size_cache is
  'D38: getleads band for a company domain. Reapplied onto public.leads when company_size is blank.';
