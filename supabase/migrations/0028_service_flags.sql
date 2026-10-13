-- The loads_paused switch as a table the app role can read and write
-- (it used to be created at boot by DDL the role is not allowed to run;
-- the service fell back to lane_events). Seeded from the last lane event.
create table if not exists topup.service_flags (
  flag text primary key,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
grant select, insert, update on topup.service_flags to leadtopup_app;
grant select, insert, update on topup.service_flags to service_role;
insert into topup.service_flags (flag, enabled, updated_by)
select 'loads_paused', coalesce((detail->>'on')::boolean, true), coalesce(actor, 'migration 0028')
  from topup.lane_events
 where client_tag = '_service' and lane = 'global' and event = 'loads_paused'
 order by at desc limit 1
on conflict (flag) do nothing;
insert into topup.service_flags (flag, enabled, updated_by) values ('loads_paused', true, 'migration 0028') on conflict (flag) do nothing;
