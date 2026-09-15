#!/usr/bin/env python3
"""
Pre-send merge tag gate for Smartlead campaigns.

Catches the two failure modes that have both reached real prospects:

  1. TAG NAME WRONG   -- {{company}} is not a Smartlead field. It sends as
                         literal text. Hit 5 BCP campaigns.
  2. FIELD NOT ON LEADS -- {{gift}} was valid but absent from ~7 of 8 leads.
                         312 emails sent with a blank line.

Both were found by audit AFTER upload. This runs BEFORE.

Inputs (both raw JSON straight from the API, no hand editing):
  sequences.json  <- GET /campaigns/{id}/sequences
  leads.json      <- Smartlead:list_campaign_leads, sampled at several offsets

Usage:
  python3 check_merge_tags.py sequences.json leads.json
  python3 check_merge_tags.py sequences.json leads.json --min-coverage 100

Exit code 1 on any failure. Do not upload or activate on a non-zero exit.
"""

import argparse
import json
import re
import sys

TAG = re.compile(r"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")

# Smartlead's built-in lead fields, per its own API docs. Always present on the
# lead object itself, never inside custom_fields, never need coverage proof.
SYSTEM_FIELDS = {
    "email", "first_name", "last_name", "company_name",
    "phone_number", "website", "location", "linkedin_profile", "company_url",
}
# Note: job_title is NOT a system field. Smartlead's own docs show it inside
# custom_fields. Same for industry, gift, Local_Sports_Team, employee_range.

# Tags that look right and are not. Left side sends as literal text.
KNOWN_BAD = {
    "company": "company_name",
    "companyname": "company_name",
    "firstname": "first_name",
    "lastname": "last_name",
    "first": "first_name",
    "fname": "first_name",
    "phone": "phone_number",
    "city": "location",
}


def walk_strings(obj):
    """Yield every string anywhere in a nested JSON structure."""
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from walk_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_strings(v)


def collect_tags(seq):
    """Map tag name -> set of places it appears."""
    found = {}
    steps = seq if isinstance(seq, list) else seq.get("data", seq.get("sequences", []))
    if not isinstance(steps, list):
        steps = [seq]
    for i, step in enumerate(steps, 1):
        variants = step.get("variants") if isinstance(step, dict) else None
        if variants:
            for j, var in enumerate(variants):
                label = f"step {i}, variant {chr(64 + j + 1)}"
                for s in walk_strings(var):
                    for t in TAG.findall(s):
                        found.setdefault(t, set()).add(label)
        else:
            for s in walk_strings(step):
                for t in TAG.findall(s):
                    found.setdefault(t, set()).add(f"step {i}")
    return found


def lead_coverage(leads):
    """Map custom field name -> (present_count, total). Also return total."""
    rows = leads if isinstance(leads, list) else leads.get(
        "data", leads.get("leads", []))
    if not isinstance(rows, list):
        rows = []
    total = 0
    counts = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        lead = row.get("lead", row)
        cf = lead.get("custom_fields") or {}
        if not isinstance(cf, dict):
            cf = {}
        total += 1
        for k, v in cf.items():
            if v not in (None, "", []):
                counts[k] = counts.get(k, 0) + 1
        for k in SYSTEM_FIELDS:
            if lead.get(k) not in (None, "", []):
                counts[k] = counts.get(k, 0) + 1
    return counts, total


def near_miss(tag, counts):
    """Find a lead field that differs only by case, underscores, or spaces.

    Custom field keys are stored verbatim as typed into the Smartlead UI.
    Typing 'Gift' in the UI and writing {{gift}} in copy silently sends blank.
    """
    def norm(s):
        return re.sub(r"[\s_-]+", "", s).lower()

    target = norm(tag)
    for key in counts:
        if key != tag and norm(key) == target:
            return key
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sequences")
    ap.add_argument("leads")
    ap.add_argument("--min-coverage", type=float, default=100.0)
    args = ap.parse_args()

    seq = json.load(open(args.sequences))
    leads = json.load(open(args.leads))

    tags = collect_tags(seq)
    counts, total = lead_coverage(leads)

    if total == 0:
        print("FAIL: lead sample is empty. Cannot verify coverage.")
        sys.exit(1)

    print(f"lead sample: {total} leads")
    print(f"tags found in sequence: {len(tags)}\n")

    fails, warns = [], []

    for tag in sorted(tags):
        where = ", ".join(sorted(tags[tag]))
        low = tag.lower()

        if low in KNOWN_BAD:
            fails.append(
                f"{{{{{tag}}}}} is not a Smartlead field. "
                f"Use {{{{{KNOWN_BAD[low]}}}}} instead.  [{where}]")
            continue

        present = counts.get(tag, 0)
        pct = 100.0 * present / total

        if tag in SYSTEM_FIELDS:
            if pct < args.min_coverage:
                warns.append(
                    f"{{{{{tag}}}}} system field, only {pct:.1f}% populated "
                    f"({present}/{total})")
            else:
                print(f"  ok    {{{{{tag}}}}}  system field, {pct:.0f}%")
            continue

        if present == 0:
            near = near_miss(tag, counts)
            if near:
                fails.append(
                    f"{{{{{tag}}}}} matches nothing, but the leads carry "
                    f"'{near}'. Custom field names are case and underscore "
                    f"sensitive, exactly as typed into the Smartlead UI. "
                    f"Use {{{{{near}}}}} or rename the field.  [{where}]")
            else:
                fails.append(
                    f"{{{{{tag}}}}} appears in copy but is on ZERO sampled "
                    f"leads. This is the Goliath failure.  [{where}]")
        elif pct < args.min_coverage:
            fails.append(
                f"{{{{{tag}}}}} only {pct:.1f}% populated ({present}/{total}). "
                f"{total - present} leads would send a blank line.  [{where}]")
        else:
            print(f"  ok    {{{{{tag}}}}}  custom field, {pct:.0f}%")

    unused = sorted(set(counts) - set(tags) - SYSTEM_FIELDS)
    if unused:
        print(f"\n  note  custom fields on leads but unused in copy: "
              f"{', '.join(unused)}")

    if warns:
        print("\nWARN:")
        for w in warns:
            print(f"  {w}")

    if fails:
        print("\nFAIL:")
        for f in fails:
            print(f"  {f}")
        print("\nDo not upload or activate. Fix the tag or backfill the field.")
        sys.exit(1)

    print("\nAll merge tags resolve. Safe to upload.")


if __name__ == "__main__":
    main()
