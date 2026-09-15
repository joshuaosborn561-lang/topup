-- leadtopup D25: the step 7 normalizers are ports of the skill scripts, and
-- two of those scripts (conversational_location.py, assign_team.py) geocode a
-- city through the free US cities file (kelvins/US-Cities-Database). That
-- file lives here as topup.ref_cities, loaded once by `npm run seed:cities`.
-- A city the table does not know is NO_GEOCODE: blank location, no team.
--
-- The three reference tables this replaces were scaffolding invented before
-- the skills were in the repo (metro names keyed by suburb, teams keyed by
-- metro, an ambiguous-nickname list). The scripts carry those as constants,
-- so the code does now too (src/stages/normalize/location.ts, team.ts).

create table if not exists topup.ref_cities (
  city    text not null,              -- lower case, as the scripts key it
  state   char(2) not null,           -- USPS code
  lat     double precision not null,
  lon     double precision not null,
  source  text not null default 'uscities',   -- uscities | manual
  primary key (city, state)
);

-- conversational_location.py MANUAL_COORDS: cities the free dataset is missing.
insert into topup.ref_cities (city, state, lat, lon, source) values
  ('winston-salem',   'NC', 36.0999,  -80.2442, 'manual'),
  ('coeur d''alene',  'ID', 47.6777, -116.7805, 'manual'),
  ('wellington',      'FL', 26.6617,  -80.2670, 'manual'),
  ('mclean',          'VA', 38.9339,  -77.1773, 'manual'),
  ('henrico',         'VA', 37.5407,  -77.3717, 'manual'),
  ('fort mitchell',   'KY', 39.0509,  -84.5824, 'manual'),
  ('barrington hills','IL', 42.1503,  -88.1595, 'manual')
on conflict (city, state) do nothing;

drop table if exists topup.ref_metro_names;
drop table if exists topup.ref_sports_teams;
drop table if exists topup.ref_ambiguous_nicknames;
-- company-name-normalization/SKILL.md rule 4 names the legal suffixes; they are
-- constants in src/stages/normalize/company.ts now. topup.ref_acronyms stays:
-- it is the skill's "fix by hand" list for vowel-bearing initialisms (Mgic, Hme).
drop table if exists topup.ref_company_suffixes;
