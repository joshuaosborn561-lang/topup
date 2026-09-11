-- leadtopup: what steps 5 and 10 of skills/lead-list-build need in the database.
--
--   * Step 5: the client's own customer domain list ("must be applied before
--     anything loads, ask Cayden for it if missing"). One row per domain per
--     client; Cayden adds rows with the MCP tool add_client_domains. Empty
--     for a client whose recipe wants it = a card to Cayden and a halt.
--   * Step 10: public.leads_staging carries the columns the skill lists
--     ("job_title, company_size, vertical, location, local_sports_team,
--     first_name_n, company_n") and the dedupe key. Additive only.
--   * The one-pass suppression joins on lower(email) against the Smartlead
--     mirror and the suppression list; these expression indexes keep that a
--     lookup, not a scan. Additive; nothing is dropped.
-- Idempotent.

create table if not exists topup.client_domain_blocklist (
  client_tag  text not null,
  domain      text not null,
  added_by    text,
  note        text,
  added_at    timestamptz not null default now(),
  primary key (client_tag, domain),
  check (domain = lower(domain) and domain not like '%@%')
);

do $$
begin
  if to_regclass('public.leads_staging') is not null then
    alter table public.leads_staging
      add column if not exists first_name_n text,
      add column if not exists company_n text,
      add column if not exists job_title text,
      add column if not exists company_size text,
      add column if not exists vertical text,
      add column if not exists source_dedupe_key text,
      add column if not exists purge boolean default false,
      add column if not exists vendor text,
      add column if not exists run_id uuid;
    create unique index if not exists leads_staging_source_dedupe_key_key on public.leads_staging (source_dedupe_key);
    create index if not exists leads_staging_email_lower_idx on public.leads_staging (lower(email));
    create index if not exists leads_staging_run_id_idx on public.leads_staging (run_id) where run_id is not null;
  end if;
  if to_regclass('public.leads') is not null then
    create index if not exists leads_email_lower_idx on public.leads (lower(email));
  end if;
  if to_regclass('public.suppression') is not null then
    create index if not exists suppression_email_lower_idx on public.suppression (lower(email));
  end if;
end $$;
