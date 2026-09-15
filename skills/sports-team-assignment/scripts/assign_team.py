#!/usr/bin/env python3
"""
Assign a local sports team to each row of a lead CSV.

Decision order (first match wins):
  1. no city/state            -> blank NO_CITY_STATE
  2. FL panhandle (lon<-84.5) -> blank PANHANDLE_FL_BLANK
  3. city override            -> that team           [skipped if --pro-only]
  4. pro team within 35 mi    -> that team
  5. nearest college w/in 120 -> that team           [skipped if --pro-only]
  6. pro team within 120 mi   -> that team
  7. otherwise                -> blank OUT_OF_RANGE

Usage:
  python3 assign_team.py in.csv out.csv --league mlb --out-col "Local Sports Team MLB"
  python3 assign_team.py in.csv out.csv --league both --pro-only --split
"""

import argparse
import csv
import math
import os
import sys

HOME_RADIUS_MI = 35.0
COLLEGE_RADIUS_MI = 120.0
REGIONAL_RADIUS_MI = 120.0
NOTRE_DAME_RADIUS_MI = 50.0  # tightened so South Bend stops swallowing Chicagoland

# ---------------------------------------------------------------- team tables

MLB = [
    ("Diamondbacks", 33.4453, -112.0667), ("Braves", 33.8907, -84.4677),
    ("Orioles", 39.2839, -76.6217), ("Red Sox", 42.3467, -71.0972),
    ("Cubs", 41.9484, -87.6553), ("White Sox", 41.8299, -87.6338),
    ("Reds", 39.0975, -84.5069), ("Guardians", 41.4962, -81.6852),
    ("Rockies", 39.7559, -104.9942), ("Tigers", 42.3390, -83.0485),
    ("Astros", 29.7573, -95.3555), ("Royals", 39.0517, -94.4803),
    ("Angels", 33.8003, -117.8827), ("Dodgers", 34.0739, -118.2400),
    ("Marlins", 25.7781, -80.2197), ("Brewers", 43.0280, -87.9712),
    ("Twins", 44.9817, -93.2778), ("Mets", 40.7571, -73.8458),
    ("Yankees", 40.8296, -73.9262), ("Athletics", 38.5816, -121.4944),
    ("Phillies", 39.9061, -75.1665), ("Pirates", 40.4469, -80.0057),
    ("Padres", 32.7073, -117.1566), ("Giants", 37.7786, -122.3893),
    ("Mariners", 47.5914, -122.3325), ("Cardinals", 38.6226, -90.1928),
    ("Rays", 27.7683, -82.6534), ("Rangers", 32.7473, -97.0845),
    ("Blue Jays", 43.6414, -79.3894), ("Nationals", 38.8730, -77.0074),
]

NFL = [
    ("Cardinals", 33.5276, -112.2626), ("Falcons", 33.7553, -84.4006),
    ("Ravens", 39.2780, -76.6227), ("Bills", 42.7738, -78.7870),
    ("Panthers", 35.2258, -80.8528), ("Bears", 41.8623, -87.6167),
    ("Bengals", 39.0955, -84.5161), ("Browns", 41.5061, -81.6995),
    ("Cowboys", 32.7473, -97.0945), ("Broncos", 39.7439, -105.0201),
    ("Lions", 42.3400, -83.0456), ("Packers", 44.5013, -88.0622),
    ("Texans", 29.6847, -95.4107), ("Colts", 39.7601, -86.1639),
    ("Jaguars", 30.3239, -81.6373), ("Chiefs", 39.0489, -94.4839),
    ("Raiders", 36.0909, -115.1833), ("Chargers", 33.9535, -118.3392),
    ("Rams", 33.9535, -118.3392), ("Dolphins", 25.9580, -80.2389),
    ("Vikings", 44.9736, -93.2575), ("Patriots", 42.0909, -71.2643),
    ("Saints", 29.9511, -90.0812), ("Giants", 40.8135, -74.0745),
    ("Jets", 40.8135, -74.0745), ("Eagles", 39.9008, -75.1675),
    ("Steelers", 40.4468, -80.0158), ("49ers", 37.4033, -121.9694),
    ("Seahawks", 47.5952, -122.3316), ("Buccaneers", 27.9759, -82.5033),
    ("Titans", 36.1665, -86.7713), ("Commanders", 38.9077, -76.8645),
]

