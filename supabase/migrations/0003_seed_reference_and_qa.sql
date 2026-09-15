-- leadtopup: seed QA rules and normalizer reference data.
-- Every row here came from a purge, hold, or hand fix named in the brief or
-- the design doc. Add rows; do not silently delete ones that were paid for.
-- Idempotent (on conflict do nothing / do update on the descriptive columns).

-- ---------------------------------------------------------------------------
-- QA rules
-- ---------------------------------------------------------------------------
insert into topup.qa_rules (rule_id, action, field, pattern, scope, reroute_to, reason) values
  ('junk_titles',            'purge', 'title',        '\b(intern|student|volunteer|retired|unemployed|seeking|looking for|freelance|self[- ]employed|owner operator|realtor|real estate agent)\b', null, null, 'Titles that are not the buyer'),
  ('retail_school_purge',    'purge', 'company_name', '\b(school district|isd\b|public schools|elementary|middle school|high school|walmart|target (inc|corp|stores?|pharmacy)|costco|kroger|home depot|lowe''s|best buy|dollar general|7-eleven)\b', null, null, 'Retail and school districts do not fit any lane'),
  ('student_orgs_purge',     'purge', 'company_name', '\b(student (association|organization|union|government)|fraternity|sorority|alumni association)\b', null, null, 'Student organizations slipped through title filters'),
  ('pe_junior_purge',        'purge', 'title',        '\b(associate|analyst|fellow|intern)\b', 'pe', null, 'Off-ICP PE titles loaded before they were caught (BCP)'),
  ('regulated_gift_hold',    'hold',  'company_name', '\b(bank|bancorp|credit union|fcu\b|savings and loan|trust company|federal credit union|federal savings|federal reserve|insurance|county of|city of|state of|department of|u\.?s\.? government)\b', null, null, 'Banks, credit unions, insurance and government: flag before a gift campaign; default stay in'),
  ('nonprofit_to_eos',       'reroute','company_name', '\b(church|ministry|ministries|parish|diocese|baptist|lutheran|methodist|presbyterian|catholic|synagogue|temple|mosque|chapel|foundation|nonprofit|non-profit)\b', null, 'eos', 'Churches and nonprofits never go to a ticket analytics offer'),
  ('company_name_acronym_hold','hold','company_n',    '^[A-Z]{2,6}$', null, null, 'All-caps acronym company names need a human eye (Acfcu)'),
  ('unresolved_team_hold',   'hold',  'local_sports_team', '^$', 'gift:team', null, 'A team campaign lead with no team resolves to AirPods tier or a human decision')
on conflict (rule_id) do update set
  action = excluded.action, field = excluded.field, pattern = excluded.pattern,
  scope = excluded.scope, reroute_to = excluded.reroute_to, reason = excluded.reason;

-- ---------------------------------------------------------------------------
-- Acronyms that stay upper case even though they contain vowels.
-- ---------------------------------------------------------------------------
insert into topup.ref_acronyms (acronym, note) values
  ('ACFCU', 'Credit union; title-casing produced "Acfcu" in a live list'),
  ('AAA', null), ('ADP', null), ('AIG', null), ('AMD', null), ('AOL', null),
  ('AT&T', null), ('BMW', null), ('CDW', null), ('CBRE', null), ('CVS', null),
  ('DHL', null), ('EY', null), ('GE', null), ('HCA', null), ('HP', null),
  ('IBM', null), ('IKEA', null), ('JLL', null), ('KPMG', null), ('NASA', null),
  ('NCR', null), ('NEC', null), ('NPR', null), ('PwC', null), ('SAP', null),
  ('SAS', null), ('UPS', null), ('USAA', null), ('YMCA', null), ('YWCA', null)
on conflict (acronym) do nothing;

-- ---------------------------------------------------------------------------
-- Company suffixes stripped for the conversational company name.
-- ---------------------------------------------------------------------------
insert into topup.ref_company_suffixes (suffix) values
  ('Inc'), ('Inc.'), ('Incorporated'), ('LLC'), ('L.L.C.'), ('LLP'), ('L.P.'), ('LP'),
  ('Ltd'), ('Ltd.'), ('Limited'), ('Corp'), ('Corp.'), ('Corporation'), ('Co'), ('Co.'),
  ('Company'), ('PLLC'), ('PLC'), ('P.C.'), ('PC'), ('PA'), ('P.A.'), ('GmbH'), ('S.A.'),
  ('Holdings'), ('Group'), ('Enterprises')
