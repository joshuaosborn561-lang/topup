-- D60: the ICP gate is a verb. Every lane table carries the verdict
-- (icp_gate yes/no/unknown, icp_gate_label, icp_gate_at); flagged rows are
-- suppressed with a reason, never deleted. The per-client Jev variant and
-- DiscoLike ICP name live in topup.icp_variants, not in code. The service
-- role may insert and re-batch domains in client_salesglider.icp_site_text
-- (the edge functions do the fetching and grading) and read the results.
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
      add column if not exists wf_phone_type text,
      add column if not exists icp_gate text,
      add column if not exists icp_gate_label text,
      add column if not exists icp_gate_at timestamptz',
    p_schema, p_table);
  execute q;
  execute format('create index if not exists %I on %I.%I (lead_status)',
    p_table || '_lead_status_idx', p_schema, p_table);
  execute format('create index if not exists %I on %I.%I (run_id)',
    p_table || '_run_id_idx', p_schema, p_table);
  execute format('create index if not exists %I on %I.%I (verify_batch)',
    p_table || '_verify_batch_idx', p_schema, p_table);
end $$;

create table if not exists topup.icp_variants (
  client_tag text primary key,
  jev_variant text not null,
  disco_icp text,
  note text,
  updated_at timestamptz not null default now()
);

insert into topup.icp_variants (client_tag, jev_variant, disco_icp, note) values
  ('salesglider', 'choice', 'salesglider', 'commercial_trade_contractor passes (icp-website-gate, Oct 9 2026)'),
  ('emcor', 'emcor2', 'emcor', 'buyer_with_own_facility passes; v2 after v1 flagged 58%'),
  ('deep_roots', 'deeproots', 'deeproots', 'independent_manufacturer passes')
on conflict (client_tag) do nothing;

grant select on topup.icp_variants to leadtopup_app;
grant insert, update on client_salesglider.icp_site_text to leadtopup_app;

select topup.install_lead_locks();
