-- D58 — LeadMagic drop, live recipe only.
-- Review only. Do NOT run from this PR, from migrate, or from a deploy.
-- Never touch pull_receipts, lead_provenance, or their CHECK constraints:
-- seven historical receipts still hold email_max_tier='leadmagic' and the
-- replay mapping in src/recipes/legacyLeadmagic.ts handles them.
-- Never touch dl_status, sg_exclude, or skip_*.

-- Live lane recipe that still has max_tier=leadmagic (the only latest
-- receipt that would replay it): vasco / signal_warranty_admin_hiring.
-- Maps the ceiling to aiark — the old spend boundary, minus the dead vendor.

update topup.lane_recipes
set body = jsonb_set(body, '{email_finding,max_tier}', '"aiark"'),
    updated_at = now()
where client_tag = 'vasco'
  and lane = 'signal_warranty_admin_hiring'
  and body->'email_finding'->>'max_tier' = 'leadmagic';

-- Optional, not requested this PR: emcor / e_small_ops also stores
-- max_tier=leadmagic but email_finding.enabled=false. Ask Josh before
-- touching it.
--
-- update topup.lane_recipes
-- set body = jsonb_set(body, '{email_finding,max_tier}', '"aiark"'),
--     updated_at = now()
-- where client_tag = 'emcor'
--   and lane = 'e_small_ops'
--   and body->'email_finding'->>'max_tier' = 'leadmagic';
