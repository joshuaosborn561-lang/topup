-- D71: the website checker is a verb (site_check). The owners question is
-- asked per named person with the company's fetched site as context; the
-- queue and the verdict live here, keyed by client, domain and a hash of
-- the name, so a re-run never pays twice. Per-domain ICP verdicts stay in
-- client_salesglider.icp_llm_results. The icp-llm edge function (people
-- mode) reads the queue and writes the answer; the service inserts the
-- queue server side (insert … select) and reads counts by label. Names
-- never leave Postgres except to the edge function.
create table if not exists topup.site_check_people (
  client_tag text not null,
  domain text not null,
  person_key text not null,
  full_name text not null,
  title text,
  batch text not null,
  model text,
  choice text,
  prob numeric,
  answers jsonb,
  in_tok integer,
  out_tok integer,
  cost numeric,
  error text,
  queued_at timestamptz not null default now(),
  answered_at timestamptz,
  primary key (client_tag, domain, person_key)
);

create index if not exists site_check_people_batch_idx on topup.site_check_people (batch) where choice is null;

grant select, insert, update on topup.site_check_people to leadtopup_app;
