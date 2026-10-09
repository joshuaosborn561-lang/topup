-- D63: stage carries the per-lead excluded-inbox list, the named-seat
-- POD (A/B), and any generic seats. Additive.
-- Never writes dl_status, sg_exclude, or skip_*.

do $$
begin
  if to_regclass('public.leads_staging') is not null then
    alter table public.leads_staging
      add column if not exists excluded_inboxes text[],
      add column if not exists excluded_pods text[],
      add column if not exists excluded_generic_inboxes text[];
  end if;
end $$;
