-- icp_kind per client. non_linkedin sizes from the original Maps or permits
-- pool. The app role may not own campaign_registry, so client_icp is the
-- table it can create. Idempotent.

alter table topup.campaign_registry add column if not exists icp_kind text;

update topup.campaign_registry
   set icp_kind = 'non_linkedin'
 where icp_kind is null
   and client_tag in ('peterson', 'peterson_earthworks', 'emcor', 'vector_energy', 'deep_roots');

update topup.campaign_registry
   set icp_kind = 'linkedin_native'
 where icp_kind is null;

create table if not exists topup.client_icp (
  client_tag text primary key,
  icp_kind text not null check (icp_kind in ('linkedin_native', 'non_linkedin'))
);

insert into topup.client_icp (client_tag, icp_kind)
select distinct client_tag,
       case
         when client_tag in ('peterson', 'peterson_earthworks', 'emcor', 'vector_energy', 'deep_roots') then 'non_linkedin'
         else 'linkedin_native'
       end
  from topup.campaign_registry
on conflict (client_tag) do nothing;
