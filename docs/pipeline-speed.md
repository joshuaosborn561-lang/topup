# Pipeline speed (D111) — what landed, what to deploy

Goal: a SalesGlider client top-up (`lead-list-build`, 13 steps) in
about 30 minutes. This repo holds the skill text and the edge-function
patches. The email finder code lives in
`joshuaosborn561-lang/email-waterfall`.

Do not merge until Josh says to. Do not deploy edge functions from
this PR.

## What changed here (topup)

- Skills: `lead-list-build`, `icp-website-gate`, `grok-bot-babysitter`,
  `merge-field-qa`, `company-name-normalization`, `name-city-normalization`,
  `conversational-location`, `campaign-topup`, `site-people-dm`,
  `people-waterfall`, `techevo-lead-pulls`.
- 200-row QA scores in parallel with the next step. A fail holds only
  before Smartlead import. ICP 2% counts false passes only; false cuts
  are tracked separately.
- Site-people name-pick filters are standard every run.
- ICP variants must exist before the gate. TechEvo parks; do not invent
  a label set.
- `DECISIONS.md` D111.
- Patches (not deployed): `docs/patches/icp-llm-row-claim.md`,
  `docs/patches/site-people-vault.md`, `docs/patches/site-dm-pick-filters.md`.

Copy the skill text into Claude. A daily Routine copies Claude skills
back into `skills/` and will overwrite these files if Claude still has
the old text.

## Email finder (other repo)

Repo `joshuaosborn561-lang/email-waterfall`. Workers 20–50
(`COMPANY_CONCURRENCY`, default 40, cap 50) claim unfinished source
rows (`ew_claim_source`, `FOR UPDATE SKIP LOCKED`, 15 minute
`wf_lease_until`). Free tiers first (GetLeads, Smartlead), paid
(AI Ark, Prospeo, FullEnrich) only on misses, short-circuit on hit.
`approve_cost_usd` stops cleanly and releases unprocessed claims.
A restart resumes `wf_status` null or expired `processing` leases;
it does not re-scan `found` / `title_miss` / `not_found`.

If that PR could not be opened from this run, the same spec is in
the email-waterfall files: migration `007_ew_claim_source.sql`,
`email_waterfall/source.py`, `email_waterfall/_wf/exec.py`.

## Already claiming (no code change)

- `icp-site-fetch` — `FOR UPDATE SKIP LOCKED`, 10 minute lease.
- `site-people` fetch / extract / ask — live v5.

## Deploy, in this order, after merge

1. **Supabase `azpapwtnrbzywlnxxecz` only, email-waterfall migration.**
   Apply `supabase/migrations/007_ew_claim_source.sql` from the
   email-waterfall repo (RPCs `ew_claim_source`, `ew_release_claims`,
   lease columns via `ew_ensure_wf_writeback`). Do not apply from
   this repo. Do not run it against parcels or CRM.
2. **Railway `email-waterfall`.** Deploy the GitHub branch/main after
   merge. Confirm `COMPANY_CONCURRENCY` is 20–50 (default 40). GetLeads
   stays at about 4 concurrent; Smartlead at 3. Pass `approve_cost_usd`
   on every paid `enrich_waterfall`.
3. **Vault `site_people_key`.** Follow `docs/patches/site-people-vault.md`
   in the dashboard. Do not put the value in git. Then deploy the
   `site-people` source from that patch.
4. **`icp-llm` claiming.** Follow `docs/patches/icp-llm-row-claim.md`,
   then deploy. After that, 3 to 5 `icp-llm` calls per batch are
   allowed; until then, one at a time.
5. **`topup.site_dm_pick` filters.** Follow
   `docs/patches/site-dm-pick-filters.md`, or keep applying them in
   SQL after the view as the skill says.
6. **TechEvo ICP.** Still parks. Josh writes JEV_Q / PASS and a
   `topup.icp_variants` row when he wants that gate to run. Do not
   invent it.

## What this run could not do

- Deploy `icp-llm` or `site-people` (would replace production).
- Apply production SQL except as files in PRs.
- Merge any PR.
- Invent a TechEvo label set.
- Edit `topup.site_dm_pick` in git (the view is only on Supabase).
- Guarantee the Claude daily sync keeps the skill text; copy it there.
