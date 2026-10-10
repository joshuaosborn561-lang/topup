-- D66 shipped topup.ensure_ingested_ew_view, which CREATE VIEWs in the
-- source schema at call time. That function was never applied. D67 forbids
-- all runtime DDL (leadtopup_app cannot CREATE in lp; we will not grant it).
-- Do not recreate the function. The views live in 0021.

drop function if exists topup.ensure_ingested_ew_view(text, text);
