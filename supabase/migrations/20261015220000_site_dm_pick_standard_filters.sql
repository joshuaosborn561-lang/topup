-- D112: standard site-people name-pick filters on topup.site_dm_pick.
-- Project azpapwtnrbzywlnxxecz only. Do not apply until Josh says.
-- History / old-year and plain-agent filters are in the view (applied
-- before rank so a current pastor or owner on a staff page still wins).
-- Franchise HQ and "name in site text" stay in post-view SQL.
-- Does not read or write the reserved finder/suppression columns.
-- Column list is unchanged so grants stay.

CREATE OR REPLACE VIEW topup.site_dm_pick AS
 WITH e AS (
         SELECT x.domain,
            x.org_name,
            x.org_type
           FROM topup.site_extractions x
          WHERE x.error IS NULL AND NOT (EXISTS ( SELECT 1
                   FROM topup.site_domain_blocklist bl
                  WHERE bl.domain = x.domain))
        ), p AS (
         SELECT sp.domain,
            sp.person_key,
            sp.full_name,
            sp.title,
            sp.evidence,
            sp.page_url,
            e.org_type,
            e.org_name,
                CASE
                    WHEN e.org_type = ANY (ARRAY['school'::text, 'nonprofit'::text, 'association'::text, 'government'::text, 'directory_or_unrelated'::text]) THEN NULL::integer
                    WHEN COALESCE(sp.title, ''::text) ~* '\m(vice|assistant|associate|youth|student|students|children|kids|worship|music|emeritus|emerita|retired|former|interim|intern|deputy|volunteer)\M'::text THEN NULL::integer
                    WHEN sp.full_name !~ '^\S+\s+\S+'::text THEN NULL::integer
                    WHEN e.org_type = 'church'::text THEN
                    CASE
                        WHEN sp.title ~* '\m(senior|lead|head) pastor\M|^pastor$|^the rev|\mreverend\M|\mrector\M|\mpriest\M|\mbishop\M'::text THEN 1
                        WHEN sp.title ~* '\mexecutive pastor\M'::text THEN 2
                        WHEN sp.title ~* '\m(church|business) admin|\mfacilit|\mproperty\M|\moperations\M|^executive director$'::text THEN 3
                        ELSE NULL::integer
                    END
                    ELSE
                    CASE
                        WHEN sp.title ~* '\m(owner|founder|co-founder|cofounder|principal|proprietor)\M|\mmanaging (partner|member)\M'::text THEN 1
                        WHEN sp.title ~* '\m(president|ceo|chief executive)\M'::text THEN 2
                        WHEN sp.title ~* '\mfacilit|\mproperty manag|\mreal estate\M|\masset manag|\mportfolio\M'::text THEN 3
                        WHEN sp.title ~* '\mgeneral manager\M|\mdirector of operations\M|\mchief operating\M|\mcoo\M'::text THEN 4
                        ELSE NULL::integer
                    END
                END AS rnk
           FROM topup.site_people sp
             JOIN e USING (domain)
          WHERE NOT (
                  COALESCE(sp.evidence, ''::text) ~* '(former|originally|first pastor|founded in|since 19|est\.?\s*19)'
                  OR COALESCE(sp.evidence, ''::text) ~ '(19[0-9]{2}\s*[-–]\s*[0-9]{2,4})'
                  OR COALESCE(sp.page_url, ''::text) ~* '(history|our-story|ourstory)'
                )
            AND NOT (
                  COALESCE(sp.title, ''::text) ~* '\m(agent|realtor|salesperson)\M'
                  AND COALESCE(sp.title, ''::text) !~* '\m(broker|owner|principal|managing)\M'
                )
        ), r AS (
         SELECT p.domain,
            p.person_key,
            p.full_name,
            p.title,
            p.org_type,
            p.org_name,
            p.rnk,
            row_number() OVER (PARTITION BY p.domain ORDER BY p.rnk, p.person_key) AS rn,
            count(*) OVER (PARTITION BY p.domain, p.rnk) AS ties
           FROM p
          WHERE p.rnk IS NOT NULL
        )
 SELECT domain,
    person_key,
    full_name,
    title,
    org_type,
    org_name,
    rnk,
    ties,
    'sql'::text AS pick_source
   FROM r
  WHERE rn = 1;
