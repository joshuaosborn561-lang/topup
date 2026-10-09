-- D63: stage carries the per-lead excluded-inbox list. Additive.
-- Never writes dl_status, sg_exclude, or skip_*.

do $$
begin
  if to_regclass('public.leads_staging') is not null then
    alter table public.leads_staging
      add column if not exists excluded_inboxes text[];
  end if;
end $$;
