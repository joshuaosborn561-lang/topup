-- D109: a job's settings are not a recipe. The table that holds one job's own
-- settings (where its pool is, which campaigns, the split Grokbot passed) is
-- renamed, and so is its key everywhere it is referenced. No data changes.
alter table topup.lane_recipes rename to job_settings;
alter table topup.job_settings rename column recipe_id to settings_id;
alter table topup.runs rename column recipe_id to settings_id;
alter table topup.campaign_registry rename column recipe_id to settings_id;
