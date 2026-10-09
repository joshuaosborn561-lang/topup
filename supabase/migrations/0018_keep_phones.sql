-- D56: phones are kept. Every lane table carries phone / phone_type (what
-- the service keeps) and wf_phone / wf_phone_type (what the domain and
-- email waterfalls write back), and public.leads_staging carries phone and
-- phone_type so the Smartlead import can pass phone_number. Nothing here
-- drops a column. Re-declares topup.ensure_lead_columns from 0002 with the
-- four new columns, then runs the installer so every current lane table
-- gets them; tables LeadPipe provisions later get them at the next boot.
create or replace function topup.ensure_lead_columns(p_schema text, p_table text)
returns void language plpgsql as $$
declare
  q text;
begin
  q := format('alter table %I.%I
      add column if not exists lead_status text not null default ''ingested'',
      add column if not exists run_id uuid,
      add column if not exists mv_status text,
      add column if not exists n2b_status text,
      add column if not exists mail_class text,
      add column if not exists verify_path text,
      add column if not exists ev_status text,
      add column if not exists verify_run_id text,
      add column if not exists verify_batch text,
      add column if not exists verified_at timestamptz,
      add column if not exists city text,
      add column if not exists state text,
      add column if not exists first_name_n text,
      add column if not exists company_n text,
      add column if not exists location text,
      add column if not exists local_sports_team text,
      add column if not exists company_size text,
      add column if not exists vertical text,
      add column if not exists normalize_flags jsonb,
      add column if not exists normalized_at timestamptz,
      add column if not exists qa_flags jsonb,
      add column if not exists routed_campaign_id bigint,
      add column if not exists status_changed_at timestamptz,
      add column if not exists phone text,
      add column if not exists phone_type text,
      add column if not exists wf_phone text,
      add column if not exists wf_phone_type text',
    p_schema, p_table);
  execute q;
  execute format('create index if not exists %I on %I.%I (lead_status)',
    p_table || '_lead_status_idx', p_schema, p_table);
  execute format('create index if not exists %I on %I.%I (run_id)',
    p_table || '_run_id_idx', p_schema, p_table);
  execute format('create index if not exists %I on %I.%I (verify_batch)',
    p_table || '_verify_batch_idx', p_schema, p_table);
end $$;

alter table public.leads_staging
  add column if not exists phone text,
  add column if not exists phone_type text;

select topup.install_lead_locks();