on conflict (suffix) do nothing;

-- ---------------------------------------------------------------------------
-- Ambiguous college / shared nicknames: team stays null, lead goes to the
-- AirPods tier rather than the wrong city (Cavaliers = Cleveland or Virginia).
-- ---------------------------------------------------------------------------
insert into topup.ref_ambiguous_nicknames (nickname, note) values
  ('Cavaliers', 'Cleveland (NBA) vs Virginia (NCAA)'),
  ('Tigers', 'Detroit (MLB), LSU, Clemson, Auburn, Missouri'),
  ('Wildcats', 'Kentucky, Arizona, Villanova, Kansas State, Northwestern'),
  ('Bulldogs', 'Georgia, Gonzaga, Mississippi State, Butler'),
  ('Eagles', 'Philadelphia (NFL), Boston College, Eastern Michigan'),
  ('Panthers', 'Carolina (NFL), Florida (NHL), Pitt'),
  ('Cardinals', 'Arizona (NFL), St. Louis (MLB), Louisville'),
  ('Giants', 'New York (NFL), San Francisco (MLB)'),
  ('Rangers', 'Texas (MLB), New York (NHL)'),
  ('Kings', 'Sacramento (NBA), Los Angeles (NHL)'),
  ('Jets', 'New York (NFL), Winnipeg (NHL)'),
  ('Aggies', 'Texas A&M, Utah State, New Mexico State'),
  ('Huskies', 'Washington, Connecticut, Northern Illinois'),
  ('Cougars', 'BYU, Houston, Washington State'),
  ('Bears', 'Chicago (NFL), Baylor, Cal'),
  ('Bruins', 'Boston (NHL), UCLA')
on conflict (nickname) do nothing;

