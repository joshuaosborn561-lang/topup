-- D103 — top-ups find emails for the people an export names without one.
-- Project: azpapwtnrbzywlnxxecz.
--
-- The Email Finder Waterfall reads a job's needs_email rows from
-- lp.<tag>_ingested_leads by id and writes its result back through
-- public.ew_patch_source, which cannot carry app.run_id. The write lock
-- (0002) refuses every UPDATE on a lane table with an open run unless it
-- carries the run. This lets one kind of UPDATE through without it: one that
-- changes nothing but the finder's own result columns (wf_status, wf_email,
-- wf_email_status, wf_vendor, wf_updated_at, wf_phone, wf_phone_type).
-- Lead status, email, run_id and every other column still need the run.
-- The service copies a found address onto the row itself, under the run.

create or replace function topup.lead_write_lock()
returns trigger language plpgsql as $$
declare
  v_tag       text;
  v_run       text := current_setting('app.run_id', true);
  v_open      uuid[];
  v_campaign  bigint;
  v_finder    text[] := array['wf_status', 'wf_email', 'wf_email_status', 'wf_vendor', 'wf_updated_at', 'wf_phone', 'wf_phone_type'];
begin
  if tg_table_schema = 'lp' and tg_table_name like '%\_ingested\_leads' escape '\' then
    if tg_op = 'INSERT' then return new; end if;
    -- D103: the email finder's writeback touches only its own columns.
    if tg_op = 'UPDATE' and (to_jsonb(new) - v_finder) = (to_jsonb(old) - v_finder) then return new; end if;
    v_tag := left(tg_table_name, length(tg_table_name) - length('_ingested_leads'));
    select array_agg(run_id) into v_open from topup.runs where client_tag = v_tag and topup.run_is_open(status);
    if v_open is null then return coalesce(new, old); end if;
    if v_run is null or not (v_run::uuid = any(v_open)) then
      raise exception using errcode = 'P0001',
        message = format('topup write lock: %s.%s has an open top-up run (%s). Writes must carry app.run_id.', tg_table_schema, tg_table_name, array_to_string(v_open, ','));
    end if;
    return coalesce(new, old);
  end if;
  if tg_table_schema = 'public' and tg_table_name = 'leads_staging' and tg_op = 'INSERT' then
    v_campaign := new.campaign_id;
    select array_agg(run_id) into v_open from topup.runs where campaign_id = v_campaign and topup.run_is_open(status);
    if v_open is null then return new; end if;
    if v_run is null or not (v_run::uuid = any(v_open)) then
      raise exception using errcode = 'P0001',
        message = format('topup write lock: campaign %s has an open top-up run (%s). Staging must carry app.run_id.', v_campaign, array_to_string(v_open, ','));
    end if;
    return new;
  end if;
  return coalesce(new, old);
end $$;

-- The finder's result columns on every lane table, so its first writeback
-- never needs DDL (it would add them itself through ew_ensure_wf_writeback).
do $$
declare r record;
begin
  for r in select table_name from information_schema.tables where table_schema = 'lp' and table_name like '%\_ingested\_leads' escape '\' loop
    execute format('alter table lp.%I add column if not exists wf_status text, add column if not exists wf_email text, add column if not exists wf_email_status text, add column if not exists wf_vendor text, add column if not exists wf_updated_at timestamptz, add column if not exists wf_phone text, add column if not exists wf_phone_type text', r.table_name);
  end loop;
end $$;
