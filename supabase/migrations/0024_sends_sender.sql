-- D81: record the Smartlead inbox that sent each email on public.sends.
-- Unapplied until Josh says so. Never writes dl_status, sg_exclude, or skip_*.
-- Counts and ids only; no lead names.

do $$
begin
  if to_regclass('public.sends') is not null then
    alter table public.sends add column if not exists sender text;
    create index if not exists sends_missing_sender_idx
      on public.sends (campaign_id, lead_id)
      where sent and sender is null;
  end if;
end $$;

create table if not exists topup.sender_backfill (
  smartlead_campaign_id bigint primary key,
  pairs_seen integer not null default 0,
  pairs_written integer not null default 0,
  last_smartlead_lead_id bigint,
  status text not null default 'started',
  updated_at timestamptz not null default now()
);
