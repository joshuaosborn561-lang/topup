-- leadtopup: state schema. Project: azpapwtnrbzywlnxxecz (campaignintelligence).
-- Lead tables stay where they are (lp.*, client_*, public.leads_staging); this
-- schema holds run state, recipes, registry, spend, cards and reference data.
-- Idempotent: safe to re-run. Applied by `npm run migrate`.

create schema if not exists topup;

-- ---------------------------------------------------------------------------
-- Lane recipes: the only thing the service is allowed to execute.
-- Mirrored from recipes/<client_tag>/<lane>.json on deploy. Versioned.
-- ---------------------------------------------------------------------------
create table if not exists topup.lane_recipes (
  recipe_id        text primary key,
  client_tag       text not null,
  lane             text not null,
  version          int  not null default 1,
  body             jsonb not null,
  owner_approved_at timestamptz,
  loaded_at        timestamptz not null default now(),
  unique (client_tag, lane, version)
);

-- ---------------------------------------------------------------------------
-- Campaign registry: offer_key / gift_key drive suppression and attribution.
-- Defaults are parsed from the "Client Offer ICP Gift" name convention and
-- confirmed once by the owner on a card (confirmed_at).
-- ---------------------------------------------------------------------------
create table if not exists topup.campaign_registry (
  campaign_id          bigint primary key,
  campaign_name        text,
  client_tag           text not null,
  smartlead_client_id  bigint,
  lane                 text,
  recipe_id            text references topup.lane_recipes(recipe_id),
  offer_key            text,
  gift_key             text,
  mail_class           text check (mail_class in ('SEG','OTHER') or mail_class is null),
  band                 text,
  status               text,
  working_override     boolean,           -- owner /working on|off; null = computed
  confirmed_at         timestamptz,
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Runs and steps. One open run per (client_tag, lane) and one per campaign.
-- ---------------------------------------------------------------------------
create table if not exists topup.runs (
  run_id           uuid primary key default gen_random_uuid(),
  recipe_id        text not null references topup.lane_recipes(recipe_id),
  client_tag       text not null,
  lane             text not null,
  campaign_id      bigint,
  trigger          text not null check (trigger in ('runway','manual','scheduled')),
  status           text not null default 'open',
  current_step     text,
  counts_by_status jsonb not null default '{}'::jsonb,
  spend_cents_by_vendor jsonb not null default '{}'::jsonb,
  slack_channel    text,
  slack_thread_ts  text,
  opened_by        text,
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  last_error       text
);

-- A run is "open" until it reaches a terminal status.
create or replace function topup.run_is_open(s text) returns boolean
language sql immutable as $$
  select s not in ('done','failed','capacity_bound','not_working','pool_thin','declined','aborted')
$$;

-- One open run per lane and one per campaign, enforced in the database.
create unique index if not exists runs_one_open_per_lane
  on topup.runs (client_tag, lane) where topup.run_is_open(status);
create unique index if not exists runs_one_open_per_campaign
  on topup.runs (campaign_id) where campaign_id is not null and topup.run_is_open(status);

create table if not exists topup.run_steps (
  run_id           uuid not null references topup.runs(run_id) on delete cascade,
  step             text not null,
  status           text not null default 'pending',   -- pending|running|done|failed|parked|waiting_approval
  attempts         int  not null default 0,
  started_at       timestamptz,
  finished_at      timestamptz,
  vendor_job_id    text,
  worst_case_cents int,
  approved_cents   int,
  actual_cents     int,
  useful_output    int,
  counts           jsonb not null default '{}'::jsonb,
  last_error       text,
  primary key (run_id, step)
);

-- ---------------------------------------------------------------------------
-- Spend ledger: one row per vendor call. Month-to-date by client and vendor is
-- a query on this table, not a memory.
-- ---------------------------------------------------------------------------
create table if not exists topup.spend_ledger (
  id               bigserial primary key,
  run_id           uuid references topup.runs(run_id) on delete set null,
  client_tag       text,
  step             text not null,
  vendor           text not null,
  action           text not null,
  rows_submitted   int  not null default 0,
  credits          numeric,
  cents            int  not null,                 -- computed from topup price table, never a vendor field
  worst_case_cents int,
  balance_before   numeric,
  balance_after    numeric,
  vendor_job_id    text,
  approved_by      text,                          -- slack user id for over-cap approvals
  created_at       timestamptz not null default now()
);
create index if not exists spend_ledger_day on topup.spend_ledger (created_at);

-- ---------------------------------------------------------------------------
-- Cards: every Slack card with buttons has a row so a tap can be validated,
-- so /health can count open cards, and so a restart does not lose an ask.
-- ---------------------------------------------------------------------------
create table if not exists topup.cards (
  card_id          uuid primary key default gen_random_uuid(),
  run_id           uuid references topup.runs(run_id) on delete cascade,
  kind             text not null,     -- spend_approval|not_working|stall|qa_hold|segment_proposal|pending_campaign
  audience         text not null check (audience in ('owner','operator')),
  status           text not null default 'open',   -- open|resolved|expired
  payload          jsonb not null default '{}'::jsonb,
  slack_channel    text,
  slack_ts         text,
  resolved_by      text,
  resolution       text,
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  expires_at       timestamptz
);
create index if not exists cards_open on topup.cards (status) where status = 'open';

-- ---------------------------------------------------------------------------
-- Stall events: every verifier stall, resume, split and residue is recorded.
-- ---------------------------------------------------------------------------
create table if not exists topup.stall_events (
  id               bigserial primary key,
  run_id           uuid references topup.runs(run_id) on delete cascade,
  vendor_run_id    text,
  event            text not null,     -- stalled|resumed|split_asked|split|residue|zero_result_resume
  percent          int,
  verified         int,
  rows             int,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- QA rules as data. action: purge (silent, counted) | hold (card to operator)
-- | reroute (automatic, to another lane).
-- ---------------------------------------------------------------------------
create table if not exists topup.qa_rules (
  rule_id          text primary key,
  action           text not null check (action in ('purge','hold','reroute')),
  field            text not null,     -- title|company_name|industry|vertical|local_sports_team
  pattern          text not null,     -- case-insensitive regex
  scope            text,              -- client_tag, offer_key, or null for all
  reroute_to       text,
  reason           text,
  enabled          boolean not null default true
);

-- MX classifier cache (free DNS classification, shared across clients).
create table if not exists topup.mx_class (
  domain           text primary key,
  mx_host          text,
  mail_class       text not null,     -- seg|native_filter|direct|unknown
  gateway_provider text,
  checked_at       timestamptz not null default now()
);

-- Reference tables for the normalizers.
create table if not exists topup.ref_metro_names (
  city             text not null,
  state            text not null,
  conversational   text not null,     -- e.g. Naperville, IL -> Chicagoland
  primary key (city, state)
);

create table if not exists topup.ref_sports_teams (
  team             text not null,
  league           text not null,     -- NFL|NBA|MLB|NHL|MLS|NCAA
  metro            text not null,     -- conversational metro this team belongs to
  state            text,
  pro              boolean not null default true,
  primary key (team, league, metro)
);

create table if not exists topup.ref_acronyms (
  acronym          text primary key,  -- stays upper case even with vowels (ACFCU)
  note             text
);

create table if not exists topup.ref_ambiguous_nicknames (
  nickname         text primary key,  -- Cavaliers -> null team -> AirPods tier
  note             text
);

create table if not exists topup.ref_company_suffixes (
  suffix           text primary key,  -- Inc, LLC, Corp, ...
  strip            boolean not null default true
);

-- Missing-piece groups (hard ICP lanes) get a standing home now so the MCP
-- tool can read them; the service does not run them in Phase 1.
create table if not exists topup.missing_piece_groups (
  client_tag       text not null,
  lane             text not null,
  group_name       text not null,
  source_table     text not null,
  where_sql        text,
  missing          text not null,     -- domain|person|email
  next_method      text,
  count_sql        text,
  primary key (client_tag, lane, group_name)
);
