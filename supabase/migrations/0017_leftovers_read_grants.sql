-- D55: the leftovers read counts rows in each client's schema
-- (client_<tag>.companies / contacts / leads). The service role
-- leadtopup_app had SELECT on lp and public only. Grant USAGE on every
-- client_% schema and SELECT on its tables, and default SELECT for tables
-- postgres creates there later. A client schema created after this
-- migration by another role needs the grant run again. Read only; the
-- service never writes to a client schema.
do $$
declare s record;
begin
  for s in select nspname from pg_namespace where nspname like 'client\_%' escape '\' loop
    execute format('grant usage on schema %I to leadtopup_app', s.nspname);
    execute format('grant select on all tables in schema %I to leadtopup_app', s.nspname);
    execute format('alter default privileges for role postgres in schema %I grant select on tables to leadtopup_app', s.nspname);
  end loop;
end $$;
