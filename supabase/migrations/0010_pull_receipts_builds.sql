-- leadtopup: pull_receipts as Claude seeded them (D32).
-- Additive. Safe if the columns/trigger already exist on campaignintelligence.
-- Never drop a column Claude wrote.

alter table topup.pull_receipts add column if not exists segment jsonb;
alter table topup.pull_receipts add column if not exists yield_by_step jsonb;
alter table topup.pull_receipts add column if not exists spend_cents int;
alter table topup.pull_receipts add column if not exists suppression_scope text default 'response_based_v1';
alter table topup.pull_receipts add column if not exists build_label text;
alter table topup.pull_receipts add column if not exists granularity text default 'build';
alter table topup.pull_receipts add column if not exists owner_confirmed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pull_receipts_granularity_check') then
    alter table topup.pull_receipts
      add constraint pull_receipts_granularity_check
      check (granularity in ('build', 'lane'));
  end if;
end $$;

-- Empty campaign_ids is legal on a build that was pulled but never loaded.
alter table topup.pull_receipts drop constraint if exists pull_receipts_campaign_ids_check;
alter table topup.pull_receipts
  add constraint pull_receipts_campaign_ids_check
  check (cardinality(campaign_ids) >= 1 or granularity = 'build');

create index if not exists pull_receipts_build_idx
  on topup.pull_receipts (client_tag, lane, granularity, written_at desc);

create or replace function topup.pull_receipts_campaigns_exist()
returns trigger
language plpgsql
as $$
declare missing bigint[];
begin
  select array_agg(x) into missing from unnest(new.campaign_ids) x
   where not exists (select 1 from public.campaigns c where c.smartlead_campaign_id = x);
  if missing is not null then
    raise exception 'pull_receipts: campaign ids not in public.campaigns: %', missing;
  end if;
  return new;
end;
$$;

drop trigger if exists pull_receipts_campaigns_exist on topup.pull_receipts;
create trigger pull_receipts_campaigns_exist
  before insert or update on topup.pull_receipts
  for each row execute function topup.pull_receipts_campaigns_exist();

comment on column topup.pull_receipts.granularity is
  'lane = filter summary; build = one source_label/batch. Latest build with the best measured yield is what a top-up should propose.';
comment on column topup.pull_receipts.tam_count is
  'getleads count_contacts (or Maps/permit company count) at write time. Not the same as rows_found (the export/pull size).';
comment on column topup.pull_receipts.rows_found is
  'Rows this build actually produced. Do not treat as TAM.';
comment on column topup.pull_receipts.owner_confirmed_at is
  'Josh tapped confirm. Null + notes saying "Josh to confirm" means propose, do not scale.';
