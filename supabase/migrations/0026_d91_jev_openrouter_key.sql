-- D91 — leftover AI reads the existing OpenRouter secret through a
-- security-definer function. leadtopup_app has no vault (SELECT of
-- vault.decrypted_secrets failed: permission denied for schema vault,
-- then for _crypto_aead_det_decrypt). icp-llm already uses this secret
-- inside the edge function. No new vendor.

create or replace function topup.jev_openrouter_key()
returns text
language sql
stable
security definer
set search_path = vault
as $$
  select decrypted_secret
    from vault.decrypted_secrets
   where name = 'openrouter_api_key'
   limit 1
$$;

revoke all on function topup.jev_openrouter_key() from public;
grant execute on function topup.jev_openrouter_key() to leadtopup_app;

revoke select on vault.decrypted_secrets from leadtopup_app;
revoke usage on schema vault from leadtopup_app;
