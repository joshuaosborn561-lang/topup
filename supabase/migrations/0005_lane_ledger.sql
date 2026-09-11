-- leadtopup: the lane ledger (addendum section 2 — "the service is the memory").
-- One state record per lane, an append-only event log, and a registry of
-- every queue table a lane feeds from, including hand-filled ones registered
-- from a Claude session over MCP. Counts and ids only; never lead rows.
-- Idempotent: safe to re-run. Applied by `npm run migrate`.

-- ---------------------------------------------------------------------------
-- Lane state: what stage the lane is in and since when, what the service
-- intends next, and anything it is blocked on that is not already a card.
-- (Cards are their own table; "blocked on Josh/Cayden" is derived from them.)
-- ---------------------------------------------------------------------------
create table if not exists topup.lane_state (
  client_tag         text not null,
  lane               text not null,
  stage              text not null default 'idle',
  stage_since        timestamptz not null default now(),
  run_id             uuid references topup.runs(run_id) on delete set null,
  next_intent        text,
  blocked_on         text check (blocked_on in ('vendor','server','client','owner','operator') or blocked_on is null),
  blocked_detail     text,                        -- what they need to do, one line
  blocked_since      timestamptz,
  digest_fingerprint text,                        -- what the last digest said about this lane
  digest_sent_at     timestamptz,
  updated_at         timestamptz not null default now(),
  primary key (client_tag, lane)
);

-- ---------------------------------------------------------------------------
-- Lane events: one line per thing that happened, with what the service
-- intends next. Written by the orchestrator, the stages, the console (cards)
-- and by Claude sessions over MCP (lane_note). Never deleted.
-- ---------------------------------------------------------------------------
create table if not exists topup.lane_events (
  id           bigserial primary key,
  client_tag   text not null,
  lane         text not null,
  run_id       uuid,
  event        text not null,                     -- run_opened|stage|card_opened|card_resolved|blocked|unblocked|note|digest|...
  line         text not null,                     -- plain English, one line, counts only
  next_intent  text,
  actor        text,                              -- slack user id, mcp:owner, service
  detail       jsonb not null default '{}'::jsonb,
  at           timestamptz not null default now()
);
create index if not exists lane_events_lane_at on topup.lane_events (client_tag, lane, at desc);

-- ---------------------------------------------------------------------------
-- Queue registry: every table a lane draws from, what each row in it is
-- still missing (domain, person, email, or nothing) and the next method that
-- fills it. Replaces topup.missing_piece_groups, which only held the
-- missing-piece case; existing rows are carried over and the old name stays
-- readable as a view.
-- ---------------------------------------------------------------------------
create table if not exists topup.queue_registry (
  client_tag       text not null,
  lane             text not null,
  queue_name       text not null,
  source_table     text not null,                 -- schema.table, validated by the service before any count
  where_sql        text,                          -- optional predicate; run read-only with a statement timeout
  missing          text not null default 'none' check (missing in ('domain','person','email','none')),
  next_method      text,                          -- e.g. domain_waterfall, people_waterfall, name_to_email, email_waterfall, verify
  note             text,
  registered_by    text,
  registered_at    timestamptz not null default now(),
  last_count       int,
  last_counted_at  timestamptz,
  active           boolean not null default true,
  primary key (client_tag, lane, queue_name)
);

do $$
begin
  if to_regclass('topup.missing_piece_groups') is not null
     and (select relkind from pg_class where oid = to_regclass('topup.missing_piece_groups')) = 'r' then
    insert into topup.queue_registry (client_tag, lane, queue_name, source_table, where_sql, missing, next_method, registered_by)
      select client_tag, lane, group_name, source_table, where_sql, missing, next_method, 'migration 0005'
      from topup.missing_piece_groups
      on conflict do nothing;
    drop table topup.missing_piece_groups;
  end if;
end $$;

create or replace view topup.missing_piece_groups as
  select client_tag, lane, queue_name as group_name, source_table, where_sql, missing, next_method,
         last_count, last_counted_at
  from topup.queue_registry
  where active and missing <> 'none';
