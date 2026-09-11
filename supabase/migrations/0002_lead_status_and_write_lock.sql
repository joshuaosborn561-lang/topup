-- leadtopup: per-lead status column, verify/normalize columns, and the write
-- lock that stops two sessions writing one lane at the same time.
--
-- Lock semantics (brief section 8, design 3.2):
--   * While a run is open for (client_tag, lane), UPDATE / DELETE on
--     lp.<client_tag>_ingested_leads must come from a session that has
--     `set local app.run_id = '<that run>'`. Anything else is rejected.
--   * While a run is open for a campaign_id, INSERT into public.leads_staging
--     for that campaign must come from that run's session. Staging the same
--     rows twice from two chats is how ~14k orphans were created.
--   * INSERT into ingested_leads is not yet guarded: LeadPipe's ingest_csv
--     writes those rows from its own connection during our run and does not
--     set app.run_id. That is a LeadPipe change (design 3.8). Until it lands,
--     the ingest collision is bounded by the one-open-run-per-lane index.
--   * UPDATE on leads_staging is not guarded because LeadPipe's
--     import_smartlead flips `imported` from its own connection.

-- Columns every lp.<tag>_ingested_leads table carries from now on.
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
      add column if not exists status_changed_at timestamptz',
    p_schema, p_table);
  execute q;
  execute format('create index if not exists %I on %I.%I (lead_status)',
    p_table || '_lead_status_idx', p_schema, p_table);
  execute format('create index if not exists %I on %I.%I (run_id)',
    p_table || '_run_id_idx', p_schema, p_table);
  execute format('create index if not exists %I on %I.%I (verify_batch)',
    p_table || '_verify_batch_idx', p_schema, p_table);
end $$;

-- The lock itself.
create or replace function topup.lead_write_lock()
returns trigger language plpgsql as $$
declare
  v_tag       text;
  v_run       text := current_setting('app.run_id', true);
  v_open      uuid[];
  v_campaign  bigint;
begin
  if tg_table_schema = 'lp' and tg_table_name like '%\_ingested\_leads' escape '\' then
    -- lp.<client_tag>_ingested_leads. INSERT passes (LeadPipe ingests from
    -- its own connection, see header); UPDATE / DELETE must carry the run.
    if tg_op = 'INSERT' then
      return new;
    end if;
    v_tag := left(tg_table_name, length(tg_table_name) - length('_ingested_leads'));
    select array_agg(run_id) into v_open
      from topup.runs where client_tag = v_tag and topup.run_is_open(status);
    if v_open is null then
      return coalesce(new, old);
    end if;
    if v_run is null or not (v_run::uuid = any(v_open)) then
      raise exception using
        errcode = 'P0001',
        message = format('topup write lock: %s.%s has an open top-up run (%s). Writes must carry app.run_id.',
                         tg_table_schema, tg_table_name, array_to_string(v_open, ',')),
        hint = 'Do not write this lane from chat while a run is open. Resume or abort the run from Slack.';
    end if;
    return coalesce(new, old);
  end if;

  if tg_table_schema = 'public' and tg_table_name = 'leads_staging' and tg_op = 'INSERT' then
    v_campaign := new.campaign_id;
    select array_agg(run_id) into v_open
      from topup.runs where campaign_id = v_campaign and topup.run_is_open(status);
    if v_open is null then
      return new;
    end if;
    if v_run is null or not (v_run::uuid = any(v_open)) then
      raise exception using
        errcode = 'P0001',
        message = format('topup write lock: campaign %s has an open top-up run (%s). Staging must carry app.run_id.',
                         v_campaign, array_to_string(v_open, ',')),
        hint = 'Do not stage into this campaign from chat while a run is open.';
    end if;
    return new;
  end if;

  return coalesce(new, old);
end $$;

-- Install columns + trigger on every current lp.*_ingested_leads table and on
-- public.leads_staging. Idempotent; the service calls it at boot so tables
-- LeadPipe provisions later are covered too.
create or replace function topup.install_lead_locks()
returns int language plpgsql as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select table_schema, table_name from information_schema.tables
    where table_schema = 'lp' and table_name like '%\_ingested\_leads' escape '\'
  loop
    perform topup.ensure_lead_columns(r.table_schema, r.table_name);
    execute format('drop trigger if exists topup_write_lock on %I.%I', r.table_schema, r.table_name);
    execute format('create trigger topup_write_lock before update or delete on %I.%I
                    for each row execute function topup.lead_write_lock()',
                   r.table_schema, r.table_name);
    n := n + 1;
  end loop;

  -- public.leads_staging belongs to LeadPipe; guard it when it exists.
  if to_regclass('public.leads_staging') is not null then
    alter table public.leads_staging
      add column if not exists company_size text,
      add column if not exists vertical text,
      add column if not exists verify_path text,
      add column if not exists run_id uuid;
    drop trigger if exists topup_write_lock on public.leads_staging;
    create trigger topup_write_lock before insert on public.leads_staging
      for each row execute function topup.lead_write_lock();
  end if;
  return n;
end $$;

select topup.install_lead_locks();
