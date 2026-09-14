-- D35 item 8: flag insurance before a gift campaign. Hold, not purge.
-- Additive. Safe if 0012 already tightened federal/target.

do $d35qa$
begin
  if to_regclass('topup.qa_rules') is null then
    raise notice 'd35: qa_rules missing — apply 0003 first';
    return;
  end if;
  update topup.qa_rules
     set pattern = '\y(bank|bancorp|credit union|fcu\y|savings and loan|trust company|federal credit union|federal savings|federal reserve|insurance|county of|city of|state of|department of|u\.?s\.? government)\y',
         notes = 'Banks, credit unions, insurance and government: flag before a gift campaign; default stay in'
   where rule_id = 'regulated_gift_hold';
end
$d35qa$;