# College towns where college sport genuinely dominates.
# Deliberately EXCLUDES schools sitting inside major pro markets
# (LA, Seattle, Minneapolis, Nashville, Chicago, DC, north Jersey, Fort Worth).
# Ambiguous nicknames are school-qualified on purpose.
COLLEGES = [
    ("Crimson Tide", 33.2098, -87.5692),               # Tuscaloosa AL
    ("Auburn Tigers", 32.6099, -85.4808),              # Auburn AL
    ("Bulldogs", 33.9519, -83.3576),                   # Athens GA
    ("Gators", 29.6516, -82.3248),                     # Gainesville FL
    ("LSU Tigers", 30.4515, -91.1871),                 # Baton Rouge LA
    ("Ole Miss Rebels", 34.3665, -89.5192),            # Oxford MS
    ("Mississippi State Bulldogs", 33.4504, -88.8184), # Starkville MS
    ("Razorbacks", 36.0626, -94.1574),                 # Fayetteville AR
    ("Gamecocks", 34.0007, -81.0348),                  # Columbia SC
    ("Volunteers", 35.9606, -83.9207),                 # Knoxville TN
    ("Kentucky Wildcats", 38.0406, -84.5037),          # Lexington KY
    ("Missouri Tigers", 38.9517, -92.3341),            # Columbia MO
    ("Aggies", 30.6280, -96.3344),                     # College Station TX
    ("Sooners", 35.2226, -97.4395),                    # Norman OK
    ("Longhorns", 30.2672, -97.7431),                  # Austin TX
    ("Wolverines", 42.2808, -83.7430),                 # Ann Arbor MI
    ("Spartans", 42.7370, -84.4839),                   # East Lansing MI
    ("Buckeyes", 39.9612, -82.9988),                   # Columbus OH
    ("Nittany Lions", 40.7934, -77.8600),              # State College PA
    ("Badgers", 43.0731, -89.4012),                    # Madison WI
    ("Hawkeyes", 41.6611, -91.5302),                   # Iowa City IA
    ("Cyclones", 42.0308, -93.6319),                   # Ames IA
    ("Cornhuskers", 40.8136, -96.7026),                # Lincoln NE
    ("Boilermakers", 40.4259, -86.9081),               # West Lafayette IN
    ("Hoosiers", 39.1653, -86.5264),                   # Bloomington IN
    ("Fighting Illini", 40.1164, -88.2434),            # Champaign IL
    ("Fighting Irish", 41.6764, -86.2520),             # South Bend IN (50mi)
    ("Clemson Tigers", 34.6834, -82.8374),             # Clemson SC
    ("Tar Heels", 35.9132, -79.0558),                  # Chapel Hill NC
    ("Blue Devils", 35.9940, -78.8986),                # Durham NC
    ("Hokies", 37.2296, -80.4139),                     # Blacksburg VA
    ("Cavaliers", 38.0293, -78.4767),                  # Charlottesville VA
    ("Seminoles", 30.4383, -84.2807),                  # Tallahassee FL
    ("Demon Deacons", 36.0999, -80.2442),              # Winston-Salem NC
    ("Orange", 43.0481, -76.1474),                     # Syracuse NY
    ("Louisville Cardinals", 38.2527, -85.7585),       # Louisville KY
    ("Red Raiders", 33.5779, -101.8552),               # Lubbock TX
    ("Oklahoma State Cowboys", 36.1156, -97.0584),     # Stillwater OK
    ("K-State Wildcats", 39.1836, -96.5717),           # Manhattan KS
    ("Jayhawks", 38.9717, -95.2353),                   # Lawrence KS
    ("Baylor Bears", 31.5493, -97.1467),               # Waco TX
    ("Mountaineers", 39.6295, -79.9559),               # Morgantown WV
    ("BYU Cougars", 40.2338, -111.6585),               # Provo UT
    ("Ducks", 44.0521, -123.0868),                     # Eugene OR
    ("Beavers", 44.5646, -123.2620),                   # Corvallis OR
    ("Washington State Cougars", 46.7298, -117.1817),  # Pullman WA
    ("Arizona Wildcats", 32.2226, -110.9747),          # Tucson AZ
    ("Buffaloes", 40.0150, -105.2705),                 # Boulder CO
    ("Boise State Broncos", 43.6150, -116.2023),       # Boise ID
    ("Fresno State Bulldogs", 36.7378, -119.7871),     # Fresno CA
    ("Montana Grizzlies", 46.8721, -113.9940),         # Missoula MT
    ("Wyoming Cowboys", 41.3114, -105.5911),           # Laramie WY
]

