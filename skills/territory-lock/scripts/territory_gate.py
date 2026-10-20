#!/usr/bin/env python3
"""Hard territory lock: the last gate before any lead is loaded.

Every row comes out as exactly one of:
  pass  - company and person are inside the client's territory
  drop  - company or person is outside the territory (reason logged)
  hold  - no usable location data; not loaded, counted in the receipt

Usage:
  python3 territory_gate.py --client emcor in.csv \
      --out pass.csv --dropped dropped.csv --held held.csv --receipt receipt.json

Column names are matched case-insensitively from the lists in FIELD_ALIASES.
Territories live in config/territories.json; a client without an entry gets
_default (US only). There is no flag to turn the gate off.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = REPO / "config" / "territories.json"

STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}
CODES = set(STATE_NAMES.values())

NE = {"CT", "MA", "ME", "NH", "RI", "VT"}
REGIONS = {
    "new england": NE,
    "northeast": NE | {"NY", "NJ", "PA"},
    "north east": NE | {"NY", "NJ", "PA"},
    "tri-state": {"NY", "NJ", "CT"},
    "tristate": {"NY", "NJ", "CT"},
    "mid-atlantic": {"NY", "NJ", "PA", "DE", "MD", "DC", "VA"},
    "mid atlantic": {"NY", "NJ", "PA", "DE", "MD", "DC", "VA"},
    "southeast": {"FL", "GA", "AL", "SC", "NC", "TN", "MS"},
    "south east": {"FL", "GA", "AL", "SC", "NC", "TN", "MS"},
    "midwest": {"OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "KS", "NE", "ND", "SD"},
    "mid-west": {"OH", "IN", "IL", "MI", "WI", "MN", "IA", "MO", "KS", "NE", "ND", "SD"},
    "great lakes": {"OH", "IN", "IL", "MI", "WI", "MN", "NY", "PA"},
    "southwest": {"AZ", "NM", "TX", "OK", "NV"},
    "south west": {"AZ", "NM", "TX", "OK", "NV"},
    "pacific northwest": {"WA", "OR", "ID"},
    "northwest": {"WA", "OR", "ID"},
    "rocky mountain": {"CO", "UT", "WY", "MT", "ID"},
    "mountain west": {"CO", "UT", "WY", "MT", "ID", "NV", "AZ", "NM"},
    "gulf coast": {"TX", "LA", "MS", "AL", "FL"},
    "carolinas": {"NC", "SC"},
    "west coast": {"CA", "OR", "WA"},
    "east coast": NE | {"NY", "NJ", "PA", "DE", "MD", "VA", "NC", "SC", "GA", "FL"},
    "southern california": {"CA"}, "northern california": {"CA"},
    "norcal": {"CA"}, "socal": {"CA"}, "bay area": {"CA"},
    "south florida": {"FL"}, "dmv": {"DC", "MD", "VA"},
}

# 3-digit ZIP prefix ranges -> state (USPS allocation).
_ZIP3 = [
    (5, 5, "NY"), (6, 9, "PR"), (10, 27, "MA"), (28, 29, "RI"), (30, 38, "NH"),
    (39, 49, "ME"), (50, 59, "VT"), (60, 69, "CT"), (70, 89, "NJ"), (100, 149, "NY"),
    (150, 196, "PA"), (197, 199, "DE"), (200, 200, "DC"), (201, 201, "VA"),
    (202, 205, "DC"), (206, 219, "MD"), (220, 246, "VA"), (247, 268, "WV"),
    (270, 289, "NC"), (290, 299, "SC"), (300, 319, "GA"), (320, 349, "FL"),
    (350, 369, "AL"), (370, 385, "TN"), (386, 397, "MS"), (398, 399, "GA"),
    (400, 427, "KY"), (430, 459, "OH"), (460, 479, "IN"), (480, 499, "MI"),
    (500, 528, "IA"), (530, 549, "WI"), (550, 567, "MN"), (569, 569, "DC"),
    (570, 577, "SD"), (580, 588, "ND"), (590, 599, "MT"), (600, 629, "IL"),
    (630, 658, "MO"), (660, 679, "KS"), (680, 693, "NE"), (700, 714, "LA"),
    (716, 729, "AR"), (730, 749, "OK"), (750, 799, "TX"), (800, 816, "CO"),
    (820, 831, "WY"), (832, 838, "ID"), (840, 847, "UT"), (850, 865, "AZ"),
    (870, 884, "NM"), (885, 885, "TX"), (889, 898, "NV"), (900, 961, "CA"),
    (967, 968, "HI"), (970, 979, "OR"), (980, 994, "WA"), (995, 999, "AK"),
]

FIELD_ALIASES = {
    "maps_state": ["maps_state", "place_state"],
    "maps_zip": ["maps_zip", "place_zip", "maps_postal_code"],
    "company_state": ["company_state", "hq_state", "state", "company_hq_state"],
    "company_zip": ["company_zip", "hq_zip", "zip", "postal_code", "zipcode"],
    "company_city": ["company_city", "hq_city", "city"],
    "company_country": ["company_country", "hq_country", "country"],
    "company_location": ["company_location", "hq_location", "company_address", "address"],
    "person_location": ["person_location", "location", "contact_location", "person_address"],
    "person_state": ["person_state", "contact_state"],
    "person_city": ["person_city", "contact_city"],
    "person_country": ["person_country", "contact_country"],
    "title": ["title", "job_title", "person_title", "headline"],
}

US_WORDS = {"us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "america"}


def zip_state(z: Any) -> str:
    m = re.match(r"\s*(\d{5})(?:-\d{4})?\s*$", str(z or ""))
    if not m:
        return ""
    p = int(m.group(1)[:3])
    for lo, hi, st in _ZIP3:
        if lo <= p <= hi:
            return st
    return ""


def norm_state(v: Any) -> str:
    s = str(v or "").strip()
    if s.upper() in CODES:
        return s.upper()
    return STATE_NAMES.get(s.lower(), "")


def is_us(country: Any) -> bool | None:
    c = str(country or "").strip().lower()
    if not c:
        return None
    return c in US_WORDS


def _get(row: dict[str, Any], key: str) -> str:
    lower = {k.lower(): v for k, v in row.items()}
    for alias in FIELD_ALIASES[key]:
        v = lower.get(alias)
        if v not in (None, ""):
            return str(v).strip()
    return ""


_SPLIT = re.compile(r"\s*(?:/|,|&|\band\b|\+|;)\s*")
_SEGMENT = re.compile(r"\s+[-\u2013\u2014|]\s+|[,(\[\]):]")
_NAME_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, STATE_NAMES), key=len, reverse=True)) + r")\b", re.I)
_REGION_RE = re.compile(r"\b(" + "|".join(sorted(map(re.escape, REGIONS), key=len, reverse=True)) + r")\b", re.I)


def _segment_places(seg: str) -> set[str] | None:
    """A segment counts as geography only if EVERY token in it is a state code
    (upper case), a state name, or a region. That keeps 'IT', 'Me', 'Ca' in
    ordinary words, and single words like 'Operations', from matching."""
    toks = [t for t in _SPLIT.split(seg.strip()) if t]
    if not toks:
        return None
    out: set[str] = set()
    for t in toks:
        t = t.strip(" .")
        if t in CODES:  # case-sensitive: 'CT' yes, 'Ct'/'ct' no
            out.add(t)
        elif t.lower() in STATE_NAMES:
            out.add(STATE_NAMES[t.lower()])
        elif t.lower() in REGIONS:
            out |= REGIONS[t.lower()]
        else:
            return None
    return out


def title_places(title: str) -> tuple[set[str], list[str]]:
    """States named in a job title, plus the matched phrases (for the receipt)."""
    if not title:
        return set(), []
    states: set[str] = set()
    hits: list[str] = []
    for seg in _SEGMENT.split(title):
        got = _segment_places(seg)
        if got:
            states |= got
            hits.append(seg.strip())
    # Regions and full state names anywhere in the title ('Northeast Regional
    # Manager', 'Director of Connecticut Operations').
    for m in _REGION_RE.finditer(title):
        states |= REGIONS[m.group(1).lower()]
        hits.append(m.group(1))
    for m in _NAME_RE.finditer(title):
        # 'Washington' / 'Virginia' etc. as a state only when not part of
        # 'West Virginia' (handled by longest-match) - accept as geography.
        states.add(STATE_NAMES[m.group(1).lower()])
        hits.append(m.group(1))
    return states, sorted(set(hits))


def location_places(loc: str) -> tuple[set[str], bool | None]:
    """Parse a free-text location like 'Hartford, Connecticut, United States'
    or 'Hamden, CT 06514'. Returns (states, is_us)."""
    if not loc:
        return set(), None
    states: set[str] = set()
    us: bool | None = None
    parts = [p.strip() for p in loc.split(",") if p.strip()]
    for p in parts:
        if p.lower() in US_WORDS:
            us = True
    for p in parts[1:] if len(parts) > 1 else parts:
        tok = p.split()
        if tok and tok[0].upper() in CODES and tok[0].isupper():
            states.add(tok[0])
        for t in tok:
            st = zip_state(t)
            if st:
                states.add(st)
    for m in _NAME_RE.finditer(loc):
        states.add(STATE_NAMES[m.group(1).lower()])
    for m in _REGION_RE.finditer(loc):
        states |= REGIONS[m.group(1).lower()]
    if not states and us is None and len(parts) >= 2:
        last = parts[-1].lower()
        if last not in US_WORDS and not norm_state(parts[-1]) and not re.search(r"\d", last):
            us = False  # e.g. 'Toronto, Ontario, Canada'
    if states:
        us = True if us is None else us
    return states, us


class Territory:
    def __init__(self, client: str, spec: dict[str, Any]):
        self.client = client
        self.country = (spec.get("country") or "US").upper()
        self.include = spec.get("include") or []
        self.exclude = spec.get("exclude") or []
        self.states = {i["state"].upper() for i in self.include}

    @property
    def any_state(self) -> bool:
        return not self.include

    def state_ok(self, st: str) -> bool:
        return self.any_state or st in self.states

    def check_point(self, st: str, z: str = "", city: str = "") -> tuple[str, str]:
        """('in'|'out'|'unknown', reason) for one place."""
        if not st:
            return "unknown", ""
        z3 = re.sub(r"\D", "", z or "")[:3] if z else ""
        cty = (city or "").strip().lower()
        for ex in self.exclude:
            if ex.get("state", "").upper() != st:
                continue
            if z3 and z3 in ex.get("zip3", []):
                return "out", f"excluded area {ex.get('name')} (ZIP {z3}xx)"
            if cty and cty in [c.lower() for c in ex.get("cities", [])]:
                return "out", f"excluded area {ex.get('name')} (city)"
        if not self.state_ok(st):
            return "out", f"state {st} outside territory"
        for inc in self.include:
            if inc["state"].upper() == st and inc.get("zip3"):
                if z3:
                    if z3 not in inc["zip3"]:
                        return "out", f"{st} ZIP {z3}xx outside {inc.get('label') or 'allowed ZIPs'}"
                else:
                    return "unknown", f"{st} without ZIP; cannot confirm {inc.get('label') or 'allowed ZIPs'}"
        return "in", ""

    def states_overlap(self, states: set[str]) -> bool:
        return self.any_state or bool(states & self.states)


def load_territory(client: str, config: Path = DEFAULT_CONFIG) -> Territory:
    cfg = json.loads(Path(config).read_text())
    key = (client or "").strip().lower()
    spec = cfg.get(key) or cfg["_default"]
    return Territory(key, spec)


def gate_row(row: dict[str, Any], t: Territory) -> tuple[str, str]:
    """Returns (decision, reason)."""
    # ---- company level
    ccountry = is_us(_get(row, "company_country"))
    if ccountry is False and t.country == "US":
        return "drop", f"company country {_get(row, 'company_country')} not US"

    maps_zip = _get(row, "maps_zip")
    maps_st = norm_state(_get(row, "maps_state")) or zip_state(maps_zip)
    c_zip = _get(row, "company_zip")
    c_st = norm_state(_get(row, "company_state")) or zip_state(c_zip)
    c_city = _get(row, "company_city")
    loc_states, loc_us = location_places(_get(row, "company_location"))
    if loc_us is False and t.country == "US":
        return "drop", "company location not US"

    company = "unknown"
    creason = ""
    if maps_st:
        # The Maps listing is the address we actually matched; it wins.
        company, creason = t.check_point(maps_st, maps_zip, c_city)
        creason = f"Maps listing: {creason}" if creason else ""
    elif c_st:
        company, creason = t.check_point(c_st, c_zip, c_city)
        creason = f"company HQ: {creason}" if creason else ""
    elif loc_states:
        verdicts = [t.check_point(s, c_zip, c_city) for s in sorted(loc_states)]
        if any(v == "in" for v, _ in verdicts):
            company = "in"
        elif all(v == "out" for v, _ in verdicts):
            company, creason = "out", "company location: " + verdicts[0][1]
    if company == "out":
        return "drop", creason

    # ---- person level
    pcountry = is_us(_get(row, "person_country"))
    if pcountry is False and t.country == "US":
        return "drop", f"person country {_get(row, 'person_country')} not US"
    p_states, p_us = location_places(_get(row, "person_location"))
    pst = norm_state(_get(row, "person_state"))
    if pst:
        p_states.add(pst)
    if p_us is False and t.country == "US":
        return "drop", "person location not US"
    person = "unknown"
    if p_states:
        verdicts = [t.check_point(s, "", _get(row, "person_city")) for s in sorted(p_states)]
        if any(v == "in" for v, _ in verdicts):
            person = "in"
        elif any(v == "out" for v, _ in verdicts):
            return "drop", "person location: " + next(r for v, r in verdicts if v == "out")

    tstates, thits = title_places(_get(row, "title"))
    if tstates and not t.states_overlap(tstates):
        return "drop", f"title names region outside territory: {', '.join(thits)}"

    if company == "in" or (company == "unknown" and person == "in" and not creason):
        return "pass", ""
    if creason:
        return "hold", creason
    return "hold", "no location data"


def run(rows: list[dict[str, Any]], t: Territory) -> tuple[dict[str, list], dict[str, Any]]:
    out: dict[str, list] = {"pass": [], "drop": [], "hold": []}
    reasons: Counter[str] = Counter()
    log = []
    for i, r in enumerate(rows):
        d, why = gate_row(r, t)
        out[d].append(r)
        if d != "pass":
            reasons[f"{d}: {re.sub(r'[0-9]{3}xx', 'NNNxx', why)}"] += 1
            log.append({"row": i, "decision": d, "reason": why,
                        "email": r.get("email") or r.get("Email") or "",
                        "domain": r.get("domain") or r.get("company_domain") or ""})
    receipt = {
        "territory_lock": {
            "client": t.client,
            "territory": sorted(t.states) or ["US (any state)"],
            "excluded_areas": [e.get("name") for e in t.exclude],
            "rows_in": len(rows),
            "passed": len(out["pass"]),
            "dropped": len(out["drop"]),
            "held_no_location": len(out["hold"]),
            "reasons": dict(reasons.most_common()),
            "log": log,
        }
    }
    return out, receipt


def _write(path: str | None, rows: list[dict[str, Any]], fields: list[str]) -> None:
    if not path:
        return
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("--client", required=True)
    ap.add_argument("--config", default=str(DEFAULT_CONFIG))
    ap.add_argument("--out", required=True)
    ap.add_argument("--dropped")
    ap.add_argument("--held")
    ap.add_argument("--receipt", required=True)
    a = ap.parse_args(argv)
    with open(a.input, newline="") as f:
        rd = csv.DictReader(f)
        fields = list(rd.fieldnames or [])
        rows = list(rd)
    t = load_territory(a.client, Path(a.config))
    out, receipt = run(rows, t)
    _write(a.out, out["pass"], fields)
    _write(a.dropped, out["drop"], fields)
    _write(a.held, out["hold"], fields)
    Path(a.receipt).write_text(json.dumps(receipt, indent=2))
    s = receipt["territory_lock"]
    print(f"territory lock [{t.client}]: {s['rows_in']} in -> {s['passed']} pass, "
          f"{s['dropped']} dropped, {s['held_no_location']} held (no location)")
    for k, v in s["reasons"].items():
        print(f"  {v:>6}  {k}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
