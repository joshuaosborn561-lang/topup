"""
Map a city/state to the conversational name people actually use for that area.

    Naperville, Illinois      -> Chicagoland
    West Palm Beach, Florida  -> South Florida
    Plano, Texas              -> DFW
    Bellevue, Washington      -> the Seattle area

Usage:
    python3 conversational_location.py <input.csv> <output.csv> \
        [--city-col city_normalized] [--state-col state] [--out-col city_normalized]

Never overwrite the raw `city` column. A city that cannot be geocoded
writes a blank location (NO_GEOCODE), never a broken sentence.

Cities that fall outside every metro radius keep their own cleaned name, which is
correct -- "Bozeman" is already how someone from Bozeman says where they live.
"""

import csv, math, re, sys, argparse, os

CITIES_CSV = os.environ.get('USCITIES_CSV', '/home/claude/uscities.csv')

# ---------------------------------------------------------------------------
# Metro anchors: (label, anchor_lat, anchor_lon, radius_miles)
# Radius is how far the conversational label genuinely stretches. Ordered by
# specificity -- tighter, more specific metros are checked before broad ones so
# Orange County wins over the LA blanket, and the Inland Empire keeps its own name.
# ---------------------------------------------------------------------------
METROS = [
    # --- California (specific before broad) ---
    ("Orange County",        33.7175, -117.8311, 22),
    ("the Inland Empire",    34.0633, -117.6509, 30),
    ("the Bay Area",         37.6879, -122.1705, 45),
    ("Greater Sacramento",   38.5816, -121.4944, 35),
    ("San Diego",            32.7157, -117.1611, 35),
    ("the LA area",          34.0522, -118.2437, 40),

    # --- Texas ---
    ("DFW",                  32.7900,  -96.9000, 50),
    ("Greater Houston",      29.7604,  -95.3698, 50),
    ("the Austin area",      30.2672,  -97.7431, 35),
    ("the San Antonio area", 29.4241,  -98.4936, 35),

    # --- Florida ---
    ("South Florida",        26.3683,  -80.1289, 70),
    ("the Tampa Bay area",   27.9506,  -82.4572, 45),
    ("Central Florida",      28.5383,  -81.3792, 45),
    ("Jacksonville",         30.3322,  -81.6557, 35),

    # --- Northeast / Mid-Atlantic ---
    ("the NYC area",         40.7128,  -74.0060, 45),
    ("the DMV",              38.9072,  -77.0369, 40),
    ("Greater Philadelphia", 39.9526,  -75.1652, 40),
    ("Greater Boston",       42.3601,  -71.0589, 40),
    ("Greater Baltimore",    39.2904,  -76.6122, 28),
    ("Greater Pittsburgh",   40.4406,  -79.9959, 35),
    ("the Hartford area",    41.7658,  -72.6734, 30),
    ("the Providence area",  41.8240,  -71.4128, 25),
    ("the Buffalo area",     42.8864,  -78.8784, 30),
    ("the Rochester area",   43.1566,  -77.6088, 28),
    ("the Albany area",      42.6526,  -73.7562, 30),

    # --- Midwest ---
    ("Chicagoland",          41.8781,  -87.6298, 55),
    ("Metro Detroit",        42.3314,  -83.0458, 45),
    ("the Twin Cities",      44.9778,  -93.2650, 45),
    ("Greater Cleveland",    41.4993,  -81.6944, 35),
    ("Greater Cincinnati",   39.1031,  -84.5120, 35),
    ("Central Ohio",         39.9612,  -82.9988, 35),
    ("Greater St. Louis",    38.6270,  -90.1994, 40),
    ("the Kansas City area", 39.0997,  -94.5786, 40),
    ("Greater Milwaukee",    43.0389,  -87.9065, 30),
    ("Greater Indianapolis", 39.7684,  -86.1581, 35),
    ("the Omaha area",       41.2565,  -95.9345, 30),
    ("Greater Grand Rapids", 42.9634,  -85.6681, 28),

    # --- South ---
    ("Metro Atlanta",        33.7490,  -84.3880, 45),
    ("the Nashville area",   36.1627,  -86.7816, 40),
    ("the Triangle",         35.8436,  -78.7852, 30),
    ("the Charlotte area",   35.2271,  -80.8431, 35),
    ("the Triad",            36.0726,  -79.7920, 30),
    ("Greater New Orleans",  29.9511,  -90.0715, 35),
    ("the Memphis area",     35.1495,  -90.0490, 35),
    ("the Birmingham area",  33.5186,  -86.8104, 30),
    ("Greater Richmond",     37.5407,  -77.4360, 30),
    ("Hampton Roads",        36.8508,  -76.2859, 35),
    ("the Louisville area",  38.2527,  -85.7585, 30),
    ("the Charleston area",  32.7765,  -79.9311, 30),
    ("the Greenville area",  34.8526,  -82.3940, 28),
    ("the Knoxville area",   35.9606,  -83.9207, 30),
    ("Oklahoma City",        35.4676,  -97.5164, 30),
    ("the Tulsa area",       36.1540,  -95.9928, 30),
    ("Little Rock",          34.7465,  -92.2896, 28),

    # --- Mountain / West ---
    ("Metro Denver",         39.7392, -104.9903, 40),
    ("Metro Phoenix",        33.4484, -112.0740, 40),
    ("the Las Vegas area",   36.1699, -115.1398, 30),
    ("the Salt Lake area",   40.7608, -111.8910, 35),
    ("the Boise area",       43.6150, -116.2023, 30),
    ("the Albuquerque area", 35.0844, -106.6504, 30),
    ("the Tucson area",      32.2226, -110.9747, 30),

    # --- Pacific Northwest ---
    ("the Seattle area",     47.6062, -122.3321, 40),
    ("the Portland area",    45.5152, -122.6784, 35),
    ("the Spokane area",     47.6588, -117.4260, 28),
]


