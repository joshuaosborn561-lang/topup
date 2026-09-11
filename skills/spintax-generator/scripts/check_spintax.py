#!/usr/bin/env python3
"""
Validate SalesGlider cold email spintax.

Checks nesting, brace balance, merge tag integrity, dash punctuation, spin
group sanity, casing consistency, and the 90-word longest-path rule.

Usage:
  python3 check_spintax.py copy.md [more.md ...]
  python3 check_spintax.py --max-words 90 --show-longest copy.md
"""

import argparse
import re
import sys

MERGE_TAG = re.compile(r"\{\{[^{}]*\}\}")
SIG = re.compile(r"%[A-Za-z_]+%")
DASHES = ["\u2014", "\u2013", "\u2012", "\u2015"]

HARD = "FAIL"
SOFT = "WARN"


def mask_tags(text):
    """Replace merge tags and signature placeholders with inert tokens."""
    store = []

    def grab(m):
        store.append(m.group(0))
        return f"\x00{len(store) - 1}\x00"

    return MERGE_TAG.sub(grab, SIG.sub(grab, text)), store


def unmask(text, store):
    return re.sub(r"\x00(\d+)\x00", lambda m: store[int(m.group(1))], text)


def find_groups(text):
    """Return (start, end, depth) for every single-brace group."""
    out, stack = [], []
    for i, ch in enumerate(text):
        if ch == "{":
            stack.append(i)
        elif ch == "}":
            if stack:
                s = stack.pop()
                out.append((s, i, len(stack)))
    return out, stack


def longest_path(text):
    """Render the longest variant of every spin group."""
    masked, store = mask_tags(text)

    def expand(s):
        while True:
            m = re.search(r"\{([^{}]*)\}", s)
            if not m:
                return s
            opts = m.group(1).split("|")
            best = max(opts, key=lambda o: len(o.split()))
            s = s[: m.start()] + best + s[m.end():]

    return unmask(expand(masked), store)


def word_count(text):
    t = MERGE_TAG.sub("word", text)
    t = SIG.sub("", t)
    t = re.sub(r"[#*>`_]+", " ", t)
    return len(t.split())


def check_file(path, max_words, show_longest):
    raw = open(path, encoding="utf-8").read()
    issues = []

    masked, store = mask_tags(raw)
    groups, unclosed = find_groups(masked)

    if unclosed:
        for pos in unclosed:
            line = masked[:pos].count("\n") + 1
            issues.append((HARD, line, "Unclosed { brace"))
    stray = masked.count("}") - len([g for g in groups])
    if stray > 0:
        issues.append((HARD, 0, f"{stray} unmatched closing brace(s)"))

    for s, e, depth in groups:
        line = masked[:s].count("\n") + 1
        inner = masked[s + 1:e]
        if depth > 0:
            issues.append((HARD, line, f"Nested spintax: {{{inner[:40]}}}"))
            continue
        opts = inner.split("|")
        if len(opts) == 1:
            # A lone identifier in single braces is almost always a merge tag
            # that lost a brace. It will send literally to the prospect.
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", inner.strip()):
                issues.append((HARD, line,
                               f"Single-brace merge tag {{{inner.strip()}}}, "
                               f"should be {{{{{inner.strip()}}}}}"))
            else:
                issues.append((SOFT, line,
                               f"Spin group with only one option: {{{inner[:40]}}}"))
        if len(opts) >= 5:
            issues.append((SOFT, line,
                           f"{len(opts)} options, over-spun: {{{inner[:40]}}}"))
        if any(not o.strip() for o in opts):
            issues.append((HARD, line, f"Empty option in {{{inner[:40]}}}"))
        # merge tag swallowed inside a spin group
        if "\x00" in inner:
            issues.append((HARD, line,
                           "Merge tag is inside a spin group, brace collision"))
        # casing consistency
        firsts = [o.strip()[:1] for o in opts if o.strip()]
        if len(firsts) > 1:
            uppers = [c.isupper() for c in firsts]
            if any(uppers) and not all(uppers):
                issues.append((SOFT, line,
                               f"Mixed casing across options: {{{inner[:40]}}}"))

    for d in DASHES:
        for m in re.finditer(re.escape(d), raw):
            line = raw[:m.start()].count("\n") + 1
            issues.append((HARD, line, "Dash punctuation, house rule violation"))

    # merge tags must survive a render
    rendered = longest_path(raw)
    if len(MERGE_TAG.findall(rendered)) != len(MERGE_TAG.findall(raw)):
        issues.append((HARD, 0, "Merge tag count changed after render"))
    broken = re.findall(r"(?<!\{)\{[a-z_]+\}(?!\})", rendered)
    if broken:
        issues.append((HARD, 0,
                       f"Single-brace merge tag(s), will not resolve: {broken[:3]}"))

    combos = 1
    for s, e, depth in groups:
        if depth == 0:
            combos *= max(1, len(masked[s + 1:e].split("|")))

    # per-block longest path word counts
    blocks = [b for b in re.split(r"\n\s*\n", raw) if b.strip()]
    over = []
    for b in blocks:
        lp = longest_path(b)
        wc = word_count(lp)
        if wc > max_words:
            head = " ".join(b.split()[:8])
            over.append((wc, head, lp))

    print(f"\n{'=' * 62}\n{path}\n{'=' * 62}")
    n_groups = len([g for g in groups if g[2] == 0])
    print(f"spin points: {n_groups}   combinations: {combos:,}")

    if over:
        print(f"\nOVER {max_words} WORDS on longest path:")
        for wc, head, lp in over:
            print(f"  {wc} words  ...  {head}")
            if show_longest:
                print(f"      {' '.join(lp.split())[:400]}")
    else:
        print(f"longest-path word counts: all blocks under {max_words}")

    fails = [i for i in issues if i[0] == HARD]
    warns = [i for i in issues if i[0] == SOFT]

    seen = set()
    if fails:
        print("\nFAIL:")
        for _, line, msg in fails:
            k = (line, msg)
            if k in seen:
                continue
            seen.add(k)
            print(f"  line {line}: {msg}")
    if warns:
        print("\nWARN:")
        for _, line, msg in warns:
            k = (line, msg)
            if k in seen:
                continue
            seen.add(k)
            print(f"  line {line}: {msg}")
    if not fails and not warns and not over:
        print("\nclean")

    return len(fails) + len(over)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--max-words", type=int, default=90)
    ap.add_argument("--show-longest", action="store_true",
                    help="print the rendered longest path for over-length blocks")
    args = ap.parse_args()

    bad = 0
    for f in args.files:
        bad += check_file(f, args.max_words, args.show_longest)
    print()
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
