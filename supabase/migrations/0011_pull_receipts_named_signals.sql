-- leadtopup: pull_receipts source vocabulary (D33).
-- Mirrors the live checks on campaignintelligence. Additive.
-- Never drop a column Claude wrote. `other` is not a value.

alter table topup.pull_receipts drop constraint if exists pull_receipts_company_source_check;
alter table topup.pull_receipts
  add constraint pull_receipts_company_source_check
  check (company_source in (
    'getleads', 'maps', 'permits', 'maps_and_permits', 'parcels', 'ai_ark', 'table',
    'serp_tool_mention', 'theirstack_tech_signal', 'linkedin_engagers', 'linkedin_import',
    'web_visitor_pixel', 'job_posting_signal', 'public_records'
  ));

alter table topup.pull_receipts drop constraint if exists pull_receipts_domain_source_check;
alter table topup.pull_receipts
  add constraint pull_receipts_domain_source_check
  check (domain_source in (
    'already', 'getleads', 'maps', 'domain_waterfall', 'theirstack', 'none'
  ));

alter table topup.pull_receipts drop constraint if exists pull_receipts_person_source_check;
alter table topup.pull_receipts
  add constraint pull_receipts_person_source_check
  check (person_source in (
    'already', 'getleads', 'ai_ark', 'people_waterfall',
    'serp', 'hard_to_find', 'leadmagic_employee_finder', 'none'
  ));

alter table topup.pull_receipts drop constraint if exists pull_receipts_email_source_check;
alter table topup.pull_receipts
  add constraint pull_receipts_email_source_check
  check (email_source in (
    'already', 'getleads', 'name_to_email', 'email_waterfall', 'none'
  ));

comment on column topup.pull_receipts.company_source is
  'Named source only. Signals carry rerun parameters in company_filters. There is no other.';
comment on column topup.pull_receipts.domain_source is
  'already / getleads / maps / domain_waterfall / theirstack / none. There is no other.';
comment on column topup.pull_receipts.person_source is
  'already / getleads / ai_ark / people_waterfall / serp / hard_to_find / leadmagic_employee_finder / none. There is no other.';
comment on column topup.pull_receipts.email_source is
  'already / getleads / name_to_email / email_waterfall / none. There is no other.';