def load_cities(path=CITIES_CSV):
    coords = {}
    with open(path, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            key = (row['CITY'].strip().lower(), row['STATE_NAME'].strip().lower())
            if key not in coords:
                try:
                    coords[key] = (float(row['LATITUDE']), float(row['LONGITUDE']))
                except ValueError:
                    pass
    return coords


CITY_COORDS = load_cities() if os.path.exists(CITIES_CSV) else {}

# Cities the free dataset is missing
MANUAL_COORDS = {
    ('winston-salem', 'north carolina'): (36.0999, -80.2442),
    ("coeur d'alene", 'idaho'): (47.6777, -116.7805),
    ('wellington', 'florida'): (26.6617, -80.2670),
    ('mclean', 'virginia'): (38.9339, -77.1773),
    ('henrico', 'virginia'): (37.5407, -77.3717),
    ('fort mitchell', 'kentucky'): (39.0509, -84.5824),
    ('barrington hills', 'illinois'): (42.1503, -88.1595),
}


def geocode(city, state):
    c, s = city.strip().lower(), state.strip().lower()
    if not c or not s:
        return None
    key = (c, s)
    if key in CITY_COORDS:
        return CITY_COORDS[key]
    if key in MANUAL_COORDS:
        return MANUAL_COORDS[key]
    # St. / Saint interchange
    if re.match(r'^st\.?\s+', c):
        alt = ('saint ' + re.sub(r'^st\.?\s+', '', c), s)
        if alt in CITY_COORDS:
            return CITY_COORDS[alt]
    if c.startswith('saint '):
        alt = ('st ' + c[6:], s)
        if alt in CITY_COORDS:
            return CITY_COORDS[alt]
    # metro-combo strings ("Dallas-Fort Worth") -> first named city
    for delim in ('-', '/'):
        if delim in c:
            first = (c.split(delim)[0].strip(), s)
            if first in CITY_COORDS:
                return CITY_COORDS[first]
    return None


def haversine(lat1, lon1, lat2, lon2):
    R = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))


def conversational_location(city, state):
    """Return the conversational name for this city's area, the city itself, or blank on NO_GEOCODE."""
    if not city or not city.strip():
        return ""
    coord = geocode(city, state)
    if not coord:
        return ""  # NO_GEOCODE: blank location, never a broken sentence
    lat, lon = coord
    best, best_d = None, None
    for label, mlat, mlon, radius in METROS:
        d = haversine(lat, lon, mlat, mlon)
        if d <= radius and (best_d is None or d < best_d):
            best, best_d = label, d
    return best if best else city.strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input_csv')
    ap.add_argument('output_csv')
    ap.add_argument('--city-col', default=None)
    ap.add_argument('--state-col', default='state')
    ap.add_argument('--out-col', default='city_normalized',
                    help='Column to write. Defaults to city_normalized. Never overwrite raw city.')
    args = ap.parse_args()

    with open(args.input_csv, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        fields = list(reader.fieldnames)
        rows = list(reader)

    city_col = args.city_col
    if not city_col:
        for c in ('city_normalized', 'city', 'City'):
            if c in fields:
                city_col = c
                break
    if not city_col:
        sys.exit(f'No city column found. Columns: {fields}')
    out_col = args.out_col
    if out_col == 'city':
        sys.exit('refusing to overwrite raw city; pass --out-col city_normalized')
    if out_col not in fields:
        fields.insert(fields.index(city_col) + 1, out_col)

    changed = 0
    for row in rows:
        val = conversational_location(row.get(city_col, ''), row.get(args.state_col, ''))
        if val != row.get(out_col):
            changed += 1
        row[out_col] = val

    with open(args.output_csv, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    print(f'Rows: {len(rows)}  city col: {city_col} -> {out_col}  changed: {changed}')


if __name__ == '__main__':
    main()
