"""
Normalize first names and city names in a CSV, per SalesGlider Growth's
established cold-outreach data-cleaning rules.

Usage:
    python3 normalize_names_and_cities.py <input.csv> <output.csv> \
        [--first-name-col COLNAME] [--city-col COLNAME]

If --first-name-col / --city-col aren't given, the script auto-detects from
common variants (first_name, First Name, first, etc.). Adds two new columns
immediately after the source columns: "<col>_normalized".
"""

import csv
import re
import sys
import argparse

# ---------------- First name normalization ----------------

SUFFIX_PATTERN = re.compile(r'\s+(Jr|Sr|II|III|IV|V)\.?$', re.IGNORECASE)
TITLE_PREFIX = re.compile(r'^(Dr|Mr|Mrs|Ms|Miss|Prof)\.?\s+', re.IGNORECASE)
CREDENTIAL_SUFFIX = re.compile(r',\s*[A-Z]{2,}$')
PAREN_NICKNAME_PATTERN = re.compile(r'\(([^)]+)\)')

def is_initial(word):
    return bool(re.fullmatch(r'[A-Za-z]\.?', word))

# Only consolidate informal variants of the SAME nickname family down to the
# most common casual form (e.g. Jimmy -> Jim, Bobby -> Bob). We deliberately
# do NOT convert formal given names (James, Robert, Michael...) into a
# nickname, since that presumes a preference the data doesn't tell us.
NICKNAME_MAP = {
    'jimmy': 'Jim', 'bobby': 'Bob', 'billy': 'Bill', 'ricky': 'Rick',
    'tommy': 'Tom', 'eddie': 'Ed', 'eddy': 'Ed', 'ronnie': 'Ron',
    'donnie': 'Don', 'joey': 'Joe',
}

def normalize_first_name(raw):
    if not raw or not raw.strip():
        return raw

    name = raw.strip()

    # Strip stray non-name characters
    name = re.sub(r'[^\w\s\(\)\-\'\.]', '', name, flags=re.UNICODE).strip()

    # Remove leading titles (Dr., Mr., etc.)
    name = TITLE_PREFIX.sub('', name).strip()

    # Remove trailing credentials (", CPA", ", PHR", etc.)
    name = CREDENTIAL_SUFFIX.sub('', name).strip()

    # Parenthetical nickname ("Anthony (Tony)") is usually the preferred name
    m = PAREN_NICKNAME_PATTERN.search(name)
    if m:
        nick = m.group(1).strip()
        if re.fullmatch(r"[A-Za-z' -]{1,20}", nick) and not nick.isupper():
            name = nick
        else:
            name = PAREN_NICKNAME_PATTERN.sub('', name).strip()

    # Strip Jr/Sr/roman numeral suffixes
    name = SUFFIX_PATTERN.sub('', name).strip()

    parts = name.split()
    if not parts:
        return raw.strip()

    # All-initials names ("C J", "E J") -- keep as-is
    if len(parts) > 1 and all(is_initial(p) for p in parts):
        result = name
    elif len(parts) > 1 and is_initial(parts[0]):
        # Leading initial(s) -- use the real name that follows
        real = [p for p in parts if not is_initial(p)]
        result = ' '.join(real) if real else name
    else:
        # Strip trailing initial(s)
        while len(parts) > 1 and is_initial(parts[-1]):
            parts = parts[:-1]
        result = parts[0]

    # Fix casing on ALL CAPS / all lowercase single tokens
    if result.isupper() or result.islower():
        result = '-'.join(w.capitalize() for w in result.split('-'))
        result = ' '.join(w.capitalize() if w.isalpha() else w for w in result.split())

    # Consolidate informal nickname variants only (not formal -> nickname)
    key = result.lower()
    if key in NICKNAME_MAP:
        result = NICKNAME_MAP[key]

    return result if result else raw.strip()

# ---------------- City normalization ----------------

LOC_SUFFIX_PATTERN = re.compile(
    r'\s+(Metropolitan\s+Area|Metro\s+Area|Metroplex|Region|Area|Metro)$',
    re.IGNORECASE
)

def normalize_city(raw):
    if not raw or not raw.strip():
        return raw
    city = raw.strip()
    # Collapse duplicate whitespace
    city = re.sub(r'\s+', ' ', city)
    # Strip trailing descriptor words like "... Metropolitan Area"
    prev = None
    while prev != city:
        prev = city
        city = LOC_SUFFIX_PATTERN.sub('', city).strip()
    # Fix ALL CAPS / all lowercase casing, preserving already-mixed-case names
    if city.isupper() or city.islower():
        city = ' '.join(w.capitalize() for w in city.split())
    return city

# ---------------- Column auto-detection ----------------

FIRST_NAME_CANDIDATES = [
    'first_name', 'First Name', 'first name', 'firstname', 'FirstName', 'First'
]
CITY_CANDIDATES = [
    'city', 'City', 'contact_city', 'Contact City', 'Location', 'location'
]

def find_column(fieldnames, candidates, explicit):
    if explicit:
        if explicit not in fieldnames:
            sys.exit(f"Column '{explicit}' not found. Available columns: {fieldnames}")
        return explicit
    for c in candidates:
        if c in fieldnames:
            return c
    return None

# ---------------- Main ----------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input_csv')
    ap.add_argument('output_csv')
    ap.add_argument('--first-name-col', default=None)
    ap.add_argument('--city-col', default=None)
    args = ap.parse_args()

    with open(args.input_csv, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    fn_col = find_column(fieldnames, FIRST_NAME_CANDIDATES, args.first_name_col)
    city_col = find_column(fieldnames, CITY_CANDIDATES, args.city_col)

    if not fn_col and not city_col:
        sys.exit(
            "Could not auto-detect a first-name or city column. "
            "Pass --first-name-col and/or --city-col explicitly. "
            f"Available columns: {fieldnames}"
        )

    out_fields = list(fieldnames)
    if fn_col:
        idx = out_fields.index(fn_col)
        out_fields.insert(idx + 1, f'{fn_col}_normalized')
    if city_col:
        idx = out_fields.index(city_col)
        out_fields.insert(idx + 1, f'{city_col}_normalized')

    fn_changed = 0
    city_changed = 0
    for row in rows:
        if fn_col:
            norm_fn = normalize_first_name(row[fn_col])
            row[f'{fn_col}_normalized'] = norm_fn
            if norm_fn != row[fn_col]:
                fn_changed += 1
        if city_col:
            norm_city = normalize_city(row[city_col])
            row[f'{city_col}_normalized'] = norm_city
            if norm_city != row[city_col]:
                city_changed += 1

    with open(args.output_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=out_fields)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Rows: {len(rows)}")
    if fn_col:
        print(f"First-name column used: '{fn_col}' -- {fn_changed} changed")
    if city_col:
        print(f"City column used: '{city_col}' -- {city_changed} changed")

if __name__ == '__main__':
    main()
