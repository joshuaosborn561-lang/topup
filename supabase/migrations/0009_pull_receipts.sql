-- leadtopup: first-pull receipts (D31).
--
-- Josh's first list for a campaign is built in Claude. The Smartlead mirror
-- then has the people but not the how. Claude writes one row here after that
-- first pull so this service can get more of the same people later.
-- Counts, ids, filters, and method names only. Never emails or lead rows.
-- Idempotent. Project: azpapwtnrbzywlnxxecz (campaignintelligence).

create schema if not exists topup;

create table if not exists topup.pull_receipts (
  receipt_id           uuid primary key default gen_random_uuid(),
  written_at           timestamptz not null default now(),
  written_by           text not null default 'claude',
  supabase_project     text not null default 'azpapwtnrbzywlnxxecz'
                       check (supabase_project = 'azpapwtnrbzywlnxxecz'),

  client_tag           text not null check (client_tag ~ '^[a-z][a-z0-9_]*$'),
  smartlead_client_id  bigint,
  lane                 text not null check (lane ~ '^[a-z][a-z0-9_]*$'),
  campaign_ids         bigint[] not null check (cardinality(campaign_ids) >= 1),

  icp_kind             text not null check (icp_kind in ('linkedin_native', 'physical')),
  persona              text not null check (persona ~ '^[a-z][a-z0-9_]*$'),

  company_source       text not null check (company_source in (
                         'getleads', 'maps', 'permits', 'maps_and_permits',
                         'parcels', 'ai_ark', 'table', 'other'
                       )),
  company_filters      jsonb not null default '{}'::jsonb,

  domain_source        text not null check (domain_source in (
                         'already', 'getleads', 'maps', 'domain_waterfall', 'none', 'other'
                       )),
  person_source        text not null check (person_source in (
                         'already', 'getleads', 'ai_ark', 'people_waterfall',
                         'serp', 'hard_to_find', 'none', 'other'
                       )),
  email_source         text not null check (email_source in (
                         'already', 'getleads', 'name_to_email', 'email_waterfall', 'none', 'other'
                       )),
  email_max_tier       text check (email_max_tier in (
                         'getleads', 'smartlead', 'aiark', 'leadmagic', 'prospeo', 'fullenrich'
                       )),

  rows_found           int,
  rows_imported        int,
  tam_count            int,
  how_i_did_it         text not null,
  notes                text
);

create index if not exists pull_receipts_client_lane_idx
  on topup.pull_receipts (client_tag, lane, written_at desc);
create index if not exists pull_receipts_campaigns_idx
  on topup.pull_receipts using gin (campaign_ids);

comment on table topup.pull_receipts is
  'D31: how Claude found the first list for a campaign. leadtopup repeats from the latest row. No lead payloads.';