# Cities with no reasonable MLB/NFL answer but a real local team.
# Standing exceptions to the no-NBA/NHL rule. Skipped in --pro-only.
CITY_OVERRIDES = {
    ("memphis", "TN"): "Grizzlies",
    ("orlando", "FL"): "Magic",
    ("portland", "OR"): "Trail Blazers",
    ("raleigh", "NC"): "Hurricanes",
}

# Exact-match only. Never substring: "Spokane Indians" must survive untouched.
RENAMES = {"Indians": "Guardians", "Redskins": "Commanders"}

STATE_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "district of columbia": "DC",
}

# ---------------------------------------------------------------- helpers


def haversine(lat1, lon1, lat2, lon2):
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def norm_state(s):
    s = (s or "").strip()
    if not s:
        return ""
    if len(s) == 2:
        return s.upper()
    return STATE_ABBR.get(s.lower(), s.upper()[:2])


def load_geocode(path):
    """Load city -> (lat, lon). Auto-detects column names."""
    if not os.path.exists(path):
        sys.exit(
            f"Geocode reference not found at {path}.\n"
            "Fetch it with:\n"
            "  curl -s -o /home/claude/uscities.csv \\\n"
            "    https://raw.githubusercontent.com/kelvins/US-Cities-Database/"
            "main/csv/us_cities.csv"
        )
    lookup = {}
    with open(path, newline="", encoding="utf-8-sig") as f:
        rdr = csv.DictReader(f)
        cols = {c.lower().strip(): c for c in (rdr.fieldnames or [])}

        def pick(*cands):
            for c in cands:
                if c in cols:
                    return cols[c]
            return None

        c_city = pick("city", "city_ascii", "name")
        c_state = pick("state_code", "state_id", "state", "state_name")
        c_lat = pick("latitude", "lat")
        c_lon = pick("longitude", "lng", "lon", "long")
        if not all([c_city, c_state, c_lat, c_lon]):
            sys.exit(f"Could not identify columns in {path}: {rdr.fieldnames}")
        for row in rdr:
            try:
                key = (row[c_city].strip().lower(), norm_state(row[c_state]))
            except Exception:
                continue
            if key in lookup:
                continue
            try:
                lookup[key] = (float(row[c_lat]), float(row[c_lon]))
            except (ValueError, TypeError):
                continue
    return lookup


def nearest(lat, lon, table, radius):
    """Returns (name, distance) or (None, None)."""
    best, best_d = None, None
    for name, tlat, tlon in table:
        d = haversine(lat, lon, tlat, tlon)
        r = NOTRE_DAME_RADIUS_MI if name == "Fighting Irish" else radius
        if d <= r and (best_d is None or d < best_d):
            best, best_d = name, d
    return best, best_d


def assign(city, state, geo, league_table, pro_only):
    """Returns (team, source)."""
    city = (city or "").strip()
    state = norm_state(state)
    if not city or not state:
        return "", "NO_CITY_STATE"

    key = (city.lower(), state)

    if not pro_only and key in CITY_OVERRIDES:
        return CITY_OVERRIDES[key], "CityOverride"

    coords = geo.get(key)
    if not coords:
        return "", "NO_GEOCODE"
    lat, lon = coords

    if state == "FL" and lon < -84.5:
        return "", "PANHANDLE_FL_BLANK"

    pro, pro_d = nearest(lat, lon, league_table, REGIONAL_RADIUS_MI)

    # Home market always wins outright, even over a college in the same town.
    # Houston is Astros not Aggies. Minneapolis is Twins not Gophers.
    if pro and pro_d <= HOME_RADIUS_MI:
        return RENAMES.get(pro, pro), "PRO"

    if pro_only:
        if pro:
            return RENAMES.get(pro, pro), "PRO"
        return "", "OUT_OF_RANGE"

    col, col_d = nearest(lat, lon, COLLEGES, COLLEGE_RADIUS_MI)

    # Outside the home market, whichever is genuinely closer wins.
    # Without this, a metro-fringe contact (Forney TX, 36mi from the Rangers)
    # falls past the home radius and grabs a college 100mi away.
    if col and pro:
        return (col, "College") if col_d < pro_d else (RENAMES.get(pro, pro), "PRO")
    if col:
        return col, "College"
    if pro:
        return RENAMES.get(pro, pro), "PRO"

    return "", "OUT_OF_RANGE"


