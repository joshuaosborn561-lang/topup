-- icp_kind on campaign_registry. non_linkedin clients size from the original
-- Maps or permits pool. Everyone else is linkedin_native. Idempotent.

alter table topup.campaign_registry add column if not exists icp_kind text;

update topup.campaign_registry
   set icp_kind = 'non_linkedin'
 where icp_kind is null
   and client_tag in ('peterson', 'peterson_earthworks', 'emcor', 'vector_energy', 'deep_roots');

update topup.campaign_registry
   set icp_kind = 'linkedin_native'
 where icp_kind is null;
