-- leadtopup: QA rule patterns as Postgres regexes.
--
-- Step 8 runs topup.qa_rules in SQL (`coalesce(col,'') ~* pattern`). The
-- seed in 0003 wrote the patterns as Python/JS regexes, and Postgres ARE
-- reads `\b` as a backspace, not a word boundary — so junk_titles,
-- retail_school_purge, student_orgs_purge, pe_junior_purge,
-- regulated_gift_hold and nonprofit_to_eos never matched a row. Postgres
-- spells the word boundary `\y`. Found by the first end-to-end exercise of
-- steps 2–12 against fakes (D26); rules are data, so the fix is data.
--
-- company_name_acronym_hold ("all-caps acronym") cannot be case-insensitive:
-- under `~*` it held "Omega" and "Acme". `(?c)` is the ARE embedded option
-- for case-sensitive matching and overrides the operator.
-- Idempotent.

update topup.qa_rules set pattern = replace(pattern, '\b', '\y') where pattern like '%\b%';

update topup.qa_rules set pattern = '(?c)^[A-Z]{2,6}$' where rule_id = 'company_name_acronym_hold' and pattern = '^[A-Z]{2,6}$';
