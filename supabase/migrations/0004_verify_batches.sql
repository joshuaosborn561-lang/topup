-- leadtopup: verify batches. One row per file submitted to the verifier, so a
-- Railway restart mid-poll resumes exactly where it was, and a split is a
-- database fact rather than a memory. The verify_batch marker column on lead
-- rows is added by topup.ensure_lead_columns (0002).

create table if not exists topup.verify_batches (
  run_id           uuid not null references topup.runs(run_id) on delete cascade,
  batch            text not null,                 -- A0, A0.1, A0.2, A0.1.1 ...
  parent_batch     text,
  rows             int  not null,
  vendor_run_id    text,
  status           text not null default 'claimed', -- claimed|submitted|completed|split|residue|aborted
  submitted_at     timestamptz,
  last_progress_at timestamptz,
  last_percent     int  not null default 0,
  last_verified    int  not null default 0,
  resumes_used     int  not null default 0,
  worst_case_cents int,
  approved_cents   int,
  mv_credits_used  int,
  n2b_credits_used int,
  sendable         int,
  rejected         int,
  unresolved       int,
  finished_at      timestamptz,
  primary key (run_id, batch)
);
