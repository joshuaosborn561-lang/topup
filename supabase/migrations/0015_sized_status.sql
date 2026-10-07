-- Size-only runs close as sized, which is terminal the same way done is.
-- loads_paused is one global flag. Idempotent. Safe to re-run.

create or replace function topup.run_is_open(s text) returns boolean
language sql immutable as $$
  select s not in ('done','failed','capacity_bound','not_working','pool_thin','declined','aborted','sized')
$$;

create table if not exists topup.service_flags (
  flag text primary key,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into topup.service_flags (flag, enabled)
values ('loads_paused', false)
on conflict (flag) do nothing;
