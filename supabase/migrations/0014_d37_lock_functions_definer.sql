-- D37: the Railway app role is not the owner of lp.* ingested tables.
-- install_lead_locks / ensure_lead_columns must run as the function owner
-- so boot can attach write locks without ALTER TABLE privileges.
-- Idempotent.

alter function topup.install_lead_locks() security definer;
alter function topup.ensure_lead_columns(text, text) security definer;
grant execute on function topup.install_lead_locks() to public;
grant execute on function topup.ensure_lead_columns(text, text) to public;