-- ---------------------------------------------------------------------------
-- Conversational metro names. Suburb + state -> what a local would say.
-- Seeded from the brief; grows from real data via the ref table, never code.
-- ---------------------------------------------------------------------------
insert into topup.ref_metro_names (city, state, conversational) values
  ('Naperville', 'IL', 'Chicagoland'), ('Western Springs', 'IL', 'Chicagoland'),
  ('Schaumburg', 'IL', 'Chicagoland'), ('Evanston', 'IL', 'Chicagoland'),
  ('Oak Brook', 'IL', 'Chicagoland'), ('Aurora', 'IL', 'Chicagoland'),
  ('Joliet', 'IL', 'Chicagoland'), ('Elgin', 'IL', 'Chicagoland'),
  ('Chicago', 'IL', 'Chicago'),
  ('Rockwall', 'TX', 'Dallas'), ('Plano', 'TX', 'Dallas'), ('Frisco', 'TX', 'Dallas'),
  ('Irving', 'TX', 'Dallas'), ('Garland', 'TX', 'Dallas'), ('Richardson', 'TX', 'Dallas'),
  ('McKinney', 'TX', 'Dallas'), ('Arlington', 'TX', 'DFW'), ('Fort Worth', 'TX', 'Fort Worth'),
  ('Dallas', 'TX', 'Dallas'),
  ('Katy', 'TX', 'Houston'), ('Sugar Land', 'TX', 'Houston'), ('The Woodlands', 'TX', 'Houston'),
  ('Houston', 'TX', 'Houston'),
  ('Round Rock', 'TX', 'Austin'), ('Cedar Park', 'TX', 'Austin'), ('Austin', 'TX', 'Austin'),
  ('Cambridge', 'MA', 'Boston'), ('Waltham', 'MA', 'Boston'), ('Newton', 'MA', 'Boston'),
  ('Quincy', 'MA', 'Boston'), ('Boston', 'MA', 'Boston'),
  ('Brooklyn', 'NY', 'New York'), ('Queens', 'NY', 'New York'), ('Bronx', 'NY', 'New York'),
  ('Staten Island', 'NY', 'New York'), ('New York', 'NY', 'New York'),
  ('Jersey City', 'NJ', 'New York'), ('Hoboken', 'NJ', 'New York'), ('Newark', 'NJ', 'New York'),
  ('Alpharetta', 'GA', 'Atlanta'), ('Marietta', 'GA', 'Atlanta'), ('Sandy Springs', 'GA', 'Atlanta'),
  ('Roswell', 'GA', 'Atlanta'), ('Atlanta', 'GA', 'Atlanta'),
  ('Tempe', 'AZ', 'Phoenix'), ('Scottsdale', 'AZ', 'Phoenix'), ('Mesa', 'AZ', 'Phoenix'),
  ('Chandler', 'AZ', 'Phoenix'), ('Gilbert', 'AZ', 'Phoenix'), ('Phoenix', 'AZ', 'Phoenix'),
  ('Bellevue', 'WA', 'Seattle'), ('Redmond', 'WA', 'Seattle'), ('Kirkland', 'WA', 'Seattle'),
  ('Tacoma', 'WA', 'Seattle'), ('Seattle', 'WA', 'Seattle'),
  ('Aurora', 'CO', 'Denver'), ('Lakewood', 'CO', 'Denver'), ('Boulder', 'CO', 'Denver'),
  ('Englewood', 'CO', 'Denver'), ('Denver', 'CO', 'Denver'),
  ('Santa Monica', 'CA', 'Los Angeles'), ('Pasadena', 'CA', 'Los Angeles'), ('Burbank', 'CA', 'Los Angeles'),
  ('Long Beach', 'CA', 'Los Angeles'), ('Irvine', 'CA', 'Orange County'), ('Anaheim', 'CA', 'Orange County'),
  ('Los Angeles', 'CA', 'Los Angeles'),
  ('Oakland', 'CA', 'the Bay Area'), ('San Jose', 'CA', 'the Bay Area'), ('Palo Alto', 'CA', 'the Bay Area'),
  ('Mountain View', 'CA', 'the Bay Area'), ('San Francisco', 'CA', 'San Francisco'),
  ('Bloomington', 'MN', 'the Twin Cities'), ('St. Paul', 'MN', 'the Twin Cities'), ('Minneapolis', 'MN', 'the Twin Cities'),
  ('Overland Park', 'KS', 'Kansas City'), ('Kansas City', 'MO', 'Kansas City'),
  ('Coral Gables', 'FL', 'Miami'), ('Fort Lauderdale', 'FL', 'South Florida'), ('Boca Raton', 'FL', 'South Florida'),
  ('Miami', 'FL', 'Miami'), ('St. Petersburg', 'FL', 'Tampa Bay'), ('Clearwater', 'FL', 'Tampa Bay'), ('Tampa', 'FL', 'Tampa'),
  ('Bethesda', 'MD', 'the DC area'), ('Arlington', 'VA', 'the DC area'), ('Alexandria', 'VA', 'the DC area'),
  ('Reston', 'VA', 'the DC area'), ('Washington', 'DC', 'DC'),
  ('King of Prussia', 'PA', 'Philadelphia'), ('Conshohocken', 'PA', 'Philadelphia'), ('Philadelphia', 'PA', 'Philadelphia'),
  ('Troy', 'MI', 'Detroit'), ('Southfield', 'MI', 'Detroit'), ('Dearborn', 'MI', 'Detroit'), ('Detroit', 'MI', 'Detroit'),
  ('Beachwood', 'OH', 'Cleveland'), ('Independence', 'OH', 'Cleveland'), ('Cleveland', 'OH', 'Cleveland'),
  ('Dublin', 'OH', 'Columbus'), ('Columbus', 'OH', 'Columbus'), ('Blue Ash', 'OH', 'Cincinnati'), ('Cincinnati', 'OH', 'Cincinnati'),
  ('Franklin', 'TN', 'Nashville'), ('Brentwood', 'TN', 'Nashville'), ('Nashville', 'TN', 'Nashville'),
  ('Cary', 'NC', 'the Triangle'), ('Durham', 'NC', 'the Triangle'), ('Raleigh', 'NC', 'Raleigh'), ('Charlotte', 'NC', 'Charlotte'),
  ('Clayton', 'MO', 'St. Louis'), ('St. Louis', 'MO', 'St. Louis'),
  ('Henderson', 'NV', 'Las Vegas'), ('Las Vegas', 'NV', 'Las Vegas'),
  ('Beaverton', 'OR', 'Portland'), ('Portland', 'OR', 'Portland'),
  ('Sandy', 'UT', 'Salt Lake'), ('Salt Lake City', 'UT', 'Salt Lake'),
  ('Carmel', 'IN', 'Indianapolis'), ('Indianapolis', 'IN', 'Indy'),
  ('Brookfield', 'WI', 'Milwaukee'), ('Milwaukee', 'WI', 'Milwaukee'),
  ('Cranberry Township', 'PA', 'Pittsburgh'), ('Pittsburgh', 'PA', 'Pittsburgh'),
  ('Amherst', 'NY', 'Buffalo'), ('Buffalo', 'NY', 'Buffalo'),
  ('Metairie', 'LA', 'New Orleans'), ('New Orleans', 'LA', 'New Orleans'),
  ('Towson', 'MD', 'Baltimore'), ('Baltimore', 'MD', 'Baltimore'),
  ('Coral Springs', 'FL', 'South Florida'), ('Winter Park', 'FL', 'Orlando'), ('Orlando', 'FL', 'Orlando'),
  ('Jacksonville', 'FL', 'Jacksonville'), ('San Antonio', 'TX', 'San Antonio'), ('San Diego', 'CA', 'San Diego'),
  ('Sacramento', 'CA', 'Sacramento'), ('Oklahoma City', 'OK', 'OKC'), ('Memphis', 'TN', 'Memphis')