def detect_col(fieldnames, explicit, candidates, label):
    if explicit:
        if explicit not in fieldnames:
            sys.exit(f"Column {explicit!r} not in file. Available: {fieldnames}")
        return explicit
    low = {c.lower().strip(): c for c in fieldnames}
    for cand in candidates:
        if cand in low:
            return low[cand]
    sys.exit(
        f"Could not auto-detect the {label} column. Pass it explicitly.\n"
        f"Available columns: {fieldnames}"
    )


# ---------------------------------------------------------------- main


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("outfile")
    ap.add_argument("--league", choices=["mlb", "nfl", "both"], default="mlb")
    ap.add_argument("--city-col")
    ap.add_argument("--state-col")
    ap.add_argument("--out-col", help="REQUIRED when re-running on a file that "
                                      "already has a team column")
    ap.add_argument("--pro-only", action="store_true",
                    help="MANDATORY for education lanes. Disables college and "
                         "all city overrides.")
    ap.add_argument("--split", action="store_true",
                    help="also write _WITH_TEAM and _NO_TEAM files")
    ap.add_argument("--geocode", default=os.environ.get(
        "USCITIES_CSV", "/home/claude/uscities.csv"))
    args = ap.parse_args()

    geo = load_geocode(args.geocode)

    with open(args.infile, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        sys.exit("Input file has no rows.")
    fields = list(rows[0].keys())

    city_col = detect_col(fields, args.city_col,
                          ["city", "contact city", "city_normalized",
                           "location city", "person city"], "city")
    state_col = detect_col(fields, args.state_col,
                           ["state", "contact state", "state_normalized",
                            "province", "region"], "state")

    if args.league == "both":
        jobs = [("mlb", MLB, args.out_col or "Local Sports Team MLB", "Team Source"),
                ("nfl", NFL, "Local Sports Team NFL", "Team Source NFL")]
    elif args.league == "mlb":
        jobs = [("mlb", MLB, args.out_col or "Local Sports Team MLB", "Team Source")]
    else:
        jobs = [("nfl", NFL, args.out_col or "Local Sports Team NFL",
                 "Team Source NFL")]

    stats = {}
    for _lg, table, tcol, scol in jobs:
        if tcol not in fields:
            fields.append(tcol)
        if scol not in fields:
            fields.append(scol)
        counts = {}
        filled = 0
        for row in rows:
            team, src = assign(row.get(city_col), row.get(state_col),
                               geo, table, args.pro_only)
            row[tcol] = team
            row[scol] = src
            counts[src] = counts.get(src, 0) + 1
            if team:
                filled += 1
        stats[tcol] = (filled, counts)

    with open(args.outfile, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    total = len(rows)
    cities = len({(r.get(city_col, ""), r.get(state_col, "")) for r in rows})
    print(f"TOTAL ROWS: {total}")
    print(f"UNIQUE CITY/STATE PAIRS: {cities}   (not the same as row counts)")
    if args.pro_only:
        print("MODE: --pro-only  (college and city overrides DISABLED)")
    for tcol, (filled, counts) in stats.items():
        pct = 100.0 * filled / total if total else 0
        print(f"\n{tcol}: {filled}/{total} assigned ({pct:.1f}%)")
        for k in sorted(counts, key=lambda x: -counts[x]):
            print(f"    {k:<22} {counts[k]}")

    if args.split:
        primary = jobs[0][2]
        base = args.outfile.rsplit(".csv", 1)[0]
        for suffix, keep in (("_WITH_TEAM", True), ("_NO_TEAM", False)):
            sub = [r for r in rows if bool(r.get(primary)) == keep]
            with open(f"{base}{suffix}.csv", "w", newline="",
                      encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
                w.writeheader()
                w.writerows(sub)
            print(f"wrote {base}{suffix}.csv  ({len(sub)} rows)")


if __name__ == "__main__":
    main()
