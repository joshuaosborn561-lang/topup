-- D72: the people question of site_check crawls the site itself. The
-- fetched people pages live in topup.site_people_text (one row per domain,
-- claimed by the site-people edge function), the people a site presents in
-- topup.site_people (Gemini extraction, one row per domain per person), one
-- extraction row per domain in topup.site_extractions (so "nobody on the
-- site" is remembered and never re-paid), and Jev's pick per domain and
-- question in topup.site_answers. topup.site_people_found is the view a
-- table pull reads (first_name, last_name, title, domain, source_url).
-- D71's held-name queue (topup.site_check_people) was never written and is
-- retired; dropping it is Josh's call (a later migration). The service
-- inserts domains and reads counts; names move Postgres → edge function →
-- model and never back to the service.

create table if not exists topup.site_people_text (
  domain text primary key,
  batch text not null,
  http_status integer,
  final_url text,
  pages integer,
  chars integer,
  body text,
  error text,
  fetched_at timestamptz
);
create index if not exists site_people_text_batch_idx on topup.site_people_text (batch) where http_status is null or http_status = -1;

create table if not exists topup.site_people (
  domain text not null,
  person_key text not null,
  full_name text not null,
  title text,
  evidence text,
  page_url text,
  model text,
  extracted_at timestamptz not null default now(),
  primary key (domain, person_key)
);

create table if not exists topup.site_extractions (
  domain text primary key,
  model text,
  people integer,
  in_tok integer,
  out_tok integer,
  cost numeric,
  error text,
  extracted_at timestamptz not null default now()
);

create table if not exists topup.site_answers (
  domain text not null,
  question_key text not null,
  looking_for text not null,
  person_key text,
  prob numeric,
  model text,
  answers jsonb,
  in_tok integer,
  out_tok integer,
  cost numeric,
  error text,
  answered_at timestamptz not null default now(),
  primary key (domain, question_key)
);

create or replace view topup.site_people_found as
  select a.domain,
         a.domain as company_domain,
         a.question_key,
         a.looking_for,
         p.full_name,
         split_part(p.full_name, ' ', 1) as first_name,
         nullif(btrim(substr(p.full_name, length(split_part(p.full_name, ' ', 1)) + 1)), '') as last_name,
         p.title,
         p.page_url as source_url,
         a.prob,
         a.answered_at
    from topup.site_answers a
    join topup.site_people p on p.domain = a.domain and p.person_key = a.person_key
   where a.person_key is not null and a.error is null;

grant select, insert, update on topup.site_people_text to leadtopup_app;
grant select on topup.site_people, topup.site_extractions, topup.site_answers, topup.site_people_found to leadtopup_app;