on conflict (city, state) do update set conversational = excluded.conversational;

-- ---------------------------------------------------------------------------
-- Pro sports teams by conversational metro. Pro only; college handled by the
-- ambiguous-nickname list. Team names are the short form used in copy.
-- ---------------------------------------------------------------------------
insert into topup.ref_sports_teams (team, league, metro, state, pro) values
  ('Bears','NFL','Chicago','IL',true), ('Bears','NFL','Chicagoland','IL',true), ('Bulls','NBA','Chicago','IL',true), ('Bulls','NBA','Chicagoland','IL',true),
  ('Cubs','MLB','Chicago','IL',true), ('Cubs','MLB','Chicagoland','IL',true), ('White Sox','MLB','Chicago','IL',true), ('Blackhawks','NHL','Chicago','IL',true), ('Blackhawks','NHL','Chicagoland','IL',true),
  ('Cowboys','NFL','Dallas','TX',true), ('Cowboys','NFL','DFW','TX',true), ('Cowboys','NFL','Fort Worth','TX',true), ('Mavericks','NBA','Dallas','TX',true), ('Mavericks','NBA','DFW','TX',true),
  ('Rangers','MLB','Dallas','TX',true), ('Rangers','MLB','DFW','TX',true), ('Rangers','MLB','Fort Worth','TX',true), ('Stars','NHL','Dallas','TX',true), ('Stars','NHL','DFW','TX',true),
  ('Texans','NFL','Houston','TX',true), ('Rockets','NBA','Houston','TX',true), ('Astros','MLB','Houston','TX',true),
  ('Spurs','NBA','San Antonio','TX',true),
  ('Patriots','NFL','Boston','MA',true), ('Celtics','NBA','Boston','MA',true), ('Red Sox','MLB','Boston','MA',true), ('Bruins','NHL','Boston','MA',true),
  ('Giants','NFL','New York','NY',true), ('Jets','NFL','New York','NY',true), ('Knicks','NBA','New York','NY',true), ('Nets','NBA','New York','NY',true),
  ('Yankees','MLB','New York','NY',true), ('Mets','MLB','New York','NY',true), ('Rangers','NHL','New York','NY',true), ('Islanders','NHL','New York','NY',true),
  ('Falcons','NFL','Atlanta','GA',true), ('Hawks','NBA','Atlanta','GA',true), ('Braves','MLB','Atlanta','GA',true),
  ('Cardinals','NFL','Phoenix','AZ',true), ('Suns','NBA','Phoenix','AZ',true), ('Diamondbacks','MLB','Phoenix','AZ',true), ('Coyotes','NHL','Phoenix','AZ',true),
  ('Seahawks','NFL','Seattle','WA',true), ('Mariners','MLB','Seattle','WA',true), ('Kraken','NHL','Seattle','WA',true),
  ('Broncos','NFL','Denver','CO',true), ('Nuggets','NBA','Denver','CO',true), ('Rockies','MLB','Denver','CO',true), ('Avalanche','NHL','Denver','CO',true),
  ('Rams','NFL','Los Angeles','CA',true), ('Chargers','NFL','Los Angeles','CA',true), ('Lakers','NBA','Los Angeles','CA',true), ('Clippers','NBA','Los Angeles','CA',true),
  ('Dodgers','MLB','Los Angeles','CA',true), ('Kings','NHL','Los Angeles','CA',true), ('Angels','MLB','Orange County','CA',true), ('Ducks','NHL','Orange County','CA',true),
  ('49ers','NFL','the Bay Area','CA',true), ('49ers','NFL','San Francisco','CA',true), ('Warriors','NBA','the Bay Area','CA',true), ('Warriors','NBA','San Francisco','CA',true),
  ('Giants','MLB','San Francisco','CA',true), ('Giants','MLB','the Bay Area','CA',true), ('Sharks','NHL','the Bay Area','CA',true),
  ('Vikings','NFL','the Twin Cities','MN',true), ('Timberwolves','NBA','the Twin Cities','MN',true), ('Twins','MLB','the Twin Cities','MN',true), ('Wild','NHL','the Twin Cities','MN',true),
  ('Chiefs','NFL','Kansas City','MO',true), ('Royals','MLB','Kansas City','MO',true),
  ('Dolphins','NFL','Miami','FL',true), ('Dolphins','NFL','South Florida','FL',true), ('Heat','NBA','Miami','FL',true), ('Heat','NBA','South Florida','FL',true),
  ('Marlins','MLB','Miami','FL',true), ('Panthers','NHL','South Florida','FL',true),
  ('Buccaneers','NFL','Tampa','FL',true), ('Buccaneers','NFL','Tampa Bay','FL',true), ('Lightning','NHL','Tampa','FL',true), ('Lightning','NHL','Tampa Bay','FL',true), ('Rays','MLB','Tampa Bay','FL',true),
  ('Magic','NBA','Orlando','FL',true), ('Jaguars','NFL','Jacksonville','FL',true),
  ('Commanders','NFL','the DC area','DC',true), ('Commanders','NFL','DC','DC',true), ('Wizards','NBA','DC','DC',true), ('Wizards','NBA','the DC area','DC',true),
  ('Nationals','MLB','DC','DC',true), ('Nationals','MLB','the DC area','DC',true), ('Capitals','NHL','DC','DC',true), ('Capitals','NHL','the DC area','DC',true),
  ('Eagles','NFL','Philadelphia','PA',true), ('76ers','NBA','Philadelphia','PA',true), ('Phillies','MLB','Philadelphia','PA',true), ('Flyers','NHL','Philadelphia','PA',true),
  ('Lions','NFL','Detroit','MI',true), ('Pistons','NBA','Detroit','MI',true), ('Tigers','MLB','Detroit','MI',true), ('Red Wings','NHL','Detroit','MI',true),
  ('Browns','NFL','Cleveland','OH',true), ('Cavaliers','NBA','Cleveland','OH',true), ('Guardians','MLB','Cleveland','OH',true),
  ('Blue Jackets','NHL','Columbus','OH',true), ('Bengals','NFL','Cincinnati','OH',true), ('Reds','MLB','Cincinnati','OH',true),
  ('Titans','NFL','Nashville','TN',true), ('Predators','NHL','Nashville','TN',true), ('Grizzlies','NBA','Memphis','TN',true),
  ('Panthers','NFL','Charlotte','NC',true), ('Hornets','NBA','Charlotte','NC',true), ('Hurricanes','NHL','the Triangle','NC',true), ('Hurricanes','NHL','Raleigh','NC',true),
  ('Cardinals','MLB','St. Louis','MO',true), ('Blues','NHL','St. Louis','MO',true),
  ('Raiders','NFL','Las Vegas','NV',true), ('Golden Knights','NHL','Las Vegas','NV',true),
  ('Trail Blazers','NBA','Portland','OR',true), ('Jazz','NBA','Salt Lake','UT',true),
  ('Colts','NFL','Indy','IN',true), ('Colts','NFL','Indianapolis','IN',true), ('Pacers','NBA','Indy','IN',true), ('Pacers','NBA','Indianapolis','IN',true),
  ('Packers','NFL','Milwaukee','WI',true), ('Bucks','NBA','Milwaukee','WI',true), ('Brewers','MLB','Milwaukee','WI',true),
  ('Steelers','NFL','Pittsburgh','PA',true), ('Penguins','NHL','Pittsburgh','PA',true), ('Pirates','MLB','Pittsburgh','PA',true),
  ('Bills','NFL','Buffalo','NY',true), ('Sabres','NHL','Buffalo','NY',true),
  ('Saints','NFL','New Orleans','LA',true), ('Pelicans','NBA','New Orleans','LA',true),
  ('Ravens','NFL','Baltimore','MD',true), ('Orioles','MLB','Baltimore','MD',true),
  ('Padres','MLB','San Diego','CA',true), ('Kings','NBA','Sacramento','CA',true), ('Thunder','NBA','OKC','OK',true)
on conflict (team, league, metro) do nothing;
